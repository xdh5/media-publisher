"use strict";

import fs from "fs";
import path from "path";
import { BrowserWindow, app, session as electronSession } from "electron";
import pie from "puppeteer-in-electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import ptConfig from "../../config/ptConfig";
import { applyAccountProxyForTask } from "../proxyConfig.js";
import { getKsUserId, clearKsSession, normalizeKsPartition } from "./ksSessionUtil.js";
import { CLI_LOGIN_QR_FIRST_DELAY_MS, CLI_LOGIN_QR_REFRESH_MS } from "./cliLoginQrRefresh.js";
import { verifyPublishLogin } from "./verifyPublishLogin.js";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

const QR_IMAGE_XPATH = '//*[@id="login-form"]//div[contains(concat(" ", normalize-space(@class), " "), " qrcode ")]/img';

async function openKsQrPanel(page) {
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("button,a,div,span"))
      .some((element) => String(element.textContent || "").trim() === "立即登录"),
    { timeout: 15000, polling: 100 }
  );
  const clicked = await page.evaluate(() => {
    const candidates = Array.from(document.querySelectorAll("button,a,div,span,p"));
    const target = candidates.find(
      (element) => String(element.textContent || "").trim() === "立即登录" &&
        element.getBoundingClientRect().width > 0 &&
        element.getBoundingClientRect().height > 0
    );
    if (!target) return false;
    target.click();
    return true;
  });
  if (!clicked) throw new Error("未找到快手立即登录按钮");
  await page.waitForSelector(".platform-switch", { timeout: 15000 });
  await page.click(".platform-switch");
  await new Promise((resolve) => setTimeout(resolve, 1500));
}

async function captureKsQr(page, saveQrPngPath) {
  const expired = await page.evaluate(() => document.querySelector(".qr-login")?.innerText.includes("二维码已失效"));
  if (expired) {
    const previous = await page.$eval(".qrcode > img", image => image.src);
    await page.evaluate(() => {
      const refresh = [...document.querySelectorAll(".qr-login div, .qr-login span, .qr-login p")]
        .find(element => element.childElementCount === 0 && element.textContent.trim() === "点击刷新");
      refresh.click();
    });
    await page.waitForFunction(value => document.querySelector(".qrcode > img")?.src !== value &&
      !document.querySelector(".qr-login")?.innerText.includes("二维码已失效"),
    { timeout: 10000, polling: 100 }, previous);
  }
  await page.waitForXPath(QR_IMAGE_XPATH, { timeout: 10000 });
  const [image] = await page.$x(QR_IMAGE_XPATH);
  const source = await image.evaluate(element => element.src);
  fs.mkdirSync(path.dirname(saveQrPngPath), { recursive: true });
  fs.writeFileSync(saveQrPngPath, Buffer.from(source.split(",")[1], "base64"));
  return true;
}

export async function runKsCliLogin({
  partition,
  show,
  timeoutMs,
  saveQrPngPath = null,
  phone = null,
  force = false,
}) {
  const cfg = ptConfig.快手;
  if (!cfg) {
    console.error("内部错误: 未找到快手 ptConfig");
    return 1;
  }
  const part = normalizeKsPartition(partition);
  if (force) {
    await clearKsSession(part);
    console.log("快手：已清理当前账号分区的旧会话，将重新生成登录二维码。");
  }
  try {
    await applyAccountProxyForTask({ partition: part, phone, pt: "快手" });
  } catch (error) {
    console.warn("快手：应用账号代理失败:", error && error.message);
  }
  if (!show && !saveQrPngPath) {
    console.error("快手登录必须指定 --show 或 --save-qr-png。");
    return 2;
  }

  return await new Promise((resolve) => {
    let settled = false;
    let win = null;
    let browser = null;
    let page = null;
    let pollTimer = null;
    let qrTimer = null;
    let deadlineTimer = null;
    let verifying = false;

    const finish = async (code, message) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (qrTimer) clearInterval(qrTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);
      if (code === 0) {
        try {
          const ses = electronSession.fromPartition(part);
          await ses.cookies.flushStore();
          ses.flushStorageData();
        } catch (error) {
          code = 1;
          message = `快手登录会话保存失败：${error.message}`;
        }
      }
      try { if (browser) browser.disconnect(); } catch (_) {}
      try { if (win && !win.isDestroyed()) win.close(); } catch (_) {}
      if (message) (code === 0 ? console.log : console.error)(message);
      resolve(code);
    };

    (async () => {
      browser = await pie.connect(app, puppeteer);
      win = new BrowserWindow({
        width: 1100,
        height: 820,
        show: Boolean(show) && !saveQrPngPath,
        paintWhenInitiallyHidden: true,
        autoHideMenuBar: true,
        skipTaskbar: true,
        webPreferences: {
          partition: part,
          nodeIntegration: false,
          contextIsolation: true,
          backgroundThrottling: false,
        },
      });
      win.on("closed", () => {
        if (!settled) finish(3, "快手登录窗口已关闭，尚未完成登录。");
      });
      if (cfg.useragent) win.webContents.setUserAgent(cfg.useragent);
      await win.loadURL(cfg.index);
      page = await pie.getPage(browser, win);
      if (show && !saveQrPngPath) win.show();

      if (await getKsUserId(part)) {
        await verifyPublishLogin(page, "快手");
        await finish(0, "快手真实发布页验证成功，会话已保存。");
        return;
      }
      await openKsQrPanel(page);

      if (saveQrPngPath) {
        const refreshQr = () => !settled && !verifying && captureKsQr(page, saveQrPngPath).catch(() => false);
        setTimeout(refreshQr, CLI_LOGIN_QR_FIRST_DELAY_MS);
        qrTimer = setInterval(refreshQr, CLI_LOGIN_QR_REFRESH_MS);
      }
      pollTimer = setInterval(() => {
        if (settled || verifying) return;
        getKsUserId(part).then(async (userId) => {
          if (!userId || settled || verifying) return;
          verifying = true;
          if (qrTimer) clearInterval(qrTimer);
          try {
            await verifyPublishLogin(page, "快手");
            await finish(0, "快手登录成功，真实发布页验证通过，会话已保存。");
          } catch (error) {
            await finish(3, `快手登录后发布页验证失败：${error.message}`);
          }
        }).catch((error) => console.error("快手登录状态检测失败:", error.message));
      }, 2000);
      deadlineTimer = setTimeout(() => {
        finish(3, `快手登录等待超时（${Math.round(timeoutMs / 1000)}s）。`);
      }, timeoutMs);
    })().catch((error) => {
      console.error("快手 CLI 登录初始化失败:", error.message);
      finish(1);
    });
  });
}
