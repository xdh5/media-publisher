import fs from "fs";
import path from "path";
import { parsePublishArgs } from "./parsePublishArgs.js";

export function parseToutiaoPublishArgs(args, kind) {
  if (args.includes("--help")) return { ok: true, value: { help: true } };
  const index = args.findIndex(value => value === "--file" || value === "-f");
  if (index < 0 || !args[index + 1]) return { ok: false, error: "必须提供发布执行请求 --file <request.json>" };
  const filename = path.resolve(args[index + 1]);
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  if (kind === "article" && (manifest.cover_path || args.some(value => ["--cover", "--portrait-cover", "--widescreen-cover"].includes(value)))) {
    return { ok: false, error: "头条文章仅支持无封面，请移除封面参数" };
  }
  for (const field of ['title', 'description', 'tags', 'creative_statement', 'output_dir', 'publish_options']) {
    if (manifest[field] == null) return { ok: false, error: `发布业务未指定 ${field}` };
  }
  const switches = kind === 'article' ? ['quote_ai', 'first_publish', 'sync_micro'] : kind === 'micro' ? ['quote_ai'] : ['generateImageText'];
  for (const field of switches) {
    if (typeof manifest.publish_options[field] !== 'boolean') return { ok: false, error: `发布业务必须指定布尔选项 publish_options.${field}` };
  }
  if (kind === 'micro' && (typeof manifest.micro_image_path !== "string" || !manifest.micro_image_path.trim())) return { ok: false, error: '发布业务必须指定微头条配图 micro_image_path' };
  const normalized = [...args];
  normalized[index + 1] = kind === "video" ? manifest.video_path : filename;
  const coverArgs = kind === "article" ? [] : ["--cover", kind === "micro" ? manifest.micro_image_path : manifest.cover_path];
  const parsed = parsePublishArgs([...normalized, "-p", "tt", "--creative-statement", manifest.creative_statement, "--title", manifest.title,
    "--description", manifest.description, "--tags", manifest.tags, ...coverArgs]);
  if (parsed.ok && parsed.value.draft) return { ok: false, error: "头条专用命令不支持保存草稿" };
  if (parsed.ok && parsed.value.publishAt && kind === "micro") return { ok: false, error: "当前账号微头条没有官方定时发布入口" };
  if (parsed.ok) parsed.value.publishOptions = { ...parsed.value.publishOptions, ...manifest.publish_options, toutiaoContentType: kind, toutiaoManifestPath: filename };
  return parsed;
}
