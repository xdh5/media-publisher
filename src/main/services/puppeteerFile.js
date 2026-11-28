"use strict";

import { app, BrowserWindow, dialog } from "electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import pie from "puppeteer-in-electron";
import Type from "./Type";
import { prepareElectronPublishPage } from "./electronPublishPage.js";
import { initializePublishProgress, setPublishStage, getPublishProgress } from "./publishStage.js";
import { saveStalledPublishDiagnostics } from "./publishDiagnostics.js";
import { createPublishTaskQueue } from "./publishTaskQueue.js";
import { skipCloseConfirmation } from "./upLoad/closeWindow.js";
import { applyAccountProxyForTask } from "./proxyConfig.js";

import { isPlatformLoginUrl } from "../../shared/platformPageState.js";
import {
  needsRealPublishSessionProbe,
  probeRealPublishSession,
} from "./publishSessionProbe.js";

import StealthPlugin from "puppeteer-extra-plugin-stealth";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

// 同一账号连续发布时复用浏览器窗口，避免每条视频重新建立登录会话。
const reusablePublishSessions = new Map();

const enqueuePublishTask = createPublishTaskQueue(doUpload);

function isExpectedPublishUrl(data, currentUrl) {
  if (currentUrl === data.url) return true;
  if (data && needsRealPublishSessionProbe(data.pt)) {
    try {
      const current = new URL(currentUrl);
      const expected = new URL(data.url);
      if (
        current.origin === expected.origin &&
        current.pathname === expected.pathname
      ) {
        return true;
      }
    } catch (_) {
      // URL 无法解析时继续使用各平台原有兼容判断。
    }
  }

  return false;
}

export function runPuppeteerTask(data, transport, onFinish) {
  enqueuePublishTask(data, transport, onFinish);
}

