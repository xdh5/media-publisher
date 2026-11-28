"use strict";

const PROFILE_URL = "https://channels.weixin.qq.com/cgi-bin/mmfinderassistant-bin/auth/auth_data";

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
  return { ok: true, loginRequired: false, displayName: response.nickname || "", currentUrl, reason: "视频号个人信息接口验证通过" };
}
