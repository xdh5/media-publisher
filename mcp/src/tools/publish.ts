import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { runMatrixPublish } from "../runner.js";
import { submitTask, pollTask } from "../tasks.js";

const publishItemSchema = {
  type: "object",
  properties: {
    content_type: { type: "string", enum: ["video", "article", "micro"], description: "内容类型，默认 video；文章无封面，微头条只接受一张图片" },
    request_path: { type: "string", description: "文章或微头条的独立发布请求 JSON 绝对路径" },
    thumbnail_path: { type: "string" },
    portrait_thumbnail_path: { type: "string" },
    widescreen_thumbnail_path: { type: "string" },
    ai_chapters: { type: "boolean", description: "抖音智能章节" },
    declare_original: { type: "boolean" },
    generate_image_text: { type: "boolean" },
    system_cover_index: { type: "integer", minimum: 0 },
    category: { type: "string" },
    youtube_options: { type: "object", properties: {
      privacy_status: { type: "string", enum: ["private", "unlisted", "public"] },
      category_id: { type: "string" }, language: { type: "string" }, made_for_kids: { type: "boolean" },
    }, required: ["privacy_status", "category_id", "language", "made_for_kids"] },
    account_key: { type: "string", description: "同平台有多个账号时指定 Publisher 账号标识" },
    file: { type: "string", description: "本地视频绝对路径。浏览器平台和 YouTube 必填" },
    video_url: { type: "string", description: "公网视频地址。TikTok、Instagram、Facebook 必填" },
    title: { type: "string", description: "视频标题" },
    description: { type: "string", description: "作品描述。不传时海外平台回退为标题" },
    tags: { type: "string", description: "标签。抖音、快手、视频号会自动补 #" },
    bt2: { type: "string", description: "短标题。视频号填写时须为 6～16 字" },
    publication_id: { type: "string", description: "YouTube 去重用的产物标识，可选" },
    creative_statement: { type: "string", description: "创作声明。未指定时不声明" },
    draft: { type: "boolean", description: "浏览器平台保存草稿。不能和预约同时使用" },
    sph_product_id: { type: "string", description: "仅视频号商品编号" },
  },
  required: ["title"],
} as const;

export const startPublishTool: Tool = {
  name: "start_publish",
  description:
    "按一个 data 账号组，把多条视频一次发到多个平台，并立即返回任务路径。" +
    "独立调用 Publisher 的发布执行器，支持视频、头条文章和微头条。" +
    "立即发布用 publish_at=now；预约用带时区的 ISO 8601。各平台时间不同时传 publish_at_by_platform。" +
    "完成后用 poll_task 读取同一 task_path。",
  inputSchema: {
    type: "object",
    properties: {
      account_group: {
        type: "string",
        description: "Publisher 本地配置中的账号组",
      },
      platforms: {
        type: "array",
        items: { type: "string" },
        description: "要发布的平台列表，例如 [\"douyin\", \"youtube\", \"tiktok\"]",
      },
      items: {
        type: "array",
        items: publishItemSchema,
        description: "要发布的视频。每条视频都会发到全部所选平台",
      },
      publish_mode: {
        type: "string",
        enum: ["immediate", "scheduled"],
        description: "未在 publish_at_by_platform 单独指定的平台使用这个模式",
      },
      publish_at: {
        type: "string",
        description: "immediate 时必须是 now；scheduled 时必须是带时区的未来 ISO 8601",
      },
      publish_at_by_platform: {
        type: "object",
        additionalProperties: { type: "string" },
        description: "按平台覆盖时间。值为 now 或带时区的 ISO 8601",
      },
    },
    required: ["account_group", "platforms", "items"],
  },
};

export const pollTaskTool: Tool = {
  name: "poll_task",
  description: "轮询 start_publish 返回的任务。done=true 后看 status、result 或 error。",
  inputSchema: {
    type: "object",
    properties: {
      task_path: { type: "string", description: "start_publish 返回的 task_path" },
    },
    required: ["task_path"],
  },
};

function publishError(result: { exitCode: number; lastJson: unknown; stderr: string }): string {
  const payload = result.lastJson;
  if (payload && typeof payload === "object" && "error" in payload) {
    return String((payload as { error?: unknown }).error || "").trim();
  }
  return result.stderr.trim().slice(0, 500) || `publishing 退出码 ${result.exitCode}`;
}

export async function handleStartPublish(args: Record<string, unknown>): Promise<string> {
  const accountGroup = String(args.account_group || "").trim();
  if (!accountGroup) throw new Error("account_group 不能为空");
  const started = submitTask(`publish:${accountGroup}`, "publish", async (progress) => {
    const result = await runMatrixPublish(["publish"], {
      stdin: JSON.stringify(args),
      onProgress: progress,
    });
    if (result.exitCode !== 0) {
      throw new Error(publishError(result));
    }
    const payload = result.lastJson;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new Error("publishing 没有返回发布结果");
    }
    if ("error" in payload && (payload as { error?: unknown }).error) {
      throw new Error(String((payload as { error?: unknown }).error));
    }
    return payload;
  });
  return JSON.stringify(started);
}

export function handlePollTask(args: Record<string, unknown>): string {
  return JSON.stringify(pollTask(String(args.task_path || "")));
}
