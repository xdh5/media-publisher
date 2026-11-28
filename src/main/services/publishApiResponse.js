"use strict";
import { getPublishProgress } from "./publishStage.js";

/** 先监听再操作，避免快速响应丢失；页面关闭或操作结束后释放监听器。 */
export async function runWithPublishResponse(page, label, matches, action) {
  let listener;
  let onClose;
  const pending = new Promise((resolve, reject) => {
    onClose = () => reject(new Error(`${label}等待结束：发布页面已关闭`));
    listener = async response => {
      try {
        if (await matches(response)) resolve(response);
      } catch (error) {
        reject(error);
      }
    };
    page.on("response", listener);
    page.once("close", onClose);
  });
  try {
    const operation = Promise.resolve().then(action);
    const response = await Promise.race([pending, operation.then(() => pending)]);
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
    page.off("response", listener);
    page.off("close", onClose);
  }
}

