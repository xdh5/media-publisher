export { runWithPublishResponse as runWithDyResponse } from "../publishApiResponse.js";

export function requireDySuccess(receipt, label) {
  if (receipt.body.status_code !== 0) {
    throw new Error(`${label}接口失败：状态码${receipt.body.status_code}，${receipt.body.status_msg || "平台未返回成功状态"}`);
  }
  return receipt.body;
}
