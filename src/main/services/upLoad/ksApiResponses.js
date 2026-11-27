export { runWithPublishResponse as runWithKsResponse } from "../publishApiResponse.js";

export function requireKsSuccess(receipt, label) {
  if (receipt.body.result !== 1) {
    throw new Error(`${label}接口失败：状态码${receipt.body.result}，${receipt.body.message || "平台未返回成功状态"}`);
  }
  return receipt.body;
}

export function isKsSubmitResponse(response) {
  return response.request().method() === "POST" && [
    "/rest/cp/works/v2/video/pc/submit",
    "/rest/cp/works/v3/video/pc/submit",
    "/rest/cp/works/v2/video/pc/isolation/submit",
  ].includes(new URL(response.url()).pathname);
}
