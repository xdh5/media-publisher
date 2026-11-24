import fs from "fs";
import { setToutiaoCheckbox, clickToutiaoText, clearToutiaoEditor } from "./ttText.js";
import { saveToutiaoPublicationResult } from "./ttPublishResult.js";

export async function fillToutiaoMicro(page, manifest) {
  if (!manifest.micro_summary?.trim()) throw new Error("缺少与标题标签一起定稿的微头条摘要");
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 30000 });
  await clearToutiaoEditor(page);
  const picture = fs.readFileSync(manifest.cover_path).toString("base64");
  const content = manifest.micro_summary + "\n\n" + manifest.hashtags.map(tag => `#${tag}#`).join(" ");
  await page.evaluate((text, image) => {
    const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
    editor.focus();
    const clipboard = new DataTransfer();
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    clipboard.setData("text/html", `<p>${escaped.replace(/\n/g, "<br>")}</p><p><img src="data:image/png;base64,${image}"></p>`);
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, content, picture);
  await page.waitForFunction(() => {
    const images = [...document.querySelectorAll('.img-box-item .item')];
    return images.length === 1 && images[0].style.backgroundImage.includes("https://");
  }, { timeout: 60000, polling: 250 });
  await setToutiaoCheckbox(page, "引用AI", true);
}

export async function publishToutiaoMicro(page, data, window, event) {
  const manifest = JSON.parse(fs.readFileSync(data.publishOptions.toutiaoManifestPath, "utf8"));
  await page.goto("https://mp.toutiao.com/profile_v4/weitoutiao/publish", { waitUntil: "domcontentloaded" });
  await fillToutiaoMicro(page, manifest);
  await clickToutiaoText(page, "发布");
  return saveToutiaoPublicationResult(page, data, manifest, "micro", event, window);
}
