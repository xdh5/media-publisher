import path from "path";

export async function uploadKsCover(page, filename) {
  await page.evaluate(() => document.querySelector('[class*="_cover-full-editor_"]').click());
  await page.waitForFunction(() => [...document.querySelectorAll("div")].some(element =>
    element.childElementCount === 0 && element.textContent.trim() === "上传封面"), { timeout: 15000, polling: 100 });
  await page.evaluate(() => [...document.querySelectorAll("div")].find(element =>
    element.childElementCount === 0 && element.textContent.trim() === "上传封面").click());
  const clear = await page.$('[class*="_cropper-upload-clear_"]');
  if (clear) await clear.click();
  const input = await page.waitForSelector('[class*="_cropper-upload-upload_"] input[type="file"]', { timeout: 15000 });
  await input.uploadFile(path.resolve(filename));
  await page.waitForSelector('[class*="_cropper-upload-clear_"]', { timeout: 30000 });
  await page.evaluate(() => {
    [...document.querySelectorAll('[class*="_ratio-item_"]')].find(element =>
      element.querySelector("span")?.textContent === "3:4").click();
    [...document.querySelectorAll("button")].find(element => element.textContent.trim() === "确认").click();
  });
  await page.waitForFunction(() => ![...document.querySelectorAll("button")].some(element =>
    element.textContent.trim() === "确认" && element.getBoundingClientRect().width > 0), { timeout: 60000, polling: 100 });
  console.log("[ks] 3:4自定义封面已上传并确认");
}
