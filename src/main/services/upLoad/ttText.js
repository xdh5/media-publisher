import { setPublishStage } from "../publishStage.js";
import fs from "fs";
import path from "path";
import { uploadToutiaoImages } from "./ttApiResponses.js";

export async function waitToutiaoArticleImagesReady(page, imageCount) {
  await page.evaluate(() => {
    for (const image of document.querySelectorAll('.ProseMirror img')) image.loading = 'eager';
  });
  console.log('[头条文章图片状态]', JSON.stringify(await page.evaluate(() => ({
    bodyImages: [...document.querySelectorAll('.ProseMirror img')].map(image => ({ complete: image.complete, width: image.naturalWidth, sourceType: image.src.split(':')[0] })),
    coverCount: document.querySelectorAll('.article-cover-img-wrap img').length,
  }))));
  await page.waitForFunction(expected => {
    const bodyImages = [...document.querySelectorAll('.ProseMirror img')];
    const ready = image => image.complete && image.naturalWidth > 0 && image.naturalHeight > 0;
    const source = image => new URL(image.currentSrc || image.src).pathname.split('~')[0];
    const bodySources = new Set(bodyImages.filter(ready).map(source));
    return bodySources.size === expected;
  }, { timeout: 120000, polling: 250 }, imageCount).catch(async () => {
    const state = await page.evaluate(() => ({
      bodyImages: [...document.querySelectorAll('.ProseMirror img')].map(image => ({ complete: image.complete, width: image.naturalWidth, sourceType: image.src.split(':')[0] })),
      coverImages: document.querySelectorAll('.article-cover-img-wrap img').length,
      uploading: document.querySelectorAll('.ProseMirror .byte-spin-spinning').length,
    }));
    throw new Error(`头条文章图片未就绪：${JSON.stringify(state)}`);
  });
  console.log('[tt-article] 三张正文图片已加载，上传网络请求已完成');
}

export async function clickToutiaoText(page, text, clickCount = 1) {
  await page.waitForFunction(value => [...document.querySelectorAll("button,a,div,span,li")].some(element =>
    element.textContent.trim() === value && element.getBoundingClientRect().width > 0 && !element.disabled),
  { timeout: 15000, polling: 100 }, text);
  const handle = await page.evaluateHandle(value => [...document.querySelectorAll("button,a,div,span,li")].find(element =>
    element.textContent.trim() === value && (element.tagName === "BUTTON" || ![...element.children].some(child => child.textContent.trim() === value)) &&
    element.getBoundingClientRect().width > 0 && !element.disabled), text);
  if (!handle.asElement()) throw new Error(`未找到头条按钮：${text}`);
  if (clickCount === 1) await handle.asElement().evaluate(element => element.click());
  else await handle.asElement().click({ clickCount, delay: 200 });
}

export async function setToutiaoCheckbox(page, label, checked) {
  const state = await page.evaluate(text => {
    const leaf = [...document.querySelectorAll("label,span,div")].find(element => element.childElementCount === 0 && element.textContent.trim() === text);
    let container = leaf;
    while (container && !container.querySelector('input[type="checkbox"]')) container = container.parentElement;
    const input = container?.querySelector('input[type="checkbox"]');
    if (!input) throw new Error(`未找到头条选项：${text}`);
    const target = input.closest("label");
    target.setAttribute("data-toutiao-option", text);
    return target.classList.contains("byte-checkbox-checked");
  }, label);
  if (state !== checked) await page.evaluate(text => document.querySelector(`[data-toutiao-option="${text}"]`).click(), label);
  await page.waitForFunction((text, value) => document.querySelector(`[data-toutiao-option="${text}"]`)
    .classList.contains("byte-checkbox-checked") === value, { timeout: 10000, polling: 100 }, label, checked);
}

function escapeText(text) {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export async function fillToutiaoArticle(page, manifestPath) {
  const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
  const filename = path.resolve(manifest.toutiao_article_path);
  const article = JSON.parse(fs.readFileSync(filename, "utf8"));
  const html = article.paragraphs.map(row => {
    let result = `<p>${escapeText(row.text)}</p>`;
    if (row.image) {
      const image = fs.readFileSync(path.join(path.dirname(filename), row.image)).toString("base64");
      result += `<p><img src="data:image/png;base64,${image}"></p>`;
    }
    return result;
  }).join("");
  setPublishStage(page, "填写头条文章标题");
  await page.waitForSelector('textarea[placeholder*="文章标题"]', { timeout: 30000 });
  await page.evaluate(title => {
    const input = document.querySelector('textarea[placeholder*="文章标题"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, article.title);
  setPublishStage(page, "填写头条文章正文和指定插图");
  await clearToutiaoEditor(page);
  await uploadToutiaoImages(page, '头条文章正文插图上传', article.paragraphs.filter(row => row.image).length, () => page.evaluate(content => {
    const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
    editor.focus();
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", content);
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, html));
  setPublishStage(page, "等待头条文章插图上传完成");
  await waitToutiaoArticleImagesReady(page, article.paragraphs.filter(row => row.image).length);
  setPublishStage(page, "设置头条首发和同步微头条选项");
  await setToutiaoCheckbox(page, "头条首发", manifest.publish_options.first_publish);
  await setToutiaoCheckbox(page, "同时发布微头条", manifest.publish_options.sync_micro);
  return article;
}

export async function clearToutiaoEditor(page) {
  await page.focus('.ProseMirror[contenteditable="true"]');
  await page.keyboard.down("Control");
  await page.keyboard.press("KeyA");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.waitForFunction(() => {
    const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
    return editor.querySelectorAll("img").length === 0 &&
      !editor.innerText.replace(/请输入正文|有什么新鲜事想告诉大家？/g, "").trim();
  }, { timeout: 10000, polling: 100 });
}
