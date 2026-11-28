import { setPublishStage } from "../publishStage.js";
import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";
import { pollPageUntil } from "./publishPageWait.js";
import { runWithDyResponse, requireDySuccess } from "./dyApiResponses.js";

async function prepareCover(page, filename, portrait) {
  const source = fs.readFileSync(path.resolve(filename));
  const key = crypto.createHash("sha256").update(source).update(String(portrait)).digest("hex");
  const directory = path.join(os.tmpdir(), "media-publisher-douyin-covers");
  fs.mkdirSync(directory, { recursive: true });
  const output = path.join(directory, `${key}.png`);
  const encoded = await page.evaluate(async (data, vertical) => {
    const image = new Image();
    image.src = data;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = vertical ? 1080 : 1440;
    canvas.height = vertical ? 1440 : 1080;
    const context = canvas.getContext("2d");
    context.fillStyle = "#202020";
    context.fillRect(0, 0, canvas.width, canvas.height);
    const scale = Math.min(canvas.width / image.width, canvas.height / image.height);
    const width = image.width * scale, height = image.height * scale;
    context.drawImage(image, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
    return canvas.toDataURL("image/png").split(",")[1];
  }, `data:image/png;base64,${source.toString("base64")}`, portrait);
  fs.writeFileSync(output, Buffer.from(encoded, "base64"));
  return output;
}

async function clickText(page, text, selector = "button") {
  const clicked = await page.evaluate((value, elements) => {
    const node = [...document.querySelectorAll(elements)].find(element =>
      element.textContent.replace(/\s+/g, "") === value &&
      element.getBoundingClientRect().width > 0 && !element.disabled);
    if (!node) return false;
    node.click();
    return true;
  }, text, selector);
  if (!clicked) throw new Error(`未找到抖音「${text}」可用按钮`);
}

export async function generateDyChapters(page) {
  setPublishStage(page, "打开抖音智能章节编辑器");
  await clickText(page, "为进度条增加章节信息，让视频结构更清晰", "p");
  await page.waitForFunction(() => [...document.querySelectorAll("button")]
    .some(node => node.textContent.replace(/\s+/g, "") === "智能生成"), { timeout: 0, polling: 100 });
  const completed = await runWithDyResponse(page, "智能章节推荐结果", async response => {
    if (new URL(response.url()).pathname !== "/aweme/v1/chapter/recommend/get") return false;
    if (!response.ok()) return true;
    const result = await response.json();
    return result.status_code !== 0 || (Array.isArray(result.chapter_list) && result.chapter_list.length > 0);
  }, async () => {
    const started = await runWithDyResponse(page, "启动智能章节生成", response =>
      new URL(response.url()).pathname === "/aweme/v1/chapter/recommend/post" && response.request().method() === "POST",
    () => clickText(page, "智能生成"));
    requireDySuccess(started, "启动智能章节生成");
    setPublishStage(page, "等待抖音智能章节推荐接口返回");
  });
  const body = requireDySuccess(completed, "智能章节推荐结果");
  console.log(`[dy] 推荐接口已返回${body.chapter_list.length}章，等待页面允许保存`);
  setPublishStage(page, "将抖音智能章节推荐结果填入编辑器");
  // 接口结果写入推荐缓存后，编辑器可能仍保留空列表；再次触发智能生成应用已有结果。
  await page.waitForTimeout(4000);
  const ready = await page.evaluate(() => [...document.querySelectorAll("button")].some(node =>
    node.textContent.trim() === "保存" && !node.disabled && node.getBoundingClientRect().width > 0));
  if (!ready) {
    await clickText(page, "智能生成");
    console.log("[dy] 已再次触发智能生成，等待推荐章节填入编辑器");
  }
  await pollPageUntil(page, () => {
    const dialog = [...document.querySelectorAll('[role="dialog"]')].find(node =>
      node.getBoundingClientRect().width > 0 && node.textContent.includes("章节要点"));
    return !!dialog && /章节数[：:]?\s*[1-9]\d*/.test(dialog.innerText) &&
      [...dialog.querySelectorAll("button")].some(node => node.textContent.trim() === "保存" && !node.disabled);
  }, undefined, 250);
  console.log("[抖音章节编辑器就绪]", JSON.stringify(await page.evaluate(() => ({
    chapterCount: Number(document.body.innerText.match(/章节数[：:]?\s*(\d+)/)?.[1] || 0),
    saveEnabled: [...document.querySelectorAll("button")].some(node => node.textContent.trim() === "保存" &&
      !node.disabled && node.getBoundingClientRect().width > 0),
  }))));
  await clickText(page, "保存");
  setPublishStage(page, "保存抖音智能章节并等待编辑器关闭");
  console.log("[dy] 已点击章节保存，等待编辑器关闭");
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(node =>
    node.textContent.replace(/\s+/g, "") === "智能生成" && node.getBoundingClientRect().width > 0), { timeout: 0, polling: 100 });
  console.log(`[dy] 智能章节已生成并保存：${body.chapter_list.length}章`);
  return { count: body.chapter_list.length, requestPath: "/aweme/v1/chapter/recommend/get", statusCode: body.status_code };

}

export { clickText };

