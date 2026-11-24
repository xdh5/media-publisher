import fs from "fs";
import { fillToutiaoArticle, uploadToutiaoArticleCover, setToutiaoCheckbox, clickToutiaoText } from "./ttText.js";
import { saveToutiaoPublicationResult } from "./ttPublishResult.js";

export async function publishToutiaoArticle(page, data, window, event) {
  const filename = data.publishOptions.toutiaoManifestPath;
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  await page.goto("https://mp.toutiao.com/profile_v4/graphic/publish", { waitUntil: "domcontentloaded" });
  await fillToutiaoArticle(page, filename);
  await setToutiaoCheckbox(page, "引用AI", true);
  await uploadToutiaoArticleCover(page, manifest.cover_path);
  await clickToutiaoText(page, "预览并发布");
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(element =>
    element.textContent.trim() === "确认发布" && !element.disabled), { timeout: 60000, polling: 100 });
  await clickToutiaoText(page, "确认发布");
  return saveToutiaoPublicationResult(page, data, manifest, "article", event, window);
}
