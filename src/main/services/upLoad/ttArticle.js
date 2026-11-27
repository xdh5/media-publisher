import path from "path";
import { setDialogSchedule } from "./officialSchedule/dialog.js";
import { setPublishStage } from "../publishStage.js";
import fs from "fs";
import { fillToutiaoArticle, setToutiaoCheckbox, clickToutiaoText, waitToutiaoArticleImagesReady } from "./ttText.js";
import { saveToutiaoPublicationResult } from "./ttPublishResult.js";
import { submitToutiaoContent } from "./ttApiResponses.js";

export async function publishToutiaoArticle(page, data, window, event) {
  const filename = data.publishOptions.toutiaoManifestPath;
  const manifest = JSON.parse(fs.readFileSync(filename, "utf8"));
  // 只记录保存请求的元数据，用于区分页面自动保存和发布器提交。
  page.on("response", async response => {
    if (response.request().method() !== "POST" || new URL(response.url()).pathname !== "/mp/agw/article/publish") return;
    try {
      const form = new URLSearchParams(response.request().postData());
      const body = await response.json();
      const record = { time: new Date().toISOString(), save: form.get("save"),
        timer_status: form.get("timer_status"), timer_time: form.get("timer_time"),
        code: body.code, message: body.message };
      fs.appendFileSync(path.join(manifest.output_dir, "toutiao-article-save-events.jsonl"), JSON.stringify(record) + "\n");
      console.log("[头条文章保存请求]", JSON.stringify(record));
    } catch (error) {
      console.log("[头条文章保存请求记录失败]", error.message);
    }
  });
  setPublishStage(page, "打开头条文章发布页");
  await page.goto("https://mp.toutiao.com/profile_v4/graphic/publish", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('textarea[placeholder*="文章标题"]', { timeout: 30000 });
  const assistantClose = await page.$(".ai-assistant-panel:not(.hidden-ai-assistant-panel) .close-btn");
  if (assistantClose) {
    const box = await assistantClose.boundingBox();
    if (box) {
      setPublishStage(page, "模拟鼠标点击关闭头条文章创作助手");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => ![...document.querySelectorAll(".ai-assistant-panel:not(.hidden-ai-assistant-panel)")]
        .some(node => node.getBoundingClientRect().width > 0), { timeout: 10000, polling: 100 });
    }
  }
  setPublishStage(page, "填写头条文章标题、正文和插图");
  const article = await fillToutiaoArticle(page, filename);
  const imageCount = article.paragraphs.filter(row => row.image).length;
  setPublishStage(page, "设置头条文章引用AI声明");
  await setToutiaoCheckbox(page, "引用AI", manifest.publish_options.quote_ai);
  setPublishStage(page, "设置头条文章无封面");
  const noCover = await page.evaluateHandle(() => [...document.querySelectorAll(".article-cover label")]
    .find(node => node.textContent.trim() === "无封面"));
  await noCover.asElement().click();
  await page.waitForFunction(() => document.querySelector('.article-cover input[value="1"]')?.checked,
    { timeout: 10000, polling: 100 });
  setPublishStage(page, "等待头条文章正文图片上传完成");
  await waitToutiaoArticleImagesReady(page, imageCount);
  const scheduled = data.officialScheduledPublish;
  let schedule;
  if (scheduled) {
    const [day, time] = data.publishAt.split(" ");
    schedule = { minute: day + " " + time.slice(0, 5),
      monthDay: `${Number(day.slice(5, 7))}月${Number(day.slice(-2))}日`,
      hour: String(Number(time.slice(0, 2))), minuteValue: String(Number(time.slice(3, 5))) };
    setPublishStage(page, "打开头条文章官方预约弹窗并预览");
    await setDialogSchedule(page, "头条", schedule, true);
  }
  setPublishStage(page, "预览头条文章并等待确认发布按钮");
  const preview = await page.evaluate(() => [...document.querySelectorAll('button')].some(element =>
    element.textContent.trim() === '预览并发布' && element.getBoundingClientRect().width > 0));
  if (preview && !scheduled) {
    await clickToutiaoText(page, "预览并发布");
    await page.waitForFunction(() => [...document.querySelectorAll('button')].some(element =>
      element.textContent.trim() === "确认发布" && !element.disabled), { timeout: 60000, polling: 100 });
  }
  await waitToutiaoArticleImagesReady(page, imageCount);
  setPublishStage(page, "确认发布头条文章");
  await submitToutiaoContent(page, data, "article", () => scheduled
    ? setDialogSchedule(page, "头条", schedule, true)
    : clickToutiaoText(page, preview ? "确认发布" : "发布", preview ? 2 : 1));
  return saveToutiaoPublicationResult(page, data, manifest, "article", event, window);
}
