"use strict";

import path from "path";
import { normalizeCreativeStatement } from "../../shared/creativeStatement.js";
import ptConfig from "../config/ptConfig";
import { runPuppeteerTask } from "./puppeteerFile";
import { CLI_PUBLISH_TIMEOUT_MS } from "./upLoad/uploadTimeouts.js";
import {
  isRemotePublishFile,
  resolvePublishFile,
  guessFileNameFromUrl,
} from "./resolvePublishFile";
import { resolveAccountPublishMode } from "./accountPublishSettingsResolver.js";
import { resolvePublishCompletion } from "../../shared/publishResult.js";
import {
  parseOfficialPublishAt,
  supportsOfficialSchedule,
} from "./upLoad/officialSchedule.js";

function fileStemFromSource(source) {
  const raw = String(source || "").trim();
  const base = isRemotePublishFile(raw)
    ? guessFileNameFromUrl(raw)
    : path.basename(path.resolve(raw));
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
 * 单文件发布（与 cli publish 单文件模式一致）
 * @param {object} v parsePublishArgs 解析后的参数
 * @param {{ sourceFile: string, resolvedFile: string } | null} fileContext 多平台复用已下载文件时传入
 * @returns {Promise<{ exitCode: number, status?: string, scheduled?: boolean, id?: string|null, publishAt?: string, message?: string }>}
 */
export async function runSingleFilePublish(
  v,
  fileContext = null,
  options = {}
) {
  const cfg = ptConfig[v.platform];
  if (!cfg) {
    return {
      exitCode: 2,
      status: "failed",
      message: `内部错误: 未找到平台配置 ${v.platform}`,
    };
  }

  const sourceFile = String(v.file || "").trim();
  const stem = fileStemFromSource(sourceFile);
  const bt1 = String(v.title).trim();
  const bt2 = (v.bt2 && String(v.bt2).trim()) || "";
  const bookName = (v.bookName && String(v.bookName).trim()) || stem;

  let cleanupDownload = null;
  let resolvedFile = sourceFile;
  const officialScheduledPublish = Boolean(
    v.publishAt && supportsOfficialSchedule(v.platform)
  );
  if (v.publishAt && !officialScheduledPublish) {
    return {
      exitCode: 2,
      status: "failed",
      message: `${v.platform}不支持平台官方定时发布；应用内定时队列已移除`,
    };
  }
  if (fileContext) {
    resolvedFile = fileContext.resolvedFile;
  } else {
    try {
      const resolved = await resolvePublishFile(sourceFile);
      resolvedFile = resolved.localPath;
      cleanupDownload = resolved.cleanup;
    } catch (e) {
      return {
        exitCode: 1,
        status: "failed",
        message: `下载视频失败: ${e && e.message ? e.message : e}`,
      };
    }
  }

  try {
    return await runSingleFilePublishInner(
      v,
      cfg,
      {
        sourceFile,
        resolvedFile,
        stem,
        bt1,
        bt2,
        bookName,
      },
      options
    );
  } finally {
    if (cleanupDownload) cleanupDownload();
  }
}

async function runSingleFilePublishInner(
  v,
  cfg,
  { sourceFile, resolvedFile, stem, bt1, bt2, bookName },
  options = {}
) {
  // 结合「请求显式 draft」与账号「默认发布到草稿」设置，算出最终发布模式
  const effectivePublishMode = resolveAccountPublishMode({
    phone: derivePhoneForRecord(v),
    pt: v.platform,
    requestDraftMode: Boolean(v.draft),
  });
  const officialScheduledPublish = Boolean(
    v.publishAt && supportsOfficialSchedule(v.platform)
  );
  let parsedPublishAt = null;
  if (v.publishAt) {
    if (!officialScheduledPublish) {
      return {
        exitCode: 2,
        status: "failed",
        message: `${v.platform}不支持平台官方定时发布；应用内定时队列已移除`,
      };
    }
    parsedPublishAt = parseOfficialPublishAt(v.publishAt);
    if (!parsedPublishAt.ok) {
      return {
        exitCode: 2,
        status: "failed",
        message: parsedPublishAt.error,
      };
    }
  }
  if (officialScheduledPublish && effectivePublishMode.publishToDraft) {
    return {
      exitCode: 2,
      status: "failed",
      message: `${v.platform}官方定时发布不能与草稿模式同时使用`,
    };
  }

  const taskPayload = {
    taskId: Date.now() + Math.random(),
    bookName,
    textType: "local",
    data: {
      textOtherName: stem,
      bt1,
      bt2,
      bq: String(v.bq || "").trim(),
      bdText: String(v.description || "").trim(),
      creativeStatement: normalizeCreativeStatement(v.creativeStatement || ""),
    },
    url: cfg.upload,
    show: v.show,
    mmCliSuppressWindow: false,
    publishMode: effectivePublishMode.publishMode,
    publishToDraft: effectivePublishMode.publishToDraft,
    publishOptions: v.publishOptions || {},
    publishAt: officialScheduledPublish ? parsedPublishAt.text : "",
    officialScheduledPublish,
    closeWindowAfterPublish: v.show ? v.closeWindowAfterPublish : true,
    useragent: cfg.useragent,
    partition: v.partition,
    phone: derivePhoneForRecord(v),
    filePath: resolvedFile,
    pt: v.platform,
    reuseSessionKey: v.reuseSessionKey || "",
    reuseSessionFinal: v.reuseSessionFinal === true,
  };

  const taskId = taskPayload.taskId;
  const recordId = null;
  const updateRecord = () => {};

  return await new Promise((resolve) => {
    const waitForResult = options.waitForResult !== false;
    let settled = false;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (typeof options.onDone === "function") {
        try {
          options.onDone(result);
        } catch (e) {
          console.error("media-publisher: 发布完成回调失败:", e && e.message);
        }
      }
      if (waitForResult) resolve(result);
    };

    const timer = setTimeout(() => {
      const min = Math.round(CLI_PUBLISH_TIMEOUT_MS / 60000);
      const message = `发布超时（${min} 分钟），请检查网络或登录态`;
      console.error(message);
      updateRecord("failed", message);
      finish({ exitCode: 1, status: "failed", message, id: recordId });
    }, CLI_PUBLISH_TIMEOUT_MS);

    const transport = {
      reply(channel, payload) {
        if (channel === "puppeteerFile-done") {
          if (payload && payload.taskId != null && payload.taskId !== taskId) {
            return;
          }
          if (payload && payload.skipped) {
            const message = payload.message || "用户关闭窗口，已跳过发布";
            updateRecord("skipped", message);
            finish({
              exitCode: 0,
              status: "skipped",
              message,
              id: recordId,
            });
            return;
          }
          const completion = resolvePublishCompletion(payload);
          const officialScheduled = Boolean(
            completion.ok && payload && payload.officialScheduled === true
          );
          updateRecord(
            officialScheduled ? "scheduled" : completion.recordStatus,
            completion.message
          );
          finish({
            exitCode: completion.exitCode,
            status: officialScheduled ? "scheduled" : completion.status,
            scheduled: officialScheduled,
            officialScheduled,
            publishAt: officialScheduled ? parsedPublishAt.text : null,
            message: completion.message,
            id: recordId,
            publishMode: completion.savedAsDraft ? "draft" : "publish",
            outcome: payload && payload.outcome,
            needsAttention: completion.fallbackDraft || payload?.needsAttention === true,
          });
        } else if (channel === "puppeteer-noLogin") {
          if (payload && payload.taskId != null && payload.taskId !== taskId) {
            return;
          }
          const message = (payload && payload.message) || "登录态异常或未登录";
          console.error("登录态异常或未登录:", JSON.stringify(payload));
          updateRecord("failed", message);
          finish({
            exitCode: 3,
            status: "failed",
            message,
            id: recordId,
            loginRequired: true,
            realSessionProbe: payload && payload.realSessionProbe === true,
            supportsQrLogin: payload && payload.supportsQrLogin === true,
            loginUrl: payload?.loginUrl,
          });
        }
      },
    };

    try {
      runPuppeteerTask(taskPayload, transport, () => {});
    } catch (error) {
      const message = `启动发布自动化失败：${
        error && error.message ? error.message : String(error)
      }`;
      console.error(message);
      updateRecord("failed", message);
      finish({
        exitCode: 1,
        status: "failed",
        message,
        id: recordId,
      });
    }
    if (!waitForResult) {
      resolve({
        exitCode: 0,
        status: "submitted",
        message: "已提交发布任务",
        id: recordId,
      });
    }
  });
}

