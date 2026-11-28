import fs from "fs";
import path from "path";
import { runWithPublishResponse } from "../publishApiResponse.js";

const submitPaths = {
  video: "/xigua/api/upload/PublishVideo",
  article: "/mp/agw/article/publish",
  micro: "/mp/agw/article/wtt",
};

export async function uploadToutiaoImages(page, label, count, action) {
  const images = [];
  await runWithPublishResponse(page, label, async response => {
    const url = new URL(response.url());
    const actionName = url.searchParams.get('Action') || url.searchParams.get('action');
    const spice = url.hostname === 'mp.toutiao.com' && url.pathname === '/spice/image';
    const imageMeta = url.pathname.replace(/\/$/, '') === '/video/openapi/v1' && actionName === 'GetImageUploadInfos';
    if (response.request().method() === "POST" && /upload|image|photo|picture|commit/i.test(url.pathname + actionName)) {
      console.log('[头条上传接口观察]', JSON.stringify({ operation: label, host: url.hostname, requestPath: url.pathname,
        action: actionName, httpStatus: response.status() }));
      if (!spice && !imageMeta && /json/.test(response.headers()['content-type'] || '')) {
        const observed = await response.json();
        console.log('[头条上传响应结构]', JSON.stringify({ operation: label, requestPath: url.pathname,
          fields: Object.keys(observed), dataFields: Object.keys(observed.data || {}) }));
      }
    }
    if (response.request().method() !== "POST" || (!spice && !imageMeta)) return false;
    if (!response.ok()) throw new Error(`${label}接口返回HTTP ${response.status()}`);
    const body = await response.json();
    const uri = spice ? body.data?.image_uri : body.data?.[0]?.result_uri;
    const success = spice ? body.code === 0 : body.code === 2000;
    if (!success || !uri) throw new Error(`${label}接口未确认图片保存成功：${body.message || body.code}`);
    images.push({ requestPath: url.pathname, httpStatus: response.status(), uri,
      originUri: spice ? body.data?.origin_image_uri : undefined,
      status: body.code, imageData: spice ? body.data : undefined });
    console.log("[头条图片接口回执]", JSON.stringify({ operation: label, completed: images.length, expected: count,
      requestPath: url.pathname, httpStatus: response.status(), uri, status: body.code }));
    return images.length === count;
  }, action);
  return images;
}

export async function submitToutiaoContent(page, data, kind, action) {
  data.toutiaoSubmitting = true;
  const receipt = await runWithPublishResponse(page, `头条${kind}提交`, async response => {
    const url = new URL(response.url());
    if (response.request().method() !== 'POST') return false;
    if (url.pathname.replace(/\/$/, '') === submitPaths[kind]) return true;
    if (url.hostname === 'mp.toutiao.com' && /publish|article|spice/.test(url.pathname)) {
      const body = await response.json().catch(() => null);
      console.log('[头条提交接口观察]', JSON.stringify({ kind, requestPath: url.pathname, httpStatus: response.status(),
        fields: Object.keys(body || {}), dataFields: Object.keys(body?.data || {}), code: body?.code, message: body?.message }));
    }
    return false;
  },
  action);
  const directory = data.publishOptions?.toutiaoManifestPath
    ? JSON.parse(fs.readFileSync(data.publishOptions.toutiaoManifestPath, "utf8")).output_dir
    : path.dirname(path.resolve(data.filePath));
  const responseFile = path.join(directory, `toutiao-${kind}-submit-response.json`);
  fs.writeFileSync(responseFile, JSON.stringify({ requestPath: receipt.requestPath,
    httpStatus: receipt.httpStatus, responseText: receipt.responseText }, null, 2));
  console.log('[头条提交响应存档]', responseFile);
  const body = receipt.body;
  const success = kind === "video" ? body.status === 0 && body.data?.Code === 0 : body.code === 0;
  if (!success) throw new Error(`头条${kind}提交失败：${body.data?.Message || body.message || body.err_tips || JSON.stringify(body)}`);
  // 从原始响应读取长整数，避免作品编号经过浮点数转换失真。
  const idField = { video: 'ItemId', article: 'pgc_id', micro: 'thread_id|threadId' }[kind];
  const match = receipt.responseText.match(new RegExp(`"(?:${idField})"\\s*:\\s*"?([1-9]\\d*)"?`));
  if (!match) throw new Error(`头条${kind}提交未返回作品ID，结果待核对，禁止自动重发`);
  const id = match[1];
  let timing;
  if (data.officialScheduledPublish && kind === "article") {
    const posted = new URLSearchParams(receipt.request.postData());
    timing = { timer_status: posted.get("timer_status"), timer_time: posted.get("timer_time") };
    if (timing.timer_status !== "1" || timing.timer_time !== data.publishAt.slice(0, 16)) {
      throw new Error(`头条文章提交的预约时间不一致，结果待核对：${JSON.stringify(timing)}`);
    }
  }
  const result = { status: true, id, kind, ...(timing ? { scheduled: true, officialScheduled: true, publishAt: data.publishAt, timing } : {}), published_at: new Date().toISOString(),
    url: kind === "micro" ? `https://www.toutiao.com/w/${id}/` : `https://www.toutiao.com/${kind === "article" ? "article" : "video"}/${id}/`,
    apiReceipt: { requestPath: receipt.requestPath, httpStatus: receipt.httpStatus,
      statusCode: body.status ?? body.code ?? body.err_no ?? body.errno, code: body.data?.Code, message: body.data?.Message || body.message } };
  fs.writeFileSync(path.join(directory, `toutiao-${kind}-publication.json`), JSON.stringify(result, null, 2));
  data.toutiaoPublication = result;
  console.log("[头条提交回执]", JSON.stringify(result));
  return result;
}
