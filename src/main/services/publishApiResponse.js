"use strict";
import { getPublishProgress } from "./publishStage.js";

/** 先监听再操作，避免快速响应丢失；操作失败或超时后释放监听器。 */
export async function runWithPublishResponse(page, label, matches, action, timeout = 60000) {
  let timer;
  let listener;
  const pending = new Promise((resolve, reject) => {
    listener = async response => {
      try {
        if (await matches(response)) resolve(response);
      } catch (error) {
        reject(error);
      }
    };
    page.on("response", listener);
    timer = setTimeout(() => reject(new Error(`${label}接口在${timeout / 1000}秒内未返回确认`)), timeout);
  });
  try {
    const [response] = await Promise.all([pending, Promise.resolve().then(action)]);
    const url = new URL(response.url());
    const actionName = url.searchParams.get('Action') || url.searchParams.get('action');
    const requestPath = url.pathname + (actionName ? `?Action=${actionName}` : "");
    const context = getPublishProgress(page);
    console.log("[发布接口响应]", JSON.stringify({ ...context, operation: label, requestPath, httpStatus: response.status() }));
    if (!response.ok()) throw new Error(`${label}接口返回HTTP ${response.status()}`);
    const responseText = await response.text();
    const body = JSON.parse(responseText);
    console.log("[发布接口结果]", JSON.stringify({ ...context, operation: label, requestPath, statusCode: body.status_code ?? body.result ?? body.status ?? body.code ?? body.err_no ?? body.errno,
      message: body.status_msg ?? body.message, itemId: body.item_id, chapterCount: body.chapter_list?.length,
      requestId: body.extra?.logid || body.ResponseMetadata?.RequestId, error: body.ResponseMetadata?.Error }));
    return { body, responseText, requestPath, httpStatus: response.status(), request: response.request() };
  } finally {
    clearTimeout(timer);
    page.off("response", listener);
  }
}

