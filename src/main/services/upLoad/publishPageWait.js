"use strict";

/** 发布等待由通用监控判断是否连续十分钟无进展。 */
export async function pollPageUntil(page, pageFn, args, stepMs = 2000) {
  while (!page.isClosed()) {
    const ok = await page.evaluate(pageFn, args).catch(() => false);
    if (ok) return;
    await page.waitForTimeout(stepMs);
  }
  throw new Error("发布页面已关闭，停止等待");
}
