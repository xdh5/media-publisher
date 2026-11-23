import path from "path";
import fs from "fs";

export async function uploadSphCover(page, filename, share = false) {
  const selector = share ? ".horizon-cover-wrap" : ".vertical-cover-wrap";
  const heading = share ? "编辑分享卡片" : "编辑个人主页卡片";
  await page.evaluate(value => {
    const root = document.querySelector("wujie-app.wujie_iframe").shadowRoot;
    const container = root.querySelector(value);
    container.querySelector(".edit-btn").click();
  }, selector);
  await page.evaluate(() => {
    const root = document.querySelector("wujie-app.wujie_iframe").shadowRoot;
    const direct = [...root.querySelectorAll("button,div,span")].find(element =>
      element.childElementCount === 0 && element.textContent.trim() === "直接编辑" && element.getBoundingClientRect().width > 0);
    if (direct) direct.click();
  });
  await page.waitForFunction(title => {
    const root = document.querySelector("wujie-app.wujie_iframe").shadowRoot;
    return [...root.querySelectorAll(".edit-cover-dialog h3")].some(element =>
      element.textContent === title && element.getBoundingClientRect().width > 0);
  }, { timeout: 15000, polling: 100 }, heading);
  const expectedImage = `data:image/png;base64,${fs.readFileSync(path.resolve(filename)).toString("base64")}`;
  const input = await page.$('wujie-app.wujie_iframe >>> .single-cover-uploader-wrap > input[type="file"]');
  await input.uploadFile(path.resolve(filename));
  const expectedHash = await page.evaluate(async source => {
    const image = new Image();
    image.src = source;
    await image.decode();
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    return [...new Uint8Array(await crypto.subtle.digest("SHA-256", context.getImageData(0, 0, canvas.width, canvas.height).data))].join(",");
  }, expectedImage);
  await page.waitForFunction(async expected => {
    const image = document.querySelector("wujie-app.wujie_iframe").shadowRoot.querySelector(".single-cover-uploader-wrap .finish-wrap img");
    if (!image?.complete || !image.naturalWidth) return false;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", context.getImageData(0, 0, canvas.width, canvas.height).data))].join(",");
    return actual === expected;
  }, { timeout: 30000, polling: 500 }, expectedHash);
  await page.evaluate(title => {
    const root = document.querySelector("wujie-app.wujie_iframe").shadowRoot;
    const dialog = [...root.querySelectorAll(".weui-desktop-dialog")].find(element =>
      element.querySelector("h3")?.textContent === title && element.getBoundingClientRect().width > 0);
    [...dialog.querySelectorAll("button")].find(button => button.textContent.trim() === "确认" && !button.disabled).click();
  }, heading);
  await page.waitForFunction((value, ratio) => {
    const root = document.querySelector("wujie-app.wujie_iframe").shadowRoot;
    const image = root.querySelector(`${value} .vertical-img-size, ${value} .horizon-img-size`);
    const opened = [...root.querySelectorAll(".edit-cover-dialog > .weui-desktop-dialog__wrp")]
      .some(element => getComputedStyle(element).display !== "none");
    return !opened && image.complete &&
      Math.abs(image.naturalWidth / image.naturalHeight - ratio) < 0.02;
  }, { timeout: 60000, polling: 100 }, selector, share ? 4 / 3 : 3 / 4);
  console.log(`[sph] ${heading}已保存并校验比例`);
}

export async function uploadSphCovers(page, portrait, landscape) {
  await uploadSphCover(page, portrait);
  await uploadSphCover(page, landscape, true);
}
