import fs from "fs";
import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";

export async function saveToutiaoPublicationResult(page, data, manifest, kind, event, window) {
  await page.waitForFunction(type => {
    const current = location.pathname;
    if (type === "article") return current === "/profile_v4/graphic/articles";
    if (type === "micro") return current === "/profile_v4/weitoutiao";
    return /manage\/content|xigua\/content/.test(current) || /发布成功|提交成功|全部发表成功/.test(document.body.innerText);
  }, { timeout: 60000, polling: 250 }, kind);
  const result = { status: true, kind, title: manifest.title, published_at: new Date().toISOString(), management_url: page.url() };
  const filename = path.join(manifest.output_dir, `toutiao-${kind}-publication.json`);
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  event.reply("puppeteerFile-done", { ...data, status: true, message: `头条${kind}发布已提交`, publicationReceipt: filename });
  maybeClosePublishWindow(data, window);
  return result;
}
