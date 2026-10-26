"use strict";

import { app, BrowserWindow } from "electron";
import pie from "puppeteer-in-electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import ptConfig from "../config/ptConfig";
import { applyAccountProxyForTask } from "./proxyConfig.js";
import { needsRealPublishSessionProbe, probeRealPublishSession } from "./publishSessionProbe.js";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

/** 只打开发布页验证会话，不上传文件、不提交作品、不清除登录凭证。 */
export async function probeAccountSessions(accounts) {
  const browser = await pie.connect(app, puppeteer);
  try {
    return await Promise.all(accounts.map(async (account) => {
      const checkedAt = new Date().toISOString();
      if (!needsRealPublishSessionProbe(account.pt)) {
        return { loggedIn: null, status: "unknown", loginRequired: false,
          realSessionProbe: false, checkedAt, reason: "当前平台未提供真实发布页检测" };
      }
      const partition = account.partition || `persist:${account.phone}${account.pt}`;
      let win;
      try {
        await applyAccountProxyForTask({ partition, phone: account.phone, pt: account.pt });
        win = new BrowserWindow({
          show: false, width: 1300, height: 800, skipTaskbar: true,
          paintWhenInitiallyHidden: true,
          webPreferences: { partition, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
        });
        const page = await pie.getPage(browser, win);
        await page.setUserAgent(ptConfig[account.pt].useragent);
        await page.goto(ptConfig[account.pt].upload, { waitUntil: "domcontentloaded", timeout: 30000 });
        const result = await probeRealPublishSession(page, account.pt, 30000);
        return { loggedIn: result.ok ? true : result.loginRequired ? false : null,
          status: result.ok ? "connected" : result.loginRequired ? "login_required" : "error",
          loginRequired: result.loginRequired === true, realSessionProbe: true,
          checkedAt: new Date().toISOString(), reason: result.reason, currentUrl: result.currentUrl };
      } catch (error) {
        return { loggedIn: null, status: "error", loginRequired: false, realSessionProbe: true,
          checkedAt, reason: `发布页检测失败：${error.message}` };
      } finally {
        if (win && !win.isDestroyed()) win.destroy();
      }
    }));
  } finally {
    browser.disconnect();
  }
}
