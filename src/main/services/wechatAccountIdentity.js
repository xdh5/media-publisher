"use strict";

import { app } from "electron";
import fs from "fs";
import path from "path";

const PROFILE_URL = "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data";

function identityPath() {
  return path.join(app.getPath("sessionData"), "wechat-channels-identity.json");
}

/** 只读取视频号身份字段，不保存接口返回的授权凭据。 */
export async function readWechatAccountProfile(page) {
  const response = await page.evaluate(async url => {
    const result = await fetch(url, {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ timestamp: String(Date.now()), _log_finder_uin: "", _log_finder_id: "",
        rawKeyBuff: null, pluginSessionId: null, scene: 7, reqScene: 7 }),
    });
    const body = await result.json();
    return { httpStatus: result.status, errCode: body.errCode, errMsg: body.errMsg,
      finderUsername: body.data?.finderUser?.finderUsername,
      nickname: body.data?.finderUser?.nickname };
  }, PROFILE_URL);
  const currentUrl = page.url();
  const rejectedOnLoginPage = response.errCode === 300330 && new URL(currentUrl).pathname === "/login.html";
  if (response.httpStatus === 401 || rejectedOnLoginPage || /未登录|未登陆|登录.*(失效|过期)|登陆.*(失效|过期)|not.?login|login.?expired/i.test(response.errMsg || "")) {
    return { ok: false, loginRequired: true, reason: "视频号个人信息接口确认未登录，请重新扫码登录", currentUrl };
  }
  if (response.httpStatus < 200 || response.httpStatus >= 300 || response.errCode !== 0) {
    return { ok: false, loginRequired: false, reason: `视频号个人信息接口检测异常：HTTP ${response.httpStatus}，业务码 ${response.errCode}，${response.errMsg || "无错误说明"}`, currentUrl };
  }
  if (typeof response.finderUsername !== "string" || !response.finderUsername.trim()) {
    return { ok: false, loginRequired: false, reason: "视频号个人信息接口缺少 finderUsername，无法确认账号身份", currentUrl };
  }
  return { ok: true, loginRequired: false, platformAccountId: response.finderUsername,
    displayName: response.nickname || "", currentUrl, reason: "视频号个人信息接口验证通过" };
}

/** 只有登录入口允许首次绑定；已有身份始终比较，不因重新扫码而覆盖。 */
export async function verifyWechatAccountIdentity(page, bind = false) {
  const profile = await readWechatAccountProfile(page);
  if (!profile.ok) return profile;
  const filename = identityPath();
  const stored = fs.existsSync(filename) ? JSON.parse(fs.readFileSync(filename, "utf8")) : null;
  if (stored && stored.platform_account_id !== profile.platformAccountId) {
    return { ...profile, ok: false, identityMismatch: true,
      expectedAccountId: stored.platform_account_id,
      reason: `视频号账号不匹配，已停止发布：绑定账号 ${stored.display_name}（${stored.platform_account_id}），当前账号 ${profile.displayName}（${profile.platformAccountId}）。请退出当前账号并登录原绑定账号。` };
  }
  if (!stored && !bind) {
    return { ...profile, ok: false, loginRequired: true, bindingRequired: true,
      reason: "视频号尚未绑定唯一账号 ID，请重新扫码登录完成绑定，已停止发布" };
  }
  if (bind) {
    fs.writeFileSync(filename, JSON.stringify({ platform: "wechat_channels", platform_account_id: profile.platformAccountId,
      display_name: profile.displayName, bound_at: stored?.bound_at || new Date().toISOString() }, null, 2));
  }
  return { ...profile, reason: "视频号个人信息接口成功，唯一账号 ID 与本地绑定一致" };
}
