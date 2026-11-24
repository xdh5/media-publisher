"use strict";

import {
  PLATFORM_ALIASES,
  VIDEO_PUBLISH_CANONICAL,
  resolvePublishPlatform,
} from "../../shared/publishPlatforms.js";
import {
  VIDEO_LINK_TYPES,
  buildVideoLinkOption,
} from "../../shared/videoLink.js";

export { PLATFORM_ALIASES, VIDEO_PUBLISH_CANONICAL, resolvePublishPlatform };

/**
 * 解析 `cli publish` 后的 argv（不含子命令名 publish）
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parsePublishArgs(subArgv) {
  const args = Array.isArray(subArgv) ? subArgv : [];
  if (args.includes("--help") || args.includes("-h")) {
    return { ok: true, value: { help: true } };
  }

  const out = {
    platform: null,
    file: null,
    phone: null,
    partition: null,
    title: null,
    description: "",
    bookName: null,
    bt2: null,
    bq: "",
    publishAt: null,
    show: false,
    closeWindowAfterPublish: true,
    dir: null,
    config: null,
    creativeStatement: null,
    draft: false,
    sphLinkType: null,
    sphLinkValue: null,
    publishOptions: {},
  };

  for (let i = 0; i < args.length; i++) {
    const a = args[i];
    if (a === "--platform" || a === "-p") {
      out.platform = args[++i];
    } else if (a === "--file" || a === "-f") {
      out.file = args[++i];
    } else if (a === "--phone") {
      out.phone = args[++i];
    } else if (a === "--partition") {
      out.partition = args[++i];
    } else if (a === "--title" || a === "-t") {
      out.title = args[++i];
    } else if (a === "--description" || a === "--desc") {
      out.description = args[++i] || "";
    } else if (a === "--name" || a === "--book-name") {
      out.bookName = args[++i];
    } else if (a === "--bt2") {
      out.bt2 = args[++i];
    } else if (a === "--tags" || a === "--bq") {
      out.bq = args[++i] || "";
    } else if (a === "--publish-at") {
      out.publishAt = args[++i];
    } else if (a === "--show") {
      out.show = true;
    } else if (a === "--no-close-window") {
      out.closeWindowAfterPublish = false;
    } else if (a === "--dir") {
      out.dir = args[++i];
    } else if (a === "--config" || a === "--xlsx") {
      out.config = args[++i];
    } else if (a === "--creative-statement" || a === "--cs") {
      out.creativeStatement = args[++i];
    } else if (a === "--ai-chapters") {
      out.publishOptions.dyAiChapters = true;
    } else if (a === "--cover") {
      out.publishOptions.coverPath = args[++i];
    } else if (a === "--portrait-cover") {
      out.publishOptions.portraitCoverPath = args[++i];
    } else if (a === "--draft") {
      out.draft = true;
    } else if (a === "--sph-link-type") {
      out.sphLinkType = args[++i];
    } else if (a === "--sph-link-value") {
      out.sphLinkValue = args[++i];
    } else if (a === "--sph-product-id") {
      // 商品上架快捷参数：等价于 --sph-link-type product --sph-link-value <id>
      out.sphLinkType = VIDEO_LINK_TYPES.PRODUCT;
      out.sphLinkValue = args[++i];
    }
  }

  if (!out.platform) {
    return { ok: false, error: "缺少 --platform（或 -p），例如 dy / 抖音" };
  }
  const pt = resolvePublishPlatform(out.platform);
  if (!VIDEO_PUBLISH_CANONICAL.includes(pt)) {
    return { ok: false, error: `未知平台: ${out.platform}` };
  }
  out.platform = pt;

  // 视频号链接是平台专属参数；误传给其他平台时直接忽略。
  if (out.platform === "视频号") {
    const hasType =
      out.sphLinkType != null && String(out.sphLinkType).trim() !== "";
    const hasValue =
      out.sphLinkValue != null && String(out.sphLinkValue).trim() !== "";
    // 只传商品编号时默认按商品上架处理。
    if (hasValue && !hasType) {
      out.sphLinkType = VIDEO_LINK_TYPES.PRODUCT;
    }
    const resolvedHasType =
      out.sphLinkType != null && String(out.sphLinkType).trim() !== "";
    if (resolvedHasType) {
      const typeAliases = {
        none: VIDEO_LINK_TYPES.NONE,
        无: VIDEO_LINK_TYPES.NONE,
        product: VIDEO_LINK_TYPES.PRODUCT,
        商品: VIDEO_LINK_TYPES.PRODUCT,
      };
      const linkType =
        typeAliases[String(out.sphLinkType).trim().toLowerCase()];
      if (!linkType) {
        return {
          ok: false,
          error: "--sph-link-type 当前仅支持 none 或 product",
        };
      }
      if (linkType === VIDEO_LINK_TYPES.PRODUCT && !hasValue) {
        return {
          ok: false,
          error:
            "视频号商品上架必须提供 --sph-product-id 或 --sph-link-value <商品编号>",
        };
      }
      if (linkType === VIDEO_LINK_TYPES.NONE && hasValue) {
        return {
          ok: false,
          error: "--sph-link-type none 不应同时提供商品编号",
        };
      }
      const built = buildVideoLinkOption("视频号", linkType, out.sphLinkValue);
      if (!built.ok) return { ok: false, error: built.error };
      out.publishOptions.link = built.value;
    }
  } else {
    out.sphLinkType = null;
    out.sphLinkValue = null;
  }

  if (!out.file && !out.dir) {
    return {
      ok: false,
      error:
        "缺少 --file（或 -f）视频文件路径，或 --dir + --config 批量目录模式",
    };
  }
  if (out.file && out.dir) {
    return { ok: false, error: "--file 和 --dir 不能同时使用" };
  }
  if (out.dir && !out.config) {
    return {
      ok: false,
      error: "--dir 批量模式必须同时提供 --config <xlsx路径>",
    };
  }

  if (!out.partition) {
    if (!out.phone) {
      return {
        ok: false,
        error:
          "缺少 --phone 或完整 --partition（如 persist:13800138000抖音）",
      };
    }
    const phoneSeg = String(out.phone).split("-")[0];
    out.partition = `persist:${phoneSeg}${out.platform}`;
  }

  if (!out.dir && (!out.title || !String(out.title).trim())) {
    return {
      ok: false,
      error:
        "缺少 --title（或 -t）视频标题（写入 data.bt1）",
    };
  }
  // in dir mode title comes from xlsx per row, no global --title needed

  const visibleDebugPlatforms = new Set(["视频号", "抖音"]);
  if (out.show && !visibleDebugPlatforms.has(out.platform)) {
    console.warn(
      "media-publisher: 当前仅视频号和抖音 CLI publish 支持显示浏览器窗口，已忽略 --show。"
    );
    out.show = false;
  }
  if (out.show && visibleDebugPlatforms.has(out.platform)) {
    // 可见模式用于排查平台二次确认和校验提示，任务结束后保留现场。
    out.closeWindowAfterPublish = false;
  }

  if (out.platform === "视频号") {
    const bt2Trim = out.bt2 && String(out.bt2).trim();
    if (bt2Trim) {
      const cleaned = bt2Trim.replace(/[，。、\/,;:!?'"()\[\]{}<>]/g, "");
      if (cleaned.length > 16) {
        console.warn(
          `media-publisher: 视频号短标 --bt2 共 ${cleaned.length} 字（不含标点），建议控制在 6-16 字内，过长可能被平台截断或报错。`
        );
      }
      if (cleaned.length < 6) {
        console.warn(
          `media-publisher: 视频号短标 --bt2 仅 ${cleaned.length} 字（不含标点），平台提示 6-16 字，过短可能被拒。`
        );
      }
    }
  }

  if (out.bq && /[,，、;；|]/.test(out.bq)) {
    console.warn(
      "media-publisher: --tags 推荐用空格分隔多个标签（如 '减脂 健身 教程'）；检测到 ,，、;；| 等分隔符，哔哩哔哩 / 小红书会按空格切分，逗号将作为单个标签字符保留。"
    );
  }

  if (out.bq) {
    const tags = String(out.bq).trim().split(/\s+/).filter(Boolean);
    if (tags.length > 4) {
      console.warn(
        `media-publisher: --tags 共 ${tags.length} 个，建议最多 4 个话题；多余标签会降低每个话题的权重，生成层请按相关性裁到 4 个以内。`
      );
    }
    const hashtagPlatforms = new Set(["视频号", "抖音", "快手"]);
    if (hashtagPlatforms.has(out.platform)) {
      out.bq = tags
        .map((t) =>
          String(t).startsWith("#") ? String(t) : `#${String(t).trim()}`
        )
        .join(" ");
    }
  }

  return { ok: true, value: out };
}

export function publishHelpText() {
  return `
用法: <应用> cli publish [选项]

字段与命令行发布参数一致：

选项:
  -p, --platform <id>   平台：dy|抖音、tt|头条、ks|快手、blbl|哔哩哔哩、bjh|百家号、sph|视频号、xhs|小红书
  -f, --file <path>     本地视频文件路径，或 http(s) 远程视频 URL（远程会先下载到临时目录，发布结束后自动删除）
      --dir <path>          [batch] video directory path; must be paired with --config
      --config <path>       [batch] xlsx declaration file path (columns: 文件名/标题/标签/创作声明)
      --cs, --creative-statement <val>  creative statement value for single-file mode.
                            Valid values: none | ai_generated | fiction | marketing | personal_opinion | repost | self_made_no_repost
                            (self_made_no_repost is blbl-only). Default: none.
      --phone <id>      账号手机号（可与 partition 二选一）
      --partition <p>   完整 session partition，如 persist:13800138000抖音
  -t, --title <text>    视频标题（必填）→ data.bt1
      --name <n>        名称 / 任务记录名 → bookName；默认与视频文件名（无扩展名）一致
      --book-name <n>   同 --name
      --bt2 <text>      可选概括短标 → data.bt2；视频号目标输入框提示 6-16 字符，代码会把
                            ，。、/,;:!?'"()[]{}<> 等标点替换为空格；不传时保持空白。
                            抖音/小红书也会消费 bt2（抖音拼进描述、小红书回退标题或正文），
                            哔哩哔哩/百家号/头条/快手当前不使用。
      --tags <text>     视频标签 → data.bq（同 --bq）。多个标签用【空格】分隔，例如 "减脂 健身 教程"。
                            【上限 4 个话题】：超过 4 个会触发 warn，agent 生成时请按相关性裁到 ≤ 4。
                            • 视频号/抖音/快手：整串拼进描述末尾；未写 # 的标签会自动补上。
                            • 哔哩哔哩/小红书：按空格切分为独立标签，前导 # 会被自动剥离，可省。
                            • 百家号/头条：当前代码不消费 bq，无需填。
      --ai-chapters    抖音平台智能生成章节，等待生成结果并保存
      --cover <path>   自定义封面：抖音使用4:3，快手使用3:4，头条视频使用16:9
      --portrait-cover <path>  抖音自定义竖封面，完整适配 3:4
      --publish-at <t>  一次性定时发布，格式 "YYYY-MM-DD HH:mm:ss"。抖音、快手、视频号、
                            百家号、头条和小红书会立即上传并设置平台官方定时；其他平台直接报错。
                            应用内定时队列已移除。
                            不支持每日/每周/每月循环。
      --show            显示视频号自动化窗口；其它平台暂时忽略
      --no-close-window 发布后不自动关窗（与视频号 --show 一起使用）
      --draft           显式发布到草稿箱（小红书点「暂存离开」）。若账号配置了「默认发布到草稿」，
                            即使不加该参数也会自动走草稿。
      --sph-product-id <id>   视频号商品上架（快捷参数，等价于 product + 商品编号）
      --sph-link-type <type>  视频号链接类型：none | product；传给其他平台时忽略
      --sph-link-value <id>   视频号商品编号；可单独传（默认按商品上架）
  -h, --help            显示帮助

退出码 (单文件): 0 成功, 1 异常, 2 参数错误, 3 任务失败（上传未成功）, 4 已转存草稿需检查
退出码 (批量 --dir): 0 全部成功, 1 部分失败, 2 全部失败

示例:
  矩媒.exe cli publish -p dy --phone 13800138000 -f C:\\\\v.mp4 -t "我的视频标题" --tags "#减脂 #健身"
  electron . cli publish -p dy --phone 13800138000 -f ./a.mp4 --name "任务A" -t "标题" --tags "#标签1 #标签2"
  # 视频号可选带 --bt2 短标，并使用空格分隔的 tags：
  media-publisher cli publish -p sph --phone 13800138000 -f ./v.mp4 \\\\
    -t "新手第一天跑步就坚持 5 公里是什么体验" \\\\
    --bt2 "5公里新手挑战" \\\\
    --tags "跑步 新手 减脂" \\
    --sph-product-id 10000591263144 --draft
  # 哔哩哔哩独立标签控件，空格分隔、是否带 # 都可：
  media-publisher cli publish -p blbl --phone 13800138000 -f ./v.mp4 -t "标题" --tags "游戏 解说 开黑"
  # 一次性定时发布：必须提供实际视频、标题、账号等完整发布参数
  media-publisher cli publish -p dy --phone 13800138000 -f ./v.mp4 -t "标题" --publish-at "2026-05-05 20:30:00"
  # batch publish with xlsx config:
  media-publisher cli publish -p dy --phone 13800138000 --dir ./videos --config ./videos/batch.xlsx
`.trim();
}
