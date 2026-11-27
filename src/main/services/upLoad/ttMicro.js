import { setPublishStage } from "../publishStage.js";
import fs from "fs";
import { setToutiaoCheckbox, clickToutiaoText, clearToutiaoEditor } from "./ttText.js";
import { saveToutiaoPublicationResult } from "./ttPublishResult.js";
import { submitToutiaoContent, uploadToutiaoImages } from "./ttApiResponses.js";

export async function fillToutiaoMicro(page, manifest) {
  setPublishStage(page, "填写微头条摘要、话题和配图");
  if (!manifest.micro_text?.trim()) throw new Error("发布业务未指定微头条完整正文 micro_text");
  await page.waitForSelector('.ProseMirror[contenteditable="true"]', { timeout: 30000 });
  await clearToutiaoEditor(page);
  setPublishStage(page, '清理微头条草稿残留配图');
  for (let count = await page.$$eval('.img-box-item', nodes => nodes.length); count > 0; count--) {
    await page.$eval('.img-box-item .image-remove-btn', element => element.click());
    await page.waitForFunction(expected => document.querySelectorAll('.img-box-item').length === expected,
      { timeout: 10000, polling: 100 }, count - 1);
  }
  setPublishStage(page, '上传本期微头条配图');
  console.log('[微头条配图上传]', JSON.stringify({ imagePath: manifest.micro_image_path }));
  const picture = fs.readFileSync(manifest.micro_image_path).toString("base64");
  const content = manifest.micro_text;
  await uploadToutiaoImages(page, '微头条配图上传', 1, () => page.evaluate((text, image) => {
    const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
    editor.focus();
    const clipboard = new DataTransfer();
    const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    clipboard.setData("text/html", `<p>${escaped.replace(/\n/g, "<br>")}</p><p><img src="data:image/png;base64,${image}"></p>`);
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, content, picture));
  setPublishStage(page, "等待微头条配图上传完成");
  console.log('[微头条配图状态]', JSON.stringify(await page.evaluate(() => ({
    counter: document.body.innerText.match(/共.{0,20}张/g),
    previewCount: document.querySelectorAll('.img-box-item').length,
  }))));
  // 配图预览使用本地blob；上传结果以接口为准，页面只核对已添加的图片数量。
  await page.waitForFunction(() => /共\s*1\s*张/.test(document.body.innerText), { timeout: 60000, polling: 250 });
  setPublishStage(page, "设置微头条引用AI声明");
  await setToutiaoCheckbox(page, "引用AI", manifest.publish_options.quote_ai);
}

export async function publishToutiaoMicro(page, data, window, event) {
  const manifest = JSON.parse(fs.readFileSync(data.publishOptions.toutiaoManifestPath, "utf8"));
  setPublishStage(page, "打开微头条发布页");
  await page.goto("https://mp.toutiao.com/profile_v4/weitoutiao/publish", { waitUntil: "domcontentloaded" });
  await fillToutiaoMicro(page, manifest);
  setPublishStage(page, "提交微头条发布");
  await submitToutiaoContent(page, data, "micro", () => clickToutiaoText(page, "发布"));
  return saveToutiaoPublicationResult(page, data, manifest, "micro", event, window);
}
