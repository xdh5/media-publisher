import path from "path";
import { setDialogSchedule } from "./officialSchedule/dialog.js";
import { setPublishStage } from "../publishStage.js";
import fs from "fs";
import { fillToutiaoArticle, setToutiaoCheckbox, clickToutiaoText, waitToutiaoArticleImagesReady } from "./ttText.js";
import { saveToutiaoPublicationResult } from "./ttPublishResult.js";
import { submitToutiaoContent } from "./ttApiResponses.js";
import { runWithPublishResponse } from "../publishApiResponse.js";

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
        is_app_preview: form.get("is_app_preview"),
        ...(response.request().toutiaoSubmittedTiming || { timer_status: form.get("timer_status"), timer_time: form.get("timer_time") }),
        cover_type: JSON.parse(form.get('draft_form_data') || '{}').coverType,
        code: body.code, message: body.message };
      fs.appendFileSync(path.join(manifest.output_dir, "toutiao-article-save-events.jsonl"), JSON.stringify(record) + "\n");
      console.log("[头条文章保存请求]", JSON.stringify(record));
    } catch (error) {
      console.log("[头条文章保存请求记录失败]", error.message);
    }
  });
  setPublishStage(page, "打开头条文章发布页");
  await page.goto("https://mp.toutiao.com/profile_v4/graphic/publish", { waitUntil: "domcontentloaded" });
  await page.waitForSelector('textarea[placeholder*="文章标题"]', { timeout: 0 });
  const assistantClose = await page.$(".ai-assistant-panel:not(.hidden-ai-assistant-panel) .close-btn");
  if (assistantClose) {
    const box = await assistantClose.boundingBox();
    if (box) {
      setPublishStage(page, "模拟鼠标点击关闭头条文章创作助手");
      await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
      await page.waitForFunction(() => ![...document.querySelectorAll(".ai-assistant-panel:not(.hidden-ai-assistant-panel)")]
        .some(node => node.getBoundingClientRect().width > 0), { timeout: 0, polling: 100 });
    }
  }
  setPublishStage(page, "填写头条文章标题、正文和插图");
  const article = await fillToutiaoArticle(page, filename);
  const imageCount = article.paragraphs.filter(row => row.image).length;
  setPublishStage(page, "设置头条文章引用AI声明");
  await setToutiaoCheckbox(page, "引用AI", manifest.publish_options.quote_ai);
  setPublishStage(page, "设置头条文章无封面");
  const selectNoCover = async () => {
    await page.evaluate(() => [...document.querySelectorAll('.article-cover .byte-radio-inner-text')]
      .find(node => node.textContent.trim() === '无封面').click());
    await page.waitForFunction(() => [...document.querySelectorAll('.article-cover label')].some(node =>
      node.textContent.trim() === '无封面' && node.querySelector('.byte-radio-inner.checked')),
    { timeout: 0, polling: 100 });
  };
  await selectNoCover();
  setPublishStage(page, "等待头条文章正文图片上传完成");
  await waitToutiaoArticleImagesReady(page, imageCount);
  const scheduled = data.officialScheduledPublish;
  const preview = !scheduled && await page.evaluate(() => [...document.querySelectorAll('button')].some(element =>
    element.textContent.trim() === '预览并发布' && element.getBoundingClientRect().width > 0));
  const runPreview = action => runWithPublishResponse(page, '头条文章预览', response => {
    if (response.request().method() !== 'POST' || new URL(response.url()).pathname !== '/mp/agw/article/publish') return false;
    return new URLSearchParams(response.request().postData()).get('is_app_preview') === '1';
  }, action);
  let previewReceipt;
  if (scheduled) {
    const [day, time] = data.publishAt.split(" ");
    const schedule = { minute: day + " " + time.slice(0, 5),
      monthDay: `${Number(day.slice(5, 7))}月${Number(day.slice(-2))}日`,
      hour: String(Number(time.slice(0, 2))), minuteValue: String(Number(time.slice(3, 5))) };
    setPublishStage(page, "打开头条文章官方预约弹窗并预览");
    previewReceipt = await runPreview(() => setDialogSchedule(page, "头条", schedule, true));
  }
  setPublishStage(page, "预览头条文章并等待确认发布按钮");
  if (preview && !scheduled) {
    previewReceipt = await runPreview(() => clickToutiaoText(page, "预览并发布"));
  }
  if (previewReceipt && ![0, 7050].includes(previewReceipt.body.code)) {
    throw new Error(`头条文章预览失败：${previewReceipt.body.message || previewReceipt.body.code}，未执行正式发布`);
  }
  if (previewReceipt?.body.code === 7050) {
    console.log('[头条文章预览] 忽略预览保存失败7050，继续确认发布，等待正式提交回执');
  }
  if (scheduled || preview) await page.waitForFunction(() => [...document.querySelectorAll('button')].some(element =>
    element.textContent.trim() === "确认发布" && !element.disabled && element.getBoundingClientRect().width > 0),
  { timeout: 0, polling: 100 });
  await waitToutiaoArticleImagesReady(page, imageCount);
  // 预览和插图处理可能重新选择三图，正式提交前以组件状态再次确认无封面。
  await selectNoCover();
  await page.screenshot({ path: path.join(manifest.output_dir, 'toutiao-article-preview.png') });
  setPublishStage(page, "确认发布头条文章");
  await submitToutiaoContent(page, data, "article", () =>
    clickToutiaoText(page, scheduled || preview ? "确认发布" : "发布"));
  return saveToutiaoPublicationResult(page, data, manifest, "article", event, window);
}
