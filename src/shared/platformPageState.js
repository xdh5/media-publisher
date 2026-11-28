"use strict";

export const KUAISHOU_VIDEO_UPLOAD_SELECTOR = 'input[type="file"][accept*="video"], input[type="file"][accept*=".mp4"]';

export function isPlatformLoginUrl(platform, currentUrl) {
  const pt = String(platform || "");
  const rawUrl = String(currentUrl || "");
  try {
    const url = new URL(rawUrl);
    const host = url.hostname.toLowerCase();
    const pathname = url.pathname.toLowerCase();
    if (pt === "哔哩哔哩") return host === "passport.bilibili.com";
    if (pt === "抖音") {
      return (
        host === "sso.douyin.com" ||
        host === "passport.douyin.com" ||
        (host === "creator.douyin.com" && pathname.includes("/login"))
      );
    }
    if (pt === "快手") {
      return (
        host === "passport.kuaishou.com" ||
        (host === "cp.kuaishou.com" && pathname.includes("/login"))
      );
    }

    if (pt === "头条") {
      return (
        host === "sso.toutiao.com" ||
        host === "passport.bytedance.com" ||
        (host === "mp.toutiao.com" && pathname.includes("/login"))
      );
    }

    if (pt === "视频号") {
      return (
        url.origin === "https://channels.weixin.qq.com" &&
        (pathname === "/login.html" || pathname.startsWith("/login/"))
      );
    }
    return false;
  } catch (_) {
    if (pt === "视频号") {
      return rawUrl.startsWith("https://channels.weixin.qq.com/login");
    }
    return false;
  }
}
