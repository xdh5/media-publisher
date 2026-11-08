import { app, BrowserWindow } from "electron";
import puppeteer from "puppeteer-core";
import pie from "puppeteer-in-electron";
import ptConfig from "../../config/ptConfig";
import { applyAccountProxyForTask } from "../proxyConfig.js";
import { probeRealPublishSession } from "../publishSessionProbe.js";

export async function runXiaohongshuCliLogin({ phone, partition, timeoutMs, saveQrPngPath }) {
  const config = ptConfig.小红书;
  await applyAccountProxyForTask({ phone, partition, pt: "小红书" });
  const browser = await pie.connect(app, puppeteer);
  const window = new BrowserWindow({
    width: 1200,
    height: 820,
    title: "小红书创作者登录",
    autoHideMenuBar: true,
    webPreferences: { partition, nodeIntegration: false, contextIsolation: true },
  });
  try {
    const page = await pie.getPage(browser, window);
    await page.setUserAgent(config.useragent);
    const navigate = () => page.goto(config.upload, {
      waitUntil: "domcontentloaded", timeout: 120000,
    });
    await navigate();
    if (saveQrPngPath && new URL(page.url()).pathname === "/login") {
      const qrSelector = ".login-box-container img.css-1lhmg90";
      if (!(await page.$(qrSelector))) {
        const switchIcon = await page.waitForSelector(".login-box-container img.css-wemwzq", {
          visible: true, timeout: 30000,
        });
        if (!(await page.$(qrSelector))) await switchIcon.click();
      }
      const qr = await page.waitForSelector(qrSelector, { visible: true, timeout: 30000 });
      await qr.screenshot({ path: saveQrPngPath });
    }
    await page.waitForFunction(() => {
      const login = document.querySelector("div[class*='login-box']");
      return location.origin === "https://creator.xiaohongshu.com" &&
        /^\/(new|publish)\//.test(location.pathname) &&
        !login?.getClientRects().length;
    }, { timeout: timeoutMs });
    if (new URL(page.url()).pathname !== new URL(config.upload).pathname) await navigate();
    const result = await probeRealPublishSession(page, "小红书");
    if (!result.ok) throw new Error(result.reason);
    await window.webContents.session.cookies.flushStore();
    console.log("小红书登录成功，真实发布页验证通过");
    return 0;
  } catch (error) {
    console.error(`小红书登录验证失败：${error.message}`);
    return 3;
  } finally {
    if (!window.isDestroyed()) window.destroy();
    browser.disconnect();
  }
}
