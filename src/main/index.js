"use strict";

// 必须在首次 console.* 之前安装，防止输出管道被外部关闭时异步 EPIPE 崩溃主进程
import { installStdioEpipeGuard } from "./services/stdioEpipeGuard";
installStdioEpipeGuard();

const electron = require("electron");
if (typeof electron !== "object" || !electron.app) {
  const runAsNode = process.env.ELECTRON_RUN_AS_NODE;
  if (runAsNode && String(runAsNode).trim() !== "") {
    console.error(
      "media-publisher: 检测到环境变量 ELECTRON_RUN_AS_NODE 已开启，主进程会得到 npm 的 electron 路径字符串而非 API。",
      "请先取消该变量后再启动，例如：ELECTRON_RUN_AS_NODE= electron . cli publish --help"
    );
  } else {
    console.error(
      "media-publisher: require('electron') 异常，请使用「electron .」从项目根启动（勿直接 electron path/to/main.js）。",
      typeof electron
    );
  }
  process.exit(1);
}
const app = electron.app;

import pie from "puppeteer-in-electron";
import { isCliMode, runCliMain } from "./cli";
import { installMainProcessLogFile } from "./services/mainProcessLogFile";
import { initializeElectronRuntime } from "./services/electronStartup";
import { reportUsageTelemetry } from "./services/usageTelemetry";
import { configureMatrixSessionData, acquireMatrixSession } from "./services/matrixDataPaths";

const cliMode = isCliMode(process.argv);

// 用户数据目录名为 media-publisher。登录 Cookie 放在仓库 data。
if (app.name !== "media-publisher") {
  app.name = "media-publisher";
}

if (process.platform === "win32") {
  app.setAppUserModelId("com.media.publisher");
}

// 视频号要先在本地解码才能开始上传。命令行若带 --disable-gpu，
// <video> 会停在 readyState 0，上传进度一直是 0%。
app.commandLine.removeSwitch("disable-gpu");
app.commandLine.appendSwitch("disable-features", "OutOfBlinkCors");

async function startApplication() {
  try {
    const parentPid = Number(process.env.MEDIA_PUBLISHER_PARENT_PID);
    if (parentPid) {
      setInterval(() => {
        try { process.kill(parentPid, 0); }
        catch (error) { if (error.code === "ESRCH") app.exit(1); }
      }, 2000).unref();
    }
    // 调试端口必须在 ready 前注册，账号组锁只阻止后续 CLI 访问会话。
    await Promise.all([initializeElectronRuntime({ app, pie }), acquireMatrixSession(app)]);
    reportUsageTelemetry(app, "cli").catch(() => {});
    console.log("[startup] CLI 参数已识别，开始执行命令");
    const code = await runCliMain(process.argv);
    const exitCode = typeof code === "number" ? code : 0;
    console.log(`[startup] CLI 执行结束，退出码=${exitCode}`);
    if (process.argv.includes("--show") && !app.publisherIdleTimeout) {
      console.log("[startup] 可见窗口已保留，关闭窗口后结束。");
      return;
    }
    app.exit(exitCode);
  } catch (err) {
    const message = err && err.stack ? err.stack : String(err);
    console.error("[startup] Electron/Puppeteer 启动失败:", message);
    app.exit(1);
  }
}

if (!cliMode) {
  console.error("media-publisher 已移除图形界面，请使用 cli 子命令。");
  process.exit(1);
} else {
  // 无界面CLI由命令结果决定退出，关闭最后一个上传窗口时先完成回执输出。
  if (!process.argv.includes("--show")) app.on("window-all-closed", () => {});
  configureMatrixSessionData(app);
  installMainProcessLogFile(app);
  startApplication();
}