function sortPublishPlatforms(list) {
  return [...list].sort((a, b) => {
    if (a.platform.includes("视频号")) return -1;
    if (b.platform.includes("视频号")) return 1;
    return 0;
  });
}

/**
 * 多平台顺序发布；远程视频只下载一次，全部完成后清理临时文件
 * @param {object[]} parsedList
 */
export async function runMultiPlatformPublish(parsedList) {
  if (!Array.isArray(parsedList) || parsedList.length === 0) {
    return {
      success: false,
      exitCode: 2,
      status: "failed",
      message: "平台列表为空",
      total: 0,
      succeeded: 0,
      failed: 0,
      results: [],
    };
  }

  if (parsedList.length === 1) {
    const result = await runSingleFilePublish(parsedList[0]);
    return {
      success: result.exitCode === 0,
      exitCode: result.exitCode,
      status: result.status || (result.exitCode === 0 ? "success" : "failed"),
      message: result.message || "",
      id: result.id ?? null,
      publishAt: result.publishAt ?? null,
      scheduled: result.scheduled === true,
      total: 1,
      succeeded: result.exitCode === 0 ? 1 : 0,
      failed: result.exitCode === 0 ? 0 : 1,
      results: [
        {
          platform: parsedList[0].platform,
          phone: parsedList[0].phone || "",
          creativeStatement: parsedList[0].creativeStatement || "none",
          success: result.exitCode === 0,
          exitCode: result.exitCode,
          status: result.status,
          message: result.message || "",
          id: result.id ?? null,
          publishAt: result.publishAt ?? null,
          scheduled: result.scheduled === true,
        },
      ],
    };
  }

  const unsupportedScheduled = parsedList.find(
    (item) => item.publishAt && !supportsOfficialSchedule(item.platform)
  );
  if (unsupportedScheduled) {
    return {
      success: false,
      exitCode: 2,
      status: "failed",
      message: `${unsupportedScheduled.platform}不支持平台官方定时发布；应用内定时队列已移除`,
      total: parsedList.length,
      succeeded: 0,
      failed: parsedList.length,
      results: [],
    };
  }

  const sourceFile = String(parsedList[0].file || "").trim();
  let cleanupDownload = null;
  let fileContext = null;

  try {
    const resolved = await resolvePublishFile(sourceFile);
    fileContext = {
      sourceFile,
      resolvedFile: resolved.localPath,
    };
    cleanupDownload = resolved.cleanup;
  } catch (e) {
    return {
      success: false,
      exitCode: 1,
      status: "failed",
      message: `下载视频失败: ${e && e.message ? e.message : e}`,
      total: parsedList.length,
      succeeded: 0,
      failed: parsedList.length,
      results: [],
    };
  }

  const results = [];
  let pendingCleanupCount = parsedList.length;
  const releaseSharedDownload = () => {
    pendingCleanupCount -= 1;
    if (pendingCleanupCount <= 0 && cleanupDownload) {
      cleanupDownload();
      cleanupDownload = null;
    }
  };

  try {
    const orderedItems = sortPublishPlatforms(parsedList);
    for (let itemIndex = 0; itemIndex < orderedItems.length; itemIndex += 1) {
      const item = orderedItems[itemIndex];
      if (item.platform === "抖音") {
        item.reuseSessionKey = `douyin:${item.phone || item.partition || "default"}`;
        item.reuseSessionFinal = !orderedItems.slice(itemIndex + 1).some((next) => next.platform === "抖音");
      }
      const waitForOfficialSchedule = Boolean(
        item.publishAt && supportsOfficialSchedule(item.platform)
      );
      const result = await runSingleFilePublish(item, fileContext, {
        waitForResult: waitForOfficialSchedule,
        onDone: releaseSharedDownload,
      });
      results.push({
        platform: item.platform,
        phone: item.phone || "",
        creativeStatement: item.creativeStatement || "none",
        success: result.exitCode === 0,
        exitCode: result.exitCode,
        status: result.status,
        message: result.message || "",
        id: result.id ?? null,
        publishAt: result.publishAt ?? null,
        scheduled: result.scheduled === true,
      });
      if (item.platform.includes("视频号")) {
        await new Promise((resolve) => setTimeout(resolve, 4000));
      }
    }
  } finally {
    if (results.length === 0 && cleanupDownload) cleanupDownload();
  }

  return {
    success: true,
    exitCode: 0,
    status: "submitted",
    message: `已提交 ${results.length} 个平台发布`,
    total: results.length,
    succeeded: 0,
    failed: 0,
    results,
  };
}
