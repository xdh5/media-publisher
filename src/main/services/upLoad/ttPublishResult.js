import { setPublishStage } from "../publishStage.js";
import fs from "fs";
import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";

export async function saveToutiaoPublicationResult(page, data, manifest, kind, event, window) {
  setPublishStage(page, "核对头条作品管理中的发布结果");
  if (kind === 'article') {
    data.toutiaoPublication.cover_mode = "none";
  } else await page.waitForFunction(type => {
    const current = location.pathname;
    if (type === "micro") return current === "/profile_v4/weitoutiao";
    return /manage\/content|xigua\/content/.test(current) || /发布成功|提交成功|全部发表成功/.test(document.body.innerText);
  }, { timeout: 0, polling: 250 }, kind);
  const result = { ...data.toutiaoPublication, kind, title: manifest.title, management_url: page.url() };
  const filename = path.join(manifest.output_dir, `toutiao-${kind}-publication.json`);
  setPublishStage(page, "保存头条平台发布回执");
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  event.reply("puppeteerFile-done", { ...data, status: true, message: `头条${kind}发布已提交`, publicationReceipt: filename, officialScheduled: result.officialScheduled === true, outcome: result });
  maybeClosePublishWindow(data, window);
  return result;
}
