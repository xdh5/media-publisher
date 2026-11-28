import path from "path";
import fs from "fs";
import { normalizeCreativeStatement } from "../../shared/creativeStatement.js";
import { runPuppeteerTask } from "../services/puppeteerFile";
import { parseXlsxRows, resolveFileInDir } from "./batchPublishFiles.js";

function fileStem(filePath) {
  const base = path.basename(filePath || "");
  const i = base.lastIndexOf(".");
  return i > 0 ? base.slice(0, i) : base;
}

function derivePhoneForRecord(v) {
  if (v.phone) return String(v.phone);
  if (!v.partition) return "";
  const stripped = String(v.partition).replace(/^persist:/, "");
  const idx = stripped.indexOf(v.platform);
  return idx > 0 ? stripped.slice(0, idx) : stripped;
}

/**
 * Parse xlsx rows for batch publish. Mirrors ipcMain.js dialog:openBatchXlsx logic.
 * Returns [{fileName, title, tags, creativeStatement}] filtered to rows with non-empty fileName.
 */
export async function runBatchDirPublish(v, cfg) {
  const resolvedDir = path.resolve(v.dir);
  if (!fs.existsSync(resolvedDir) || !fs.statSync(resolvedDir).isDirectory()) {
    console.error("目录不存在或不是有效目录: " + resolvedDir);
    return 2;
  }
  const resolvedXlsx = path.resolve(v.config);
  if (!fs.existsSync(resolvedXlsx)) {
    console.error("xlsx 文件不存在: " + resolvedXlsx);
    return 2;
  }

  let rows;
  try {
    rows = parseXlsxRows(resolvedXlsx);
  } catch (e) {
    console.error(
      "解析 xlsx 失败: " + (e && e.message ? e.message : String(e))
    );
    return 2;
  }
  if (rows.length === 0) {
    console.error("xlsx 中没有有效行（文件名列全部为空）");
    return 2;
  }

  const results = [];
  if (rows.some(row => !row.title.trim())) {
    console.error("发布请求必须为每行指定标题，不能从文件名生成标题");
    return 2;
  }

  for (let i = 0; i < rows.length; i++) {
    const row = rows[i];
    const resolvedFile = resolveFileInDir(resolvedDir, row.fileName);

    if (!resolvedFile) {
      const r = {
        index: i + 1,
        total: rows.length,
        fileName: row.fileName,
        title: row.title,
        platform: v.platform,
        phone: v.phone || "",
        status: "skipped",
        message: "文件不存在: " + row.fileName,
      };
      results.push(r);
      console.log(JSON.stringify({ progress: true, ...r }));
      continue;
    }

    const stem = fileStem(resolvedFile);
    const bt1 = row.title.trim();
    const bt2 = row.shortTitle;
    const bookName = stem;

    // 表格标签按逗号分隔，再按平台处理井号。
    const rawTags = String(row.tags || "").trim();
    let bq = "";
    if (rawTags) {
      const tagList = rawTags
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
      const hashtagPlatforms = new Set(["视频号", "抖音", "快手"]);
      if (hashtagPlatforms.has(v.platform)) {
        bq = tagList.map((t) => (t.startsWith("#") ? t : "#" + t)).join(" ");
      } else {
        bq = tagList.map((t) => t.replace(/^#/, "")).join(" ");
      }
    }

    const cs = normalizeCreativeStatement(row.creativeStatement || "");

    const effectivePublishMode = { publishMode: v.draft ? "draft" : "publish", publishToDraft: Boolean(v.draft) };

    const taskId = Date.now() + Math.random();
    const taskPayload = {
      taskId,
      bookName,
      textType: "local",
      data: {
        textOtherName: stem,
        bt1,
        bt2,
        bq,
        bdText: row.description,
        creativeStatement: cs,
      },
      url: cfg.upload,
      show: false,
      mmCliSuppressWindow: false,
      publishMode: effectivePublishMode.publishMode,
      publishToDraft: effectivePublishMode.publishToDraft,
      publishOptions: v.publishOptions || {},
      closeWindowAfterPublish: true,
      useragent: cfg.useragent,
      partition: v.partition,
      phone: derivePhoneForRecord(v),
      filePath: resolvedFile,
      pt: v.platform,
    };

    console.log(
      JSON.stringify({
        progress: true,
        index: i + 1,
        total: rows.length,
        fileName: row.fileName,
        title: bt1,
        platform: v.platform,
        phone: v.phone || "",
        status: "publishing",
      })
    );

    const taskResult = await new Promise((resolve) => {
      let settled = false;
      const finish = (ok, message) => {
        if (settled) return;
        settled = true;
        resolve({ ok, message });
      };

      const transport = {
        reply(channel, payload) {
          if (channel === "puppeteerFile-done") {
            if (payload && payload.taskId != null && payload.taskId !== taskId)
              return;
            if (payload && payload.skipped) {
              const msg = payload.message || "用户关闭窗口，已跳过发布";
              finish(true, msg);
              return;
            }
            const ok = payload && payload.status === true;
            const msg =
              (payload && payload.message) || (ok ? "上传成功" : "上传失败");
            finish(ok, msg);
          } else if (channel === "puppeteer-noLogin") {
            if (payload && payload.taskId != null && payload.taskId !== taskId)
              return;
            const msg = "登录态异常或未登录";
            console.error(
              "[" + row.fileName + "] " + msg + ":",
              JSON.stringify(payload)
            );
            finish(false, msg);
          }
        },
      };

      runPuppeteerTask(taskPayload, transport);
    });

    const r = {
      index: i + 1,
      total: rows.length,
      fileName: row.fileName,
      title: bt1,
      platform: v.platform,
      phone: v.phone || "",
      status: taskResult.ok ? "success" : "failed",
      message: taskResult.message,
    };
    results.push(r);
    console.log(JSON.stringify({ progress: true, done: true, ...r }));

  }

  const succeeded = results.filter((r) => r.status === "success").length;
  const failed = results.filter(
    (r) => r.status === "failed" || r.status === "skipped"
  ).length;
  console.log(
    JSON.stringify({
      summary: true,
      total: rows.length,
      succeeded,
      failed,
      unprocessed: rows.length - results.length,
      message: "成功 " + succeeded + " / 失败 " + failed,
      results,
    })
  );

  if (failed === 0) return 0;
  if (succeeded === 0) return 2;
  return 1;
}