async function doUpload(data, transport, queueDone) {

  data.partition = data.partition.split("-")[0];

  const maxRetries = data.show || data.pt === "哔哩哔哩" ? 1 : 5;
  let currentAttempt = 0;
  let finished = false;
  let activeBrowser = null;
  let activeWin = null;
  let actionCheckTimer = null;
  let progressTimer = null;
  const retryDelay = 1000;

  const safeReply = (channel, payload) => {
    try {
      transport.reply(channel, payload);
      return true;
    } catch (err) {
      console.error(`发送 ${channel} 事件失败:`, err);
      return false;
    }
  };

  const cleanupTaskResources = () => {
    if (progressTimer) {
      clearInterval(progressTimer);
      progressTimer = null;
    }
    if (actionCheckTimer) {
      clearTimeout(actionCheckTimer);
      actionCheckTimer = null;
    }
    if (data.reuseSessionKey && !data.reuseSessionFinal) {
      reusablePublishSessions.set(data.reuseSessionKey, {
        browser: activeBrowser,
        win: activeWin,
      });
      activeBrowser = null;
      activeWin = null;
      return;
    }
    if (data.reuseSessionKey) reusablePublishSessions.delete(data.reuseSessionKey);
    if (activeBrowser) {
      try {
        activeBrowser.disconnect();
      } catch (e) {
        console.error("兜底断开浏览器连接失败:", e);
      }
    }
    activeBrowser = null;
  };

  const finishOnce = () => {
    if (finished) return;
    finished = true;
    cleanupTaskResources();
    if (queueDone) queueDone();
  };

  const closePublishWinProgrammatically = (win) => {
    if (win && !win.isDestroyed()) {
      win._mmClosedByProgram = true;
    }
    skipCloseConfirmation(win);
    if (win && !win.isDestroyed()) win.close();
  };

  let capturingStall = false;
  const createAttemptTransport = (page) => ({
    reply(channel, ...args) {
      if (finished || capturingStall) return false;
      const payload = args[0];
      if (
        channel === "puppeteerFile-done" &&
        payload &&
        payload.status === false
      ) {
        console.error("[发布失败阶段]", JSON.stringify({ ...getPublishProgress(page), message: payload.message }));
        // 官方定时发布已经完成上传并操作平台页面，失败后自动重试可能重复提交。
        // 直接返回真实失败结果，让调用方决定是否按新时间重新发起。
        if (data.officialScheduledPublish || payload.needsAttention) {
          const replied = transport.reply(channel, ...args);
          finishOnce();
          return replied;
        }
        const err = new Error(payload.message || "平台上传失败");
        err._mmUploadFailurePayload = payload;
        throw err;
      }
      const ok =
        channel === "puppeteerFile-done" &&
        payload &&
        payload.status === true &&
        !payload.skipped;
      if (ok) setPublishStage(page, "平台确认发布流程完成");
      const replied = transport.reply(channel, ...args);
      if (ok) finishOnce();
      return replied;
    },
  });

  const createWindowAndAttempt = async () => {
    if (finished) return;

    currentAttempt++;
    if (currentAttempt > maxRetries) {
      console.log("已达到最大重试次数，操作失败", data);
      safeReply("puppeteer-noLogin", data);
      safeReply("puppeteerFile-done", { ...data, status: false });
      finishOnce();
      return;
    }

    let browser;
    let win;
    let page;

    try {
      const proxyResult = await applyAccountProxyForTask({
        partition: data.partition,
        phone: data.phone,
        pt: data.pt,
      });
      if (proxyResult.applied) {
        console.log(
          `[proxy] 发布任务 ${data.partition} 使用代理 ${proxyResult.display}`
        );
      }

      const reusable = data.reuseSessionKey && reusablePublishSessions.get(data.reuseSessionKey);
      if (reusable && reusable.win && !reusable.win.isDestroyed()) {
        browser = reusable.browser;
        win = reusable.win;
        page = await pie.getPage(browser, win);
        reusablePublishSessions.delete(data.reuseSessionKey);
      } else {
        browser = await pie.connect(app, {
          connect: options => puppeteer.connect({ ...options, protocolTimeout: 0 }),
        });
        win = new BrowserWindow({
        show: data.mmCliSuppressWindow
          ? false
          : data?.show ?? false,
        width: data?.width ?? 1300,
        height: data?.height ?? 800,
        title: `${data.partition} (尝试${currentAttempt}/${maxRetries})`,
        // 后台发布保持页面绘制，并关闭后台节流。
        paintWhenInitiallyHidden: true,
        webPreferences: {
          partition: data.partition,
          nodeIntegration: false,
          contextIsolation: true,
          devTools: true,
          backgroundThrottling: false,
        },
        });
        page = await pie.getPage(browser, win);
      }
      if (["抖音", "视频号", "哔哩哔哩"].includes(data.pt)) {
        if (data.show && !data.mmCliSuppressWindow) {
          win.show();
        } else {
          // 后台窗口保留页面渲染，不显示内容、不占任务栏、不抢焦点。
          win.setOpacity(0);
          win.setSkipTaskbar(true);
          win.setFocusable(false);
          win.showInactive();
        }
      }
      activeWin = win;
      activeBrowser = browser;
      page.setDefaultTimeout(0);
      page.setDefaultNavigationTimeout(0);
      initializePublishProgress(page, { platform: data.pt, account: data.phone, taskId: data.taskId, attempt: currentAttempt });
      let lastProgressAt = Date.now();
      let lastPageState = "";
      let lastProgressLogAt = 0;
      let lastSamplingError = "";
      let samplingProgress = false;
      const failStalledTask = async (message) => {
        if (finished || capturingStall || activeWin !== win) return;
        capturingStall = true;
        app.publisherIdleTimeout = true;
        const progress = getPublishProgress(page);
        const state = { ...progress, message,
          stageSeconds: Math.round((Date.now() - progress.stageStartedAt) / 1000),
          idleSeconds: Math.round((Date.now() - Math.max(lastProgressAt, progress.stageStartedAt)) / 1000),
          lastPageState: lastPageState ? JSON.parse(lastPageState) : null, lastSamplingError };
        console.error("[发布卡点]", JSON.stringify(state));
        let diagnostics = {};
        try {
          diagnostics = await saveStalledPublishDiagnostics(win, state);
        } catch (error) {
          console.error("[发布超时诊断保存失败]", error.message);
        } finally {
          const detail = diagnostics.diagnosticPath ? `${message}；诊断日志：${diagnostics.diagnosticPath}` : message;
          safeReply("puppeteerFile-done", {
            ...data, ...diagnostics, status: false, message: detail, outcome: "unknown", needsAttention: true,
          });
          // 超时会话不参与后续视频的浏览器复用。
          data.reuseSessionFinal = true;
          finishOnce();
          win._mmClosedByProgram = true;
          if (!win.isDestroyed()) win.destroy();
        }
      };
      win.webContents.once("render-process-gone", (_event, details) => {
        failStalledTask(`${data.pt}浏览器渲染进程退出：${details.reason}，请先核对作品管理后再重发`);
      });
      if (progressTimer) clearInterval(progressTimer);
      progressTimer = setInterval(() => {
        if (finished || activeWin !== win) return;
        const progress = getPublishProgress(page);
        const idleSeconds = Math.floor((Date.now() - Math.max(lastProgressAt, progress.stageStartedAt)) / 1000);
        if (idleSeconds >= 10 * 60) {
          failStalledTask(`${data.pt}页面连续10分钟无进展，卡在「${progress.stage}」，已释放浏览器；发布结果待核对，请先检查作品管理`);
          return;
        }
        if (Date.now() - lastProgressLogAt >= 60000) {
          console.log("[发布等待]", JSON.stringify({ ...progress, idleSeconds, lastSamplingError }));
          lastProgressLogAt = Date.now();
        }
        if (samplingProgress) return;
        samplingProgress = true;
        page.evaluate(() => {
          const root = document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document;
          const text = value => String(value || "").replace(/\s+/g, " ").trim().slice(0, 160);
          const cleanUrl = value => { if (!value) return ""; const url = new URL(value, location.href); return url.origin + url.pathname; };
          const progress = [...root.querySelectorAll("[role='progressbar'], progress, [class*='progress'], [class*='upload']")]
            .map((node) => [text(node.innerText), node.getAttribute("aria-valuenow"), node.value, node.style.width]);
          const controls = [...root.querySelectorAll("button, [role='alert'], video")]
            .map((node) => [text(node.innerText), node.disabled, cleanUrl(node.currentSrc)]);
          const dialogs = [...root.querySelectorAll('[role="dialog"], .semi-modal-content')]
            .filter(node => node.getBoundingClientRect().width > 0).slice(0, 3).map(node => text(node.innerText));
          return JSON.stringify({ url: cleanUrl(location.href), progress, controls, dialogs });
        }).then((state) => {
          lastSamplingError = "";
          if (activeWin === win && state !== lastPageState) {
            lastPageState = state;
            lastProgressAt = Date.now();
            if (Date.now() - lastProgressLogAt >= 15000) {
              console.log("[发布进度]", JSON.stringify({ ...getPublishProgress(page), pageState: JSON.parse(state) }));
              lastProgressLogAt = Date.now();
            }
          }
        }).catch(error => {
          if (lastSamplingError !== error.message) console.warn("[发布进度采样失败]", error.message);
          lastSamplingError = error.message;
        }).finally(() => { samplingProgress = false; });
      }, 5000);

      await prepareElectronPublishPage(page);

      // Block any window.open() calls from the publish page (e.g. Juejin OAuth popups)
      win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

      // 站点在上传中常注册 beforeunload；用户主动关窗时二次确认，程序自动关窗见 skipCloseConfirmation。
      win.webContents.on("will-prevent-unload", (event) => {
        if (win._mmAllowCloseWithoutConfirm) {
          win._mmAllowCloseWithoutConfirm = false;
          event.preventDefault();
          return;
        }
        if (win.isDestroyed()) return;
        const choice = dialog.showMessageBoxSync(win, {
          type: "warning",
          title: "关闭发布窗口",
          message:
            "当前页面可能正在上传或已暂停，关闭将放弃未完成的操作。\n\n确定要关闭吗？",
          buttons: ["仍要关闭", "取消"],
          defaultId: 1,
          cancelId: 1,
          noLink: true,
        });
        if (choice === 0) {
          event.preventDefault();
        }
      });

      // 统一 UA：所有平台都强制设置 data.useragent。
      // 这一步很关键：账号管理里 <webview> 是用 ptConfig[pt].useragent（Chrome/138 桌面 UA）扫码登的，
      // 而 BrowserWindow 默认 UA 带 "Electron/x.x.x" 字样。如果发布时不改 UA，
      // 抖音 / 快手等站点的风控会把"同账号、不同 UA"判定为换设备，
      // cookie 即使共享也会被要求重新登录，表现就是用户看到的"重复登录"。
      // 之前的代码只在 pt 含"视频"时才 setUserAgent，是历史遗留，现在统一对齐。
      if (data.useragent) {
        if (
          win &&
          !win.isDestroyed() &&
          win.webContents &&
          !win.webContents.isDestroyed()
        ) {
          try {
            win.webContents.setUserAgent(data.useragent);
          } catch (e) {
            console.warn("win.webContents.setUserAgent 失败:", e?.message || e);
          }
        }
        try {
          await page.setUserAgent(data.useragent);
        } catch (e) {
          console.warn("page.setUserAgent 失败:", e?.message || e);
        }
      }

      setPublishStage(page, "打开平台发布页");
      if (data.pt.indexOf("视频") !== -1) {
        await page.goto(data.url, {
          waitUntil: "domcontentloaded",
          timeout: 0,
        });
      } else {
        await win.loadURL(data.url);
      }

      win.on("closed", () => {
        try {
          if (browser) browser.disconnect();
        } catch (_) {
          // 忽略
        }
        if (activeWin === win) activeWin = null;
        if (activeBrowser === browser) activeBrowser = null;
        if (finished || capturingStall) return;
        const retry =
          Boolean(win._mmRetryAfterClose) && currentAttempt < maxRetries;
        if (retry) {
          setTimeout(() => {
            createWindowAndAttempt().catch((err) => {
              console.error("重试创建窗口失败:", err);
              safeReply("puppeteerFile-done", {
                ...data,
                status: false,
                message: "重试失败",
              });
              finishOnce();
            });
          }, retryDelay);
          return;
        }
        // 用户主动关窗（非程序自动关窗 / 非重试关窗）：跳过该平台，继续队列中的下一项
        const userClosed = !win._mmClosedByProgram;
        if (userClosed) {
          console.log(`用户关闭 ${data.partition} 发布窗口，跳过 ${data.pt}`);
          safeReply("puppeteerFile-done", {
            ...data,
            status: false,
            skipped: true,
            message: "用户关闭窗口，已跳过该平台的发布",
          });
          finishOnce();
          return;
        }
        if (currentAttempt >= maxRetries) {
          safeReply("puppeteer-noLogin", data);
          safeReply("puppeteerFile-done", {
            ...data,
            status: false,
            message: "窗口已关闭，任务结束",
          });
        }
        finishOnce();
      });

      actionCheckTimer = setTimeout(async () => {
        actionCheckTimer = null;
        if (finished) return;
        try {
          if (!page || typeof page.url !== "function") {
            throw new Error("页面对象不可用");
          }
          const currentUrl = page.url();
          if (isExpectedPublishUrl(data, currentUrl)) {
            if (needsRealPublishSessionProbe(data.pt)) {
              setPublishStage(page, "核验真实发布页登录状态");
              const sessionProbe = await probeRealPublishSession(
                page,
                data.pt,
                0
              );
              if (!sessionProbe.ok) {
                const supportsQrLogin =
                  ["抖音", "快手", "头条", "视频号", "哔哩哔哩"].includes(data.pt);
                const message = sessionProbe.loginRequired
                  ? `${sessionProbe.reason}，请重新登录后再试`
                  : sessionProbe.reason;
                console.error(
                  `[auth] ${message}: ${sessionProbe.currentUrl || currentUrl}`
                );
                safeReply(sessionProbe.loginRequired ? "puppeteer-noLogin" : "puppeteerFile-done", {
                  ...data,
                  status: false,
                  currentUrl: sessionProbe.currentUrl || currentUrl,
                  message,
                  realSessionProbe: true,
                  needsAttention: true,
                  supportsQrLogin,

                });
                finishOnce();
                if (win && !win.isDestroyed()) {
                  closePublishWinProgrammatically(win);
                }
                return;
              }
              console.log(`[auth] ${sessionProbe.reason}`);
            }
            const action = Type[data.pt];
            setPublishStage(page, "执行平台发布流程");
            if (typeof action !== "function") {
              // pt 没注册处理器属于配置/调用方错误，重试 5 次也变不出来 handler，
              // 反而会反复打开同一个 URL，触发站点重复登录（典型例子：账号管理
              console.warn(
                `未找到平台处理器: ${data.pt}，跳过重试直接结束任务`
              );
              safeReply("puppeteerFile-done", {
                ...data,
                status: false,
                message: `未找到平台处理器: ${data.pt}`,
              });
              if (win && !win.isDestroyed())
                closePublishWinProgrammatically(win);
              finishOnce();
              return;
            }
            await action(page, data, win, createAttemptTransport(page), finishOnce);
          } else {
            console.log(
              `尝试${currentAttempt} URL不匹配: ${currentUrl}，关闭窗口并重新尝试`
            );
            if (isPlatformLoginUrl(data.pt, currentUrl)) {
              const message = `${data.pt}登录状态已失效，请重新登录后再试`;
              console.error(`[auth] ${message}: ${currentUrl}`);
              safeReply("puppeteer-noLogin", {
                ...data,
                currentUrl,
                message,
                ...({}),
              });
              finishOnce();
              if (win && !win.isDestroyed()) {
                closePublishWinProgrammatically(win);
              }
              return;
            }

            if (win && !win.isDestroyed()) {
              win._mmRetryAfterClose = true;
              closePublishWinProgrammatically(win);
            }
          }
        } catch (err) {
          if (finished || capturingStall) return;
          console.error("[发布失败阶段]", JSON.stringify({ ...getPublishProgress(page), error: err.message,
            lastPageState: lastPageState ? JSON.parse(lastPageState) : null, lastSamplingError }));
          console.log(`尝试${currentAttempt}执行平台逻辑失败:`, err);
          const failurePayload = err && err._mmUploadFailurePayload;
          if (currentAttempt >= maxRetries) {
            safeReply("puppeteerFile-done", {
              ...data,
              ...failurePayload,
              status: false,
              message: failurePayload?.message || err.message || "执行失败",
            });
            if (!data.show && win && !win.isDestroyed())
              closePublishWinProgrammatically(win);
            finishOnce();
            return;
          }
          if (win && !win.isDestroyed()) {
            win._mmRetryAfterClose = true;
            closePublishWinProgrammatically(win);
          }
        }
      }, 3000);
    } catch (error) {
      if (finished || capturingStall) return;
      const proxyConfigError =
        error && /代理/.test(String(error.message || error));
      if (proxyConfigError) {
        console.log(`尝试${currentAttempt}代理配置错误:`, error);
        safeReply("puppeteerFile-done", {
          ...data,
          status: false,
          message: error.message || "代理配置错误",
        });
        finishOnce();
        return;
      }
      console.log(`尝试${currentAttempt}发生错误:`, error);

      if (win && !win.isDestroyed()) {
        win._mmRetryAfterClose = true;
        closePublishWinProgrammatically(win);
      }
      if (browser) browser.disconnect();
      if (finished) return;
      setTimeout(() => {
        createWindowAndAttempt().catch((err) => {
          console.error("重试创建窗口失败:", err);
          safeReply("puppeteerFile-done", {
            ...data,
            status: false,
            message: "重试失败",
          });
          finishOnce();
        });
      }, retryDelay);
    }
  };

  setTimeout(() => {
    createWindowAndAttempt().catch((err) => {
      console.error("首次创建窗口失败:", err);
      safeReply("puppeteerFile-done", {
        ...data,
        status: false,
        message: "创建窗口失败",
      });
      finishOnce();
    });
  }, retryDelay);
}
