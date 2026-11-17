"use strict";

import { app, BrowserWindow } from "electron";
import pie from "puppeteer-in-electron";
import puppeteerCore from "puppeteer-core";
import ptConfig from "../config/ptConfig";
import { applyAccountProxyForTask } from "./proxyConfig.js";

export async function readDouyinCreatorWorks(phone, endpoints) {
  const platform = "抖音";
  const partition = `persist:${phone}${platform}`;
  await applyAccountProxyForTask({ partition, phone, pt: platform });
  const browser = await pie.connect(app, puppeteerCore);
  let window;
  try {
    window = new BrowserWindow({
      show: false,
      webPreferences: { partition, nodeIntegration: false, contextIsolation: true, backgroundThrottling: false },
    });
    const page = await pie.getPage(browser, window);
    await page.setUserAgent(ptConfig[platform].useragent);
    await page.goto(ptConfig[platform].listIndex, { waitUntil: "domcontentloaded", timeout: 30000 });
    if (!page.url().startsWith(ptConfig[platform].listIndex)) {
      throw new Error("未进入抖音作品管理页，请检查账号登录状态");
    }
    return await page.evaluate(async ({ listPath, metricsPath, listParams, metricsFields, metricsHeaders }) => {
      async function read(path, params, headers) {
        const url = new URL(location.origin);
        url.pathname = path;
        url.search = new URLSearchParams(params).toString();
        const response = await fetch(url, { headers, signal: AbortSignal.timeout(30000) });
        if (!response.ok) throw new Error(`抖音作品接口返回 HTTP ${response.status}`);
        const result = await response.json();
        if (result.status_code !== 0) {
          throw new Error(result.status_msg || `抖音作品接口状态：${result.status_code}`);
        }
        return result;
      }

      const works = [];
      let cursor = listParams.max_cursor;
      while (true) {
        const response = await read(listPath, { ...listParams, max_cursor: cursor });
        const data = response.data ?? response;
        const items = data.aweme_list ?? data.work_list;
        if (!Array.isArray(items)) throw new Error(`无法识别抖音作品列表字段：${Object.keys(data).join(", ")}`);
        works.push(...items.filter(({ status_value: statusValue, status }) =>
          statusValue === 102 &&
          status?.private_status === 0 &&
          status.is_private === false &&
          status.self_see === false &&
          status.is_delete === false &&
          status.is_prohibited === false &&
          status.in_reviewing === false
        ));
        if (!data.has_more) break;
        const nextCursor = data.max_cursor ?? data.cursor;
        if (nextCursor == null || String(nextCursor) === String(cursor)) throw new Error("抖音作品分页游标未前进");
        cursor = nextCursor;
      }

      const metrics = [];
      for (const work of works) {
        const id = work.aweme_id ?? work.item_id;
        if (!id) throw new Error(`无法识别抖音作品 ID 字段：${Object.keys(work).join(", ")}`);
        metrics.push(await read(metricsPath, { ids: id, fields: metricsFields }, metricsHeaders));
      }
      return { works, metrics };
    }, endpoints);
  } finally {
    if (window && !window.isDestroyed()) window.destroy();
    browser.disconnect();
  }
}
