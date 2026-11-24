import path from "path";
import fs from "fs";

export async function uploadSphCover(page, filename, share = false) {
  const selector = share ? ".horizon-cover-wrap" : ".vertical-cover-wrap";
  const heading = share ? "编辑分享卡片" : "编辑个人主页卡片";
  await page.evaluate(value => {
    const root = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document);
    const container = root.querySelector(value);
    container.querySelector(".edit-btn").click();
  }, selector);
  await page.waitForFunction(title => {
    const root = document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document;
    const dialogReady = [...root.querySelectorAll(".edit-cover-dialog h3")].some(element =>
      element.textContent === title && element.getBoundingClientRect().width > 0);
    const recommendation = [...root.querySelectorAll("button,div,span")].some(element =>
      element.childElementCount === 0 && element.textContent.trim() === "直接编辑" && element.getBoundingClientRect().width > 0);
    return dialogReady || recommendation;
  }, { timeout: 15000, polling: 100 }, heading);
  await page.evaluate(() => {
    const root = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document);
    const direct = [...root.querySelectorAll("button,div,span")].find(element =>
      element.childElementCount === 0 && element.textContent.trim() === "直接编辑" && element.getBoundingClientRect().width > 0);
    if (direct) direct.click();
  });
  await page.waitForFunction(title => {
    const root = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document);
    return [...root.querySelectorAll(".edit-cover-dialog h3")].some(element =>
      element.textContent === title && element.getBoundingClientRect().width > 0);
  }, { timeout: 15000, polling: 100 }, heading);
  const previousRemote = await page.evaluate(isShare => {
    const video = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document).querySelector(".cover-preview-wrap").__vue__.video;
    return isShare ? video.shareCoverUrl : video.coverUrl;
  }, share);
  const expectedImage = `data:image/png;base64,${fs.readFileSync(path.resolve(filename)).toString("base64")}`;
  const input = await page.$('wujie-app.wujie_iframe >>> .single-cover-uploader-wrap > input[type="file"]');
  const chooserReady = page.waitForFileChooser({ timeout: 15000 });
  await input.evaluate(element => element.click());
  await (await chooserReady).accept([path.resolve(filename)]);
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
    const image = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document).querySelector(".single-cover-uploader-wrap .finish-wrap img");
    if (!image?.complete || !image.naturalWidth) return false;
    const canvas = document.createElement("canvas");
    canvas.width = image.naturalWidth;
    canvas.height = image.naturalHeight;
    const context = canvas.getContext("2d");
    context.drawImage(image, 0, 0);
    const actual = [...new Uint8Array(await crypto.subtle.digest("SHA-256", context.getImageData(0, 0, canvas.width, canvas.height).data))].join(",");
    return actual === expected;
  }, { timeout: 30000, polling: 500 }, expectedHash);
  if (share) {
    await page.waitForFunction(() => {
      const editor = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document).querySelector(".edit-cover-dialog-container").__vue__;
      const renderer = editor.$refs.cropRef;
      const image = renderer?.$refs.croppieRefHorizon?.croppie?.elements.img;
      return !editor.isCroppieLoading && renderer?.isCroppieReady && image?.complete &&
        (image.naturalWidth || image.width) > 0 && (image.naturalHeight || image.height) > 0;
    }, { timeout: 30000, polling: 500 }).catch(() => {
      throw new Error("4:3封面原图尚未就绪，停止发表，未提交作品");
    });
  }
  await page.evaluate(title => {
    const root = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document);
    const dialog = [...root.querySelectorAll(".weui-desktop-dialog")].find(element =>
      element.querySelector("h3")?.textContent === title && element.getBoundingClientRect().width > 0);
    [...dialog.querySelectorAll("button")].find(button => button.textContent.trim() === "确认" && !button.disabled).click();
  }, heading);
  await page.waitForFunction((value, ratio) => {
    const root = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document);
    const image = root.querySelector(`${value} .vertical-img-size, ${value} .horizon-img-size`);
    const opened = [...root.querySelectorAll(".edit-cover-dialog > .weui-desktop-dialog__wrp")]
      .some(element => getComputedStyle(element).display !== "none");
    return !opened && image.complete &&
      Math.abs(image.naturalWidth / image.naturalHeight - ratio) < 0.02;
  }, { timeout: 60000, polling: 100 }, selector, share ? 4 / 3 : 3 / 4);
  await page.waitForFunction((isShare, previous) => {
    const component = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document).querySelector(".cover-preview-wrap").__vue__;
    const video = component.video;
    const url = isShare ? video.shareCoverUrl : video.coverUrl;
    const confirmed = isShare ? component.hasEditShareCover : component.hasEditProfileCover;
    return confirmed && /^https?:/.test(url || "") && url !== previous;
  }, { timeout: 60000, polling: 500 }, share, previousRemote);
  await verifySphRemoteCover(page, filename, share);

}

export async function verifySphRemoteCover(page, filename, share = false) {
  const heading = share ? "分享卡片4:3" : "个人主页卡片3:4";
  const expectedImage = `data:image/png;base64,${fs.readFileSync(path.resolve(filename)).toString("base64")}`;
  const remoteUrl = await page.evaluate(isShare => {
    const video = (document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document).querySelector(".cover-preview-wrap").__vue__.video;
    return isShare ? video.shareCoverUrl : video.coverUrl;
  }, share);
  const response = await fetch(remoteUrl, { signal: AbortSignal.timeout(30000) });
  if (!response.ok) throw new Error(`${heading}远端图片读取失败：HTTP ${response.status}`);
  const savedImage = Buffer.from(await response.arrayBuffer());
  const matches = await page.evaluate(async (expected, actual) => {
    const pixels = async source => {
      const image = new Image();
      image.src = source;
      await image.decode();
      const canvas = document.createElement("canvas");
      canvas.width = 64;
      canvas.height = 64;
      const context = canvas.getContext("2d");
      context.imageSmoothingQuality = "high";
      context.drawImage(image, 0, 0, 64, 64);
      return context.getImageData(0, 0, 64, 64).data;
    };
    const [left, right] = await Promise.all([pixels(expected), pixels(actual)]);
    let difference = 0;
    for (let index = 0; index < left.length; index++) {
      if (index % 4 !== 3) difference += Math.abs(left[index] - right[index]);
    }
    return difference / (64 * 64 * 3) < 18;
  }, expectedImage, `data:image/jpeg;base64,${savedImage.toString("base64")}`);
  if (!matches) throw new Error(`${heading}平台保存的图片与指定封面不一致，停止发表`);
  console.log(`[sph] ${heading}远端封面已保存并核对内容`);

}

export async function uploadSphCovers(page, portrait, landscape) {
  await uploadSphCover(page, portrait);
  await uploadSphCover(page, landscape, true);
}
