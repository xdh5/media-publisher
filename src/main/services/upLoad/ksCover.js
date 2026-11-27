import { setPublishStage } from "../publishStage.js";
import path from "path";
import fs from "fs";
import { runWithKsResponse, requireKsSuccess } from "./ksApiResponses.js";

export async function uploadKsCover(page, filename) {
  setPublishStage(page, "打开快手封面编辑器");
  await page.evaluate(() => document.querySelector('[class*="_cover-full-editor_"]').click());
  await page.waitForFunction(() => [...document.querySelectorAll("div")].some(element =>
    element.childElementCount === 0 && element.textContent.trim() === "上传封面"), { timeout: 15000, polling: 100 });
  await page.evaluate(() => [...document.querySelectorAll("div")].find(element =>
    element.childElementCount === 0 && element.textContent.trim() === "上传封面").click());
  const clear = await page.$('[class*="_cropper-upload-clear_"]');
  if (clear) await clear.click();
  const input = await page.waitForSelector('[class*="_cropper-upload-upload_"] input[type="file"]', { timeout: 15000 });
  setPublishStage(page, "上传快手竖版封面图片");
  await input.uploadFile(path.resolve(filename));
  await page.waitForSelector('[class*="_cropper-upload-clear_"]', { timeout: 30000 });
  setPublishStage(page, "等待快手封面裁剪画布载入");
  await page.waitForFunction(() => {
    const canvas = [...document.querySelectorAll('canvas[class*="_cutter-raw_"]')].find(node => node.getBoundingClientRect().width > 0);
    return canvas && canvas.width > 0 && canvas.height > 0 &&
      canvas.getContext("2d").getImageData(Math.floor(canvas.width / 2), Math.floor(canvas.height / 2), 1, 1).data[3] > 0;
  }, { timeout: 30000, polling: 100 });
  setPublishStage(page, "设置快手封面比例并保存");
  await page.evaluate(() => {
    [...document.querySelectorAll('[class*="_ratio-item_"]')].find(element =>
      element.querySelector("span")?.textContent === "3:4").click();
  });
  await page.waitForFunction(() => [...document.querySelectorAll('[class*="_ratio-item_"]')].some(element =>
    element.querySelector("span")?.textContent === "3:4" && element.className.includes("_active_")), { timeout: 10000, polling: 100 });
  const receipt = await runWithKsResponse(page, "快手裁剪封面上传", response =>
    response.request().method() === "POST" &&
    new URL(response.url()).pathname === "/rest/cp/works/v4/video/pc/cover/edit/cover/upload",
  () => page.evaluate(() => [...document.querySelectorAll("button")].find(element =>
    element.textContent.trim() === "确认" && !element.disabled && element.getBoundingClientRect().width > 0).click()), 600000);
  const body = requireKsSuccess(receipt, "快手裁剪封面上传");
  if (!body.data.coverKey) throw new Error("快手封面上传接口未返回coverKey，尚未提交视频");
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(element =>
    element.textContent.trim() === "确认" && element.getBoundingClientRect().width > 0), { timeout: 60000, polling: 100 });
  setPublishStage(page, "核对快手平台保存的封面比例和内容");
  const actual = await page.evaluate(async (key, expected) => {
    const response = await fetch(`/rest/cp/works/v2/video/pc/upload/cover/view?coverKey=${encodeURIComponent(key)}`, { signal: AbortSignal.timeout(30000) });
    if (!response.ok) throw new Error(`快手封面读取失败：HTTP ${response.status}`);
    const blob = await response.blob();
    const actual = await createImageBitmap(blob);
    const original = new Image();
    original.src = expected;
    await original.decode();
    const pixels = image => {
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, 64, 64);
      return context.getImageData(0, 0, 64, 64).data;
    };
    const left = pixels(original), right = pixels(actual);
    let difference = 0;
    for (let index = 0; index < left.length; index++) {
      if (index % 4 !== 3) difference += Math.abs(left[index] - right[index]);
    }
    const dataUrl = await new Promise(resolve => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.readAsDataURL(blob);
    });
    return { width: actual.width, height: actual.height, difference: difference / (64 * 64 * 3), dataUrl };
  }, body.data.coverKey, `data:image/png;base64,${fs.readFileSync(path.resolve(filename)).toString("base64")}`);
  const cover = { coverKey: body.data.coverKey, width: actual.width, height: actual.height,
    difference: actual.difference, httpStatus: receipt.httpStatus, result: body.result };
  console.log("[快手封面核验]", JSON.stringify(cover));
  if (Math.abs(actual.width / actual.height - 3 / 4) > 0.02 || actual.difference >= 18) {
    throw new Error("快手平台封面比例或内容与指定3:4封面不一致，尚未提交视频");
  }
  fs.writeFileSync(path.join(path.dirname(path.resolve(filename)), "kuaishou-cover-confirmed.jpg"), Buffer.from(actual.dataUrl.split(",")[1], "base64"));
  return cover;
}
