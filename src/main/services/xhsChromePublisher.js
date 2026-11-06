import { app, dialog } from "electron";
import fs from "fs";
import path from "path";
import puppeteerCore from "puppeteer-core";

import { resolveChromePath } from "./chromeConfig.js";
import { applyAccountProxyForTask } from "./proxyConfig.js";
import xhsChromeHandler from "./upLoad/xhsChrome.js";

let previousChromePid = null;

export async function publishWithXhsChrome(data, transport, { isFinished, onUnavailable, onFailure }) {
  if (isFinished()) return;
  let realBrowser = null;

  // 使用独立的持久化 userDataDir：
  // - 不能用用户真实 Chrome 目录（Chrome 禁止默认目录开 remote-debugging）
  // - 不能用临时目录（每次丢失登录态）
  // - 用项目 data 下的固定目录，首次登录后 cookie 持久保存，后续发布自动复用
  const chromeDataDir = path.join(
    app.getPath("sessionData"),
    "chrome-xhs-profile"
  );

  try {
    // 1. 获取 Chrome 路径
    const chromePath = resolveChromePath();
    if (!chromePath) {
      console.error("[xhs-chrome] 未找到 Chrome 浏览器，回退到 Electron 窗口模式");
      return onUnavailable();
    }
    console.log("[xhs-chrome] 使用 Chrome:", chromePath);

    // 2. 代理配置
    await applyAccountProxyForTask({
      partition: data.partition,
      phone: data.phone,
      pt: data.pt,
    });

    // 2.5 关闭上一次遗留的 Chrome 实例，释放 userDataDir 的 profile 锁。
    //     否则 puppeteerCore.launch 会因 profile 被占而打开 about:blank。
    if (previousChromePid) {
      console.log("[xhs-chrome] 检测到上次遗留的 Chrome 进程 PID=" + previousChromePid + "，先关闭...");
      try {
        process.kill(previousChromePid);
      } catch (e) {
        console.warn("[xhs-chrome] 关闭上次 Chrome 进程失败（可能已退出）:", e?.message || e);
      }
      previousChromePid = null;
      // 等待 Chrome 进程完全退出并释放 profile 锁
      await new Promise((r) => setTimeout(r, 1500));
    }
    // 兜底：即使没有保存 PID（用户手动关了 Chrome 但锁文件未清理），
    // 也尝试删除 SingletonLock 文件，防止 Chrome 启动后无法使用该 profile。
    try {
      const lockFile = path.join(chromeDataDir, "SingletonLock");
      if (fs.existsSync(lockFile)) {
        fs.unlinkSync(lockFile);
        console.log("[xhs-chrome] 已清理残留的 SingletonLock 文件");
      }
    } catch (e) {
      console.warn("[xhs-chrome] 清理 SingletonLock 失败:", e?.message || e);
    }

    // 3. 启动真实 Chrome
    //    关键：ignoreDefaultArgs: ['--enable-automation'] 去掉自动化标志，
    //    否则页面顶部会出现「Chrome 正受到自动测试软件的控制」横幅，
    //    小红书检测到后直接 401 拒绝登录态。
    realBrowser = await puppeteerCore.launch({
      executablePath: chromePath,
      headless: false,
      userDataDir: chromeDataDir,
      ignoreDefaultArgs: ["--enable-automation"],
      args: [
        "--no-sandbox",
        "--disable-setuid-sandbox",
        "--disable-blink-features=AutomationControlled",
        "--no-first-run",
        "--no-default-browser-check",
      ],
      defaultViewport: { width: 1300, height: 800 },
    });

    // 4. 创建 page 并注入反检测脚本
    const page = (await realBrowser.pages())[0] || (await realBrowser.newPage());

    // 注入反自动化检测（在页面 JS 执行前生效）
    await page.evaluateOnNewDocument(() => {
      // 抹掉 webdriver 标记
      Object.defineProperty(navigator, "webdriver", { get: () => false });
      // 补全 window.chrome
      if (!window.chrome) window.chrome = {};
      window.chrome.runtime = window.chrome.runtime || {};
    });

    // 5. 导航到发布页
    console.log("[xhs-chrome] 导航到发布页:", data.url);
    await page.goto(data.url, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });

    // 6. 检测登录状态：如果被重定向到登录页，提示用户登录
    const LOGIN_WAIT_TIMEOUT = 5 * 60 * 1000;
    const LOGIN_CHECK_INTERVAL = 2000;
    const isOnPublishPage = (url) => url && url.includes("creator.xiaohongshu.com/publish");

    let currentUrl = page.url();
    if (!isOnPublishPage(currentUrl)) {
      console.log("[xhs-chrome] 未在发布页，可能未登录，当前 URL:", currentUrl);

      // 弹窗提醒用户去浏览器登录
      dialog.showMessageBox({
        type: "info",
        title: "小红书 - 真实浏览器登录",
        message: "请在 Chrome 浏览器中登录小红书",
        detail: "首次使用真实浏览器发布需要登录一次小红书创作者平台。\n登录成功后将自动继续发布，后续不再需要重复登录。\n\n最多等待 5 分钟。",
        buttons: ["知道了"],
        noLink: true,
      }).catch(() => {});

      // 轮询等待用户登录
      const loginStartTime = Date.now();
      let loggedIn = false;
      while (Date.now() - loginStartTime < LOGIN_WAIT_TIMEOUT) {
        await new Promise((r) => setTimeout(r, LOGIN_CHECK_INTERVAL));
        if (isFinished()) return;
        try {
          currentUrl = page.url();
        } catch (_) {
          continue;
        }
        if (isOnPublishPage(currentUrl)) {
          loggedIn = true;
          console.log("[xhs-chrome] 用户已登录，到达发布页");
          break;
        }
        // 登录后到了创作者中心但不在发布页，帮用户跳转
        if (currentUrl.includes("creator.xiaohongshu.com") && !currentUrl.includes("/login")) {
          console.log("[xhs-chrome] 已登录，自动跳转到发布页");
          try {
            await page.goto(data.url, { waitUntil: "domcontentloaded", timeout: 30000 });
            if (isOnPublishPage(page.url())) { loggedIn = true; break; }
          } catch (_) {}
        }
      }
      if (!loggedIn) {
        throw new Error("等待登录超时（5 分钟），请登录后重试");
      }
      await new Promise((r) => setTimeout(r, 2000));
    } else {
      console.log("[xhs-chrome] 浏览器已登录，直接发布");
    }

    // 7. 执行发布
    await xhsChromeHandler(page, data, realBrowser, transport);
  } catch (err) {
    console.error("[xhs-chrome] 真实浏览器发布失败:", err?.message || err);
    onFailure(`真实浏览器发布失败: ${err?.message || err}`);
  } finally {
    // 保存 Chrome 子进程 PID，下次 启动发布时
    // 先杀死旧进程释放 userDataDir 的 profile 锁，避免新实例打开 about:blank。
    // 这里只断开 puppeteer ↔ Chrome 的 DevTools 连接，不杀死 Chrome 进程，
    // 让用户可以在浏览器中手动完成操作或查看结果。
    if (realBrowser) {
      try {
        const proc = realBrowser.process();
        previousChromePid = proc && proc.pid ? proc.pid : null;
      } catch (_) {
        previousChromePid = null;
      }
      try { realBrowser.disconnect(); } catch (_) {}
    }
  }
}
