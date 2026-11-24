import fs from "fs";
import path from "path";
import { parsePublishArgs } from "./parsePublishArgs.js";

export function parseToutiaoPublishArgs(args, kind) {
  if (args.includes("--help")) return { ok: true, value: { help: true } };
  const index = args.findIndex(value => value === "--file" || value === "-f");
  if (index < 0 || !args[index + 1]) return { ok: false, error: "必须提供财经生产清单 --file <manifest.json>" };
  const filename = path.resolve(args[index + 1]);
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  const normalized = [...args];
  normalized[index + 1] = kind === "video" ? manifest.video_path : filename;
  const parsed = parsePublishArgs([...normalized, "-p", "tt", "--creative-statement", "ai_generated", "--title", manifest.title,
    "--description", manifest.publish_copy, "--tags", manifest.hashtags.map(tag => `#${tag}`).join(" "), "--cover", kind === "video" ? manifest.widescreen_cover_path : manifest.cover_path]);
  if (parsed.ok && (parsed.value.publishAt || parsed.value.draft)) return { ok: false, error: "头条专用命令仅支持立即发布；预约视频使用 cli publish" };
  if (parsed.ok) parsed.value.publishOptions = { ...parsed.value.publishOptions, toutiaoContentType: kind, toutiaoManifestPath: filename };
  return parsed;
}
