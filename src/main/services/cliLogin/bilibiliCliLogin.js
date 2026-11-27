import fs from 'fs';
import path from 'path';
import { app, BrowserWindow, session } from 'electron';
import pie from 'puppeteer-in-electron';
import puppeteer from 'puppeteer-core';
import ptConfig from '../../config/ptConfig';
import { probeRealPublishSession } from '../publishSessionProbe.js';

export const BILIBILI_LOGIN_QR_XPATH = "//img[@alt='Scan me!']";
export const BILIBILI_REALNAME_QR_XPATH = "//div[contains(@class,'realname-qrcode-img')]/canvas";

export async function runBilibiliCliLogin({ partition, show, timeoutMs, saveQrPngPath, force }) {
  const store = session.fromPartition(partition);
  if (force) await store.clearStorageData({ storages: ['cookies', 'localstorage'] });
  const browser = await pie.connect(app, puppeteer);
  const win = new BrowserWindow({ width: 1200, height: 900, show: Boolean(show), webPreferences: { partition, backgroundThrottling: false } });
  let page;
  try {
    if (ptConfig.哔哩哔哩.useragent) win.webContents.setUserAgent(ptConfig.哔哩哔哩.useragent);
    page = await pie.getPage(browser, win);
    await page.goto(ptConfig.哔哩哔哩.upload, { waitUntil: 'domcontentloaded', timeout: 30000 });
    console.log('B站登录预检页：' + page.url());
    const initial = await probeRealPublishSession(page, '哔哩哔哩', 10000);
    if (initial.ok) { console.log('B站真实投稿页已登录'); return 0; }
    if (!initial.loginRequired) throw new Error(initial.reason);
    await page.goto('https://passport.bilibili.com/login', { waitUntil: 'domcontentloaded' });
    console.log('B站扫码页：' + page.url());


    const deadline = Date.now() + timeoutMs;
    let lastCapture = 0;
    while (Date.now() < deadline && !win.isDestroyed()) {
      try {
      if (!page.url().includes('passport.bilibili.com')) {
        await page.goto(ptConfig.哔哩哔哩.upload, { waitUntil: 'domcontentloaded' });
        const state = await probeRealPublishSession(page, '哔哩哔哩', 10000);
        if (state.ok) { await store.cookies.flushStore(); store.flushStorageData(); const identity = (await store.cookies.get({ domain: '.bilibili.com' })).find(e => e.name === 'DedeUserID')?.value; console.log('B站扫码登录成功，真实投稿页已核实，UID=' + identity); if (saveQrPngPath) fs.writeFileSync(saveQrPngPath + '.account.json', JSON.stringify({ uid: identity, partition, verified_at: new Date().toISOString() })); return 0; }
        if (!state.loginRequired) throw new Error(state.reason);
      }
      const [refresh] = await page.$x("//*[not(*) and normalize-space(.)='点击刷新']");
      if (refresh) await refresh.evaluate(e => e.click());
      if (saveQrPngPath && Date.now() - lastCapture > 15000) {
        for (const xpath of [BILIBILI_REALNAME_QR_XPATH, BILIBILI_LOGIN_QR_XPATH]) {
          const [qr] = await page.$x(xpath);
          if (!qr) continue;
          fs.mkdirSync(path.dirname(path.resolve(saveQrPngPath)), { recursive: true });
          const source = await qr.evaluate(element => element.tagName === 'CANVAS' ? element.toDataURL('image/png') : element.src);
          if (!source.startsWith('data:image/')) throw new Error('B站二维码尚未生成内嵌图片');
          fs.writeFileSync(path.resolve(saveQrPngPath), Buffer.from(source.slice(source.indexOf(',') + 1), 'base64'));
          console.log(`BILIBILI_QR_PNG ${path.resolve(saveQrPngPath)} XPath=${xpath}`);
          lastCapture = Date.now(); break;
        }
      }
      } catch (error) {
        if (!/Execution context was destroyed|Cannot find context/.test(error.message)) throw error;
      }
      await page.waitForTimeout(1000);
    }
    console.log('B站登录等待结束，尚未确认投稿页可用'); return 3;
  } catch (error) {
    console.error('B站登录失败：' + error.message);
    if (page && saveQrPngPath) {
      console.error(await page.evaluate(() => document.body.innerText.slice(0, 700)));
    }
    throw error;
  } finally {
    browser.disconnect();
    if (!show && !win.isDestroyed()) win.close();
  }
}
