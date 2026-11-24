"use strict";

import { isPlatformLoginUrl, KUAISHOU_VIDEO_UPLOAD_SELECTOR } from "../../shared/platformPageState.js";

import { XIAOHONGSHU_VIDEO_INPUT } from "./upLoad/xiaohongshuVideo.js";

const READY_SELECTORS = {
  哔哩哔哩: ['.bcc-upload-wrapper input[type="file"], .bcc-upload input[type="file"]'],
  小红书: [XIAOHONGSHU_VIDEO_INPUT],
  抖音: ['input[name="upload-btn"]'],
  快手: [KUAISHOU_VIDEO_UPLOAD_SELECTOR],
  百家号: [
    '.pages-videoV2-index input[type="file"]',
    '.video-main-container input[type="file"]',
  ],
  头条: [
    '.byte-upload input[type="file"]',
    '.video-form input[type="file"]',
    '.upload-container input[type="file"]',
  ],
  视频号: ['wujie-app.wujie_iframe >>> input[type="file"]'],
};

const LOGIN_SELECTORS = {
  哔哩哔哩: ['img[alt="Scan me!"]'],
  小红书: ["div[class*='login-box']"],
  抖音: [
    "#animate_qrcode_container",
    'iframe[src*="passport"]',
    '[class*="login"] [class*="qrcode"]',
  ],
  快手: [
    'iframe[src*="passport"]',
    '[class*="login"] [class*="qrcode"]',
  ],
  百家号: [
    '[id^="TANGRAM__PSP"]',
    'iframe[src*="passport.baidu.com"]',
  ],
  头条: [
    'iframe[src*="passport"]',
    '[class*="login"] [class*="qrcode"]',
  ],
  视频号: [
    'iframe[src*="login"]',
    'img.qrcode',
    '[class*="login"] [class*="qrcode"]',
  ],
};

export function needsRealPublishSessionProbe(platform) {
  return Object.prototype.hasOwnProperty.call(READY_SELECTORS, platform);
}

async function hasAnySelector(page, selectors, visibleOnly = false) {
  for (const selector of selectors) {
    try {
      const handle = await page.$(selector);
      if (handle) {
        const visible = !visibleOnly || await handle.evaluate((node) => {
          const rect = node.getBoundingClientRect();
          const style = getComputedStyle(node);
          return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
        });
        await handle.dispose().catch(() => {});
        if (visible) return true;
      }
    } catch (_) {
      // 页面跳转或 Shadow DOM 尚未挂载时继续轮询。
    }
  }
  return false;
}

/**
 * 读取真实发布页 DOM，而不是只检查 Cookie 是否存在。
 * 上传控件出现才视为可发布；登录页或二维码出现则立即判定登录失效。
 */
export async function probeRealPublishSession(page, platform, timeoutMs = 30000) {
  let timer;
  try {
    return await Promise.race([
      inspectPublishSession(page, platform, timeoutMs),
      new Promise((resolve) => {
        timer = setTimeout(() => resolve({
          ok: false,
          loginRequired: false,
          reason: `${platform}发布页检测超时，页面加载异常或浏览器无响应`,
          currentUrl: typeof page.url === "function" ? page.url() : "",
        }), timeoutMs);
      }),
    ]);
  } finally {
    clearTimeout(timer);
  }
}

async function inspectPublishSession(page, platform, timeoutMs) {
  if (!needsRealPublishSessionProbe(platform)) {
    return { ok: true, reason: "当前平台无需真实发布页探测" };
  }
  const deadline = Date.now() + timeoutMs;
  const readySelectors = READY_SELECTORS[platform];
  const loginSelectors = LOGIN_SELECTORS[platform] || [];

  while (Date.now() < deadline) {
    const currentUrl = typeof page.url === "function" ? page.url() : "";
    if (isPlatformLoginUrl(platform, currentUrl)) {
      return {
        ok: false,
        loginRequired: true,
        reason: `${platform}已跳转到登录页`,
        currentUrl,
      };
    }
    if (await hasAnySelector(page, loginSelectors, true)) {
      return {
        ok: false,
        loginRequired: true,
        reason: `${platform}发布页出现登录界面`,
        currentUrl,
      };
    }
    if (await hasAnySelector(page, readySelectors)) {
      return { ok: true, reason: `${platform}真实发布页可用`, currentUrl };
    }
    await page.waitForTimeout(500);
  }

  return {
    ok: false,
    loginRequired: false,
    reason: `${platform}发布页在 ${Math.round(timeoutMs / 1000)} 秒内未出现上传控件，页面加载异常，尚不能确认登录失效`,
    currentUrl: typeof page.url === "function" ? page.url() : "",
  };
}
