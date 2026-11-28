import { setPublishStage } from "../publishStage.js";
import fs from "fs";
import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";

export async function saveToutiaoPublicationResult(page, data, manifest, kind, event, window) {
  if (kind === 'article') data.toutiaoPublication.cover_mode = "none";
  const result = { ...data.toutiaoPublication, kind, title: manifest.title };
  const filename = path.join(manifest.output_dir, `toutiao-${kind}-publication.json`);
  setPublishStage(page, "保存头条平台发布回执");
  fs.writeFileSync(filename, JSON.stringify(result, null, 2));
  event.reply("puppeteerFile-done", { ...data, status: true, message: `头条${kind}发布已提交`, publicationReceipt: filename, officialScheduled: result.officialScheduled === true, outcome: result });
  maybeClosePublishWindow(data, window);
  return result;
}
