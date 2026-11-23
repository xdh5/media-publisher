import path from "path";
import fs from "fs";
import os from "os";
import crypto from "crypto";

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
  await clickText(page, "为进度条增加章节信息，让视频结构更清晰", "p");
  await page.waitForFunction(() => [...document.querySelectorAll("button")]
    .some(node => node.textContent.replace(/\s+/g, "") === "智能生成"), { timeout: 15000, polling: 100 });
  const completed = page.waitForResponse(async response => {
    if (new URL(response.url()).pathname !== "/aweme/v1/chapter/recommend/get" || !response.ok()) return false;
    const body = await response.json();
    return Array.isArray(body.chapter_list) && body.chapter_list.length > 0;
  }, { timeout: 600000 });
  await clickText(page, "智能生成");
  console.log("[dy] 已启动平台智能章节生成，等待章节推荐接口返回结果");
  const response = await completed;
  const body = await response.json();
  await page.waitForFunction(() => [...document.querySelectorAll("button")].some(node =>
    node.textContent.replace(/\s+/g, "") === "保存" && !node.disabled), { timeout: 15000, polling: 100 });
  await clickText(page, "保存");
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(node =>
    node.textContent.replace(/\s+/g, "") === "智能生成" && node.getBoundingClientRect().width > 0), { timeout: 15000, polling: 100 });
  console.log(`[dy] 智能章节已生成并保存：${body.chapter_list.length}章`);
  return { count: body.chapter_list.length, requestPath: "/aweme/v1/chapter/recommend/get", statusCode: body.status_code };

}

export { clickText };

async function uploadCoverImage(page, filename) {
  const input = await page.$("input.semi-upload-hidden-input");
  await input.uploadFile(path.resolve(filename));
  await page.waitForNetworkIdle({ idleTime: 500, timeout: 60000 });
}

export async function uploadDyCovers(page, landscape, portrait) {
  const landscapeFile = await prepareCover(page, landscape, false);
  const portraitFile = portrait ? await prepareCover(page, portrait, true) : null;
  const files = [landscapeFile, portraitFile].filter(Boolean);
  for (let index = 0; index < files.length; index++) {
    await page.evaluate(position => {
      document.querySelectorAll('[class^="coverControl-"] [class^="cover-"]:not([class^="cover-tip-"])')[position].click();
    }, index);
    await page.waitForSelector("input.semi-upload-hidden-input", { timeout: 15000 });
    await uploadCoverImage(page, files[index]);
    await clickText(page, "完成");
    await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(node =>
      node.textContent.trim() === "完成" && node.getBoundingClientRect().width > 0), { timeout: 60000, polling: 100 });
  }
  console.log("[dy] 自定义封面已上传并保存");
}

export async function configureDyPublication(page, data) {
  const options = data.publishOptions || {};
  const finance = data.phone === "finance";
  if (options.dyAiChapters || finance) data.dyChapters = await generateDyChapters(page);
  if (finance && (!options.coverPath || !options.portraitCoverPath)) {
    throw new Error("财经抖音发布必须提供横竖自定义封面");
  }
  if (options.coverPath) await uploadDyCovers(page, options.coverPath, options.portraitCoverPath);
}