async function uploadCoverImage(page, filename) {
  const input = await page.waitForSelector('.dy-creator-content-modal .semi-upload:has(.semi-upload-drag-area-main-text) input.semi-upload-hidden-input', { timeout: 0 });
  const receipt = await runWithDyResponse(page, "封面图片上传确认", response => {
    const url = new URL(response.url());
    return ["imagex.bytedanceapi.com", "open.bytedanceapi.com"].includes(url.hostname) &&
      url.searchParams.get("Action") === "CommitImageUpload" && response.request().method() === "POST";
  }, () => input.uploadFile(path.resolve(filename)));
  const error = receipt.body.ResponseMetadata.Error;
  if (error) throw new Error(`封面图片上传失败：${error.Code}，${error.Message}`);
  const uploaded = receipt.body.Result.Results;
  console.log("[抖音封面上传回执]", JSON.stringify(uploaded.map(item => ({ uri: item.Uri, statusCode: item.UriStatus }))));
  if (!uploaded.length || uploaded.some(item => !item.Uri || ![200, 2000].includes(item.UriStatus))) {
    throw new Error("封面上传确认接口未返回成功的图片URI");
  }
  return { requestPath: receipt.requestPath, httpStatus: receipt.httpStatus,
    images: uploaded.map(item => ({ uri: item.Uri, statusCode: item.UriStatus })) };
}

export async function uploadDyCovers(page, landscape, portrait) {
  setPublishStage(page, "准备抖音横竖封面文件");
  const landscapeFile = await prepareCover(page, landscape, false);
  const portraitFile = portrait ? await prepareCover(page, portrait, true) : null;
  const files = [landscapeFile, portraitFile].filter(Boolean);
  const receipts = [];
  for (let index = 0; index < files.length; index++) {
    setPublishStage(page, index === 0 ? "上传并保存抖音横版封面" : "上传并保存抖音竖版封面");
    const ratio = index === 0 ? "4:3" : "3:4";
    await page.evaluate(expected => {
      const normalize = value => String(value || "").replace(/\s+/g, "").replace(/：/g, ":");
      const other = expected === "4:3" ? "3:4" : "4:3";
      const labels = [...document.querySelectorAll('[class*="coverControl-"], [class*="coverControl-"] *')]
        .filter(node => normalize(node.textContent).includes(expected) && !normalize(node.textContent).includes(other) && node.getBoundingClientRect().width > 0)
        .sort((left, right) => left.textContent.length - right.textContent.length);
      for (const label of labels) {
        let card = label;
        while (card && !normalize(card.textContent).includes(other)) {
          const trigger = card.querySelector('[class^="cover-"]:not([class^="cover-tip-"])');
          if (trigger && trigger.getBoundingClientRect().width > 0) {
            trigger.click();
            return;
          }
          card = card.parentElement;
        }
      }
      throw new Error(`未找到抖音 ${expected} 封面入口`);
    }, ratio);
    await page.waitForSelector(".dy-creator-content-modal", { visible: true, timeout: 0 });
    await page.evaluate(vertical => {
      const editor = document.querySelector(".dy-creator-content-modal");
      const label = vertical ? "设置竖封面" : "设置横封面";
      const tab = [...editor.querySelectorAll("button,span,div")].find(node =>
        node.textContent.trim() === label && node.getBoundingClientRect().width > 0);
      if (tab) tab.click();
    }, index !== 0);
    await page.waitForTimeout(800);
    console.log("[抖音封面文件]", JSON.stringify({ ratio, file: files[index] }));
    setPublishStage(page, index === 0 ? "上传抖音横版封面图片" : "上传抖音竖版封面图片");
    const receipt = await uploadCoverImage(page, files[index]);
    receipts.push({ orientation: index === 0 ? "landscape" : "portrait", ...receipt });
    setPublishStage(page, index === 0 ? "保存抖音横版封面并等待编辑器关闭" : "保存抖音竖版封面并等待编辑器关闭");
    await page.waitForFunction(() => [...document.querySelectorAll('.dy-creator-content-modal button')]
      .some(button => button.textContent.trim() === "完成" && !button.disabled &&
        button.getAttribute("aria-disabled") !== "true" && !button.classList.contains("semi-button-disabled") &&
        button.getBoundingClientRect().width > 0), { timeout: 0, polling: 250 });
    await clickText(page, "完成");
    await pollPageUntil(page, () => {
      const buttons = [...document.querySelectorAll("button")];
      const guide = [...document.querySelectorAll("button, [role='button'], span")].find(node => node.textContent.trim() === "暂不设置" && node.getBoundingClientRect().width > 0);
      if (guide) guide.click();
      return !buttons.some(node => node.textContent.trim() === "完成" && node.getBoundingClientRect().width > 0);
    }, undefined, 250);
  }
  console.log("[dy] 自定义封面已上传并保存");
  return receipts;
}

export async function configureDyPublication(page, data) {
  const options = data.publishOptions || {};
  if (options.dyAiChapters) data.dyChapters = await generateDyChapters(page);
  if (options.coverPath) data.dyCovers = await uploadDyCovers(page, options.coverPath, options.portraitCoverPath);
}
