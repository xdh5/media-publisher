import fs from "fs";
import path from "path";

export async function clickToutiaoText(page, text) {
  const handle = await page.evaluateHandle(value => [...document.querySelectorAll("button,a,div,span,li")].find(element =>
    element.textContent.trim() === value && (element.tagName === "BUTTON" || ![...element.children].some(child => child.textContent.trim() === value)) &&
    element.getBoundingClientRect().width > 0 && !element.disabled), text);
  if (!handle.asElement()) throw new Error(`未找到头条按钮：${text}`);
  await handle.asElement().evaluate(element => element.click());
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

export async function uploadToutiaoArticleCover(page, filename) {
  await page.$eval('.article-cover label:first-child', element => element.click());
  await page.waitForFunction(() => !document.querySelector('.article-cover-images-wrap').classList.contains('multi-imgs'), { polling: 100 });
  const replace = await page.$('.article-cover-img-replace');
  if (replace) await replace.evaluate(element => element.click());
  else await page.$eval('.article-cover-images', element => element.click());
  await clickToutiaoText(page, "上传图片");
  const input = await page.waitForSelector('.btn-upload-handle input[type=file]', { timeout: 15000 });
  await input.uploadFile(path.resolve(filename));
  await page.waitForFunction(() => [...document.querySelectorAll('button')].some(element =>
    element.textContent.trim() === "确定" && !element.disabled && element.getBoundingClientRect().width > 0), { timeout: 60000, polling: 100 });
  await clickToutiaoText(page, "确定");
  await page.waitForFunction(() => ![...document.querySelectorAll('button')].some(element =>
    element.textContent.trim() === "本地上传" && element.getBoundingClientRect().width > 0), { timeout: 15000, polling: 100 });
  await page.waitForFunction(() => {
    const image = document.querySelector('.article-cover-img-wrap img');
    return image?.complete && image.naturalWidth > 0;
  }, { timeout: 15000, polling: 100 });
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
  await page.waitForSelector('textarea[placeholder*="文章标题"]', { timeout: 30000 });
  await page.evaluate(title => {
    const input = document.querySelector('textarea[placeholder*="文章标题"]');
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value").set.call(input, title);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  }, article.title);
  await clearToutiaoEditor(page);
  await page.evaluate(content => {
    const editor = document.querySelector('.ProseMirror[contenteditable="true"]');
    editor.focus();
    const clipboard = new DataTransfer();
    clipboard.setData("text/html", content);
    editor.dispatchEvent(new ClipboardEvent("paste", { clipboardData: clipboard, bubbles: true, cancelable: true }));
  }, html);
  await page.waitForFunction(() => new Set([...document.querySelectorAll('.ProseMirror img')].map(image => image.src).filter(source => source.startsWith('https://'))).size === 3, { timeout: 60000, polling: 250 });
  await setToutiaoCheckbox(page, "头条首发", true);
  await setToutiaoCheckbox(page, "同时发布微头条", false);
  return article;
}

export async function clearToutiaoEditor(page) {
  await page.$eval('.ProseMirror[contenteditable="true"]', editor => {
    editor.focus();
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(editor);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete");
  });
}
