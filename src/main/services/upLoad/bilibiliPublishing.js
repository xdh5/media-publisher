import { setPublishStage } from "../publishStage.js";
import fs from 'fs';
import path from 'path';
import { pollPageUntil } from "./publishPageWait.js";

export async function waitBilibiliElement(page, selector) {
  while (!page.isClosed()) {
    const node = await page.$(selector);
    if (node) return node;
    await page.waitForTimeout(200);
  }
  throw new Error(`发布页面已关闭，停止等待B站控件：${selector}`);
}

export async function clickBilibiliText(page, text) {
  const matches = await page.$x(`//*[normalize-space(.)=${JSON.stringify(text)}]`);
  for (const handle of matches.reverse()) {
    const visible = await handle.evaluate(e => e.getBoundingClientRect().width > 0);
    if (visible) { await handle.evaluate(e => e.click()); return; }
  }
  throw new Error(`B站未找到可见控件：${text}`);
}

export async function selectBilibiliCategory(page, category) {
  if (!category) return;
  const trigger = await waitBilibiliElement(page, '.video-human-type .select-controller');
  await trigger.evaluate(e => e.click());
  await page.waitForFunction(text => [...document.querySelectorAll('div,span,p')].some(e => e.childElementCount === 0 && e.textContent.trim() === text && e.getBoundingClientRect().width > 0), { polling: 200, timeout: 0 }, category);
  await clickBilibiliText(page, category);
  await page.waitForFunction(text => document.querySelector('.video-human-type .select-container')?.textContent.includes(text), { polling: 200, timeout: 0 }, category);
}

export async function uploadBilibiliCover(page, filename, widescreen) {
  setPublishStage(page, '上传B站首页封面');
  await page.$eval('.cover-main .cover-empty,.cover-main .cover-img', e => e.click());
  const input = await waitBilibiliElement(page, '.cover-editor-panel input[type=file]');
  await page.$eval('.sync-checkbox-wrapper', root => {
    if (root.querySelector('input').checked) root.querySelector('label').click();
  });
  await input.uploadFile(path.resolve(filename));
  await page.waitForFunction(() => !!document.querySelector('.cover-editor-panel .upload-area.has-image'), { polling: 200, timeout: 0 });
  if (widescreen) {
    setPublishStage(page, '上传B站个人空间封面');
    await clickBilibiliText(page, '个人空间封面（16:9）');
    const wideInput = await waitBilibiliElement(page, '.cover-editor-panel input[type=file]');
    await wideInput.uploadFile(path.resolve(widescreen));
    await page.waitForFunction(() => !!document.querySelector('.cover-editor-panel .upload-area.has-image'), { polling: 200, timeout: 0 });
  }
  console.log('[blbl] 双比例封面已载入，保存封面');
  setPublishStage(page, '保存B站封面并等待编辑器关闭');
  await clickBilibiliText(page, '完成');
  await page.waitForFunction(() => !document.querySelector('.cover-main .cover-empty') && !!document.querySelector('.cover-main .cover-img'), { polling: 200, timeout: 0 });
}

export async function generateBilibiliChapters(page) {
  setPublishStage(page, '打开B站章节编辑器');
  const [more] = await page.$x("//span[contains(@class,'label') and starts-with(normalize-space(.),'更多设置')]");
  if (more) await more.evaluate(e => e.click());
  await clickBilibiliText(page, '编辑章节');
  const iframe = await waitBilibiliElement(page, '.chapter-setting iframe.iframe-wrp');
  const editor = await iframe.contentFrame();
  let lastChapterState = '';
  const framePoll = { isClosed: () => page.isClosed(), evaluate: async fn => {
    // 持续接收平台章节结果，由通用监控判断页面是否停滞。
    await editor.evaluate(timeout => {
      for (const element of document.querySelectorAll('*')) {
        const component = element.__vue__;
        if (component && 'aiTimeoutTime' in component) component.aiTimeoutTime = timeout;
      }
    }, Number.MAX_SAFE_INTEGER);
    const state = await editor.evaluate(() => ({ text: document.body.innerText.split('\n').filter(line => !/^\d{2}:\d{2}$/.test(line)).join('\n'),
      buttons: [...document.querySelectorAll('button,[role=button]')].filter(e => e.getBoundingClientRect().width > 0)
        .map(e => ({ text: e.innerText, disabled: e.disabled })) }));
    const serialized = JSON.stringify(state);
    if (serialized !== lastChapterState) {
      console.log('[B站章节状态]', serialized);
      lastChapterState = serialized;
    }
    const percentage = state.text.match(/(?:^|\n)(\d+)%/);
    if (percentage) setPublishStage(page, `生成B站智能章节（${percentage[1]}%）`);
    return editor.evaluate(fn);
  }, waitForTimeout: ms => page.waitForTimeout(ms) };
  await pollPageUntil(framePoll, () => /智能/.test(document.body.innerText), undefined, 500);
  console.log('[blbl] 章节编辑器：' + await editor.evaluate(() => document.body.innerText));
  const chapterResponse = async response => {
    try {
      if (response.request().frame() !== editor || !response.headers()['content-type']?.includes('json')) return;
      const body = await response.json();
      console.log('[B站章节接口]', JSON.stringify({ path: new URL(response.url()).pathname,
        httpStatus: response.status(), code: body.code, message: body.message,
        dataFields: Object.keys(body.data || {}), status: body.data?.status, state: body.data?.state }));
    } catch (error) {
      console.log('[B站章节接口采样失败]', error.message);
    }
  };
  page.on('response', chapterResponse);
  setPublishStage(page, '生成B站智能章节');
  await clickBilibiliText(editor, '智能生成');
  console.log('[B站章节主页面提示]', await page.evaluate(() => [...document.querySelectorAll('[role=dialog],.bili-dialog,.bili-modal')]
    .filter(e => e.getBoundingClientRect().width > 0).map(e => e.innerText)));
  await pollPageUntil(framePoll, () => /章节数[：:]?\s*[1-9]\d*/.test(document.body.innerText) && !/智能分析中/.test(document.body.innerText), undefined, 1000);
  const chapters = await editor.evaluate(() => ({ count: Number(document.body.innerText.match(/章节数[：:]?\s*(\d+)/)[1]),
    titles: [...document.querySelectorAll('input,textarea')].map(e => e.value.trim()).filter(text => text && !/^[\d:.]+$/.test(text)) }));
  setPublishStage(page, '保存B站智能章节');
  await clickBilibiliText(editor, '保存');
  await page.waitForFunction(() => ![...document.querySelectorAll('.chapter-setting iframe')].some(e => e.getBoundingClientRect().width > 0), { polling: 200, timeout: 0 });
  page.off('response', chapterResponse);
  return chapters;
}

const scheduledRequests = new WeakMap();

export async function setBilibiliSchedule(page, text) {
  setPublishStage(page, '设置B站官方预约时间');
  const timestamp = new Date(text.replace(' ', 'T') + '+08:00').getTime() / 1000;
  const seconds = timestamp - Date.now() / 1000;
  if (seconds < 300 || seconds > 15 * 86400) throw new Error('B站预约时间须在5分钟至15天之间');
  await page.setRequestInterception(true);
  const state = { timestamp, submitted: null };
  scheduledRequests.set(page, state);
  page.on('request', request => {
    if (request.isInterceptResolutionHandled()) return;
    if (request.method() === 'POST' && /\/x\/vu\/web\/(add|edit)(\/|\?|$)/.test(request.url())) {
      const payload = { ...JSON.parse(request.postData()), dtime: timestamp };
      state.submitted = payload;
      request.continue({ postData: JSON.stringify(payload) });
    } else {
      request.continue();
    }
  });
  console.log('[blbl] 平台预约时间：' + text);
}

export async function submitBilibiliVideo(page, data) {
  setPublishStage(page, '提交B站投稿并等待接口回执');
  const response = page.waitForResponse(r => r.request().method() === 'POST' && /\/x\/vu\/web\/(add|edit)(\/|\?|$)/.test(r.url()), { timeout: 0 });
  await page.$eval('.submit-container .submit-add', e => e.click());
  const submitted = await response;
  if (!submitted.ok()) throw new Error(`B站投稿接口返回HTTP ${submitted.status()}`);
  const result = await submitted.json();
  if (result.code !== 0) throw new Error(`B站拒绝投稿：${result.message || JSON.stringify(result)}`);
  const aid = result.data?.aid || result.data?.archive?.aid;
  const bvid = result.data?.bvid || result.data?.archive?.bvid;
  if (!aid && !bvid) throw new Error('B站投稿接口未返回稿件ID，不能确认成功');
  const body = submitted.request().postData() || '{}';
  const payload = scheduledRequests.get(page)?.submitted || JSON.parse(body);
  if (payload.title !== data.data.bt1) throw new Error('B站已提交稿件标题与本次任务不一致');
  const scheduled = Boolean(data.officialScheduledPublish);
  if (scheduled) {
    const expected = new Date(data.publishAt.replace(' ', 'T') + '+08:00').getTime() / 1000;
    if (Number(payload.dtime) !== expected) throw new Error('B站提交的预约时间与指定时间不一致');
  }
  fs.writeFileSync(path.join(path.dirname(path.resolve(data.filePath)), 'bilibili-submit-response.json'), JSON.stringify({ aid, bvid, title: payload.title, dtime: payload.dtime || 0, cover: payload.cover, cover16_9: payload.cover16_9, chapter: payload.chapter }, null, 2));
  return { aid, bvid, video_id: bvid || String(aid), video_url: bvid ? `https://www.bilibili.com/video/${bvid}` : '', scheduled, publish_at: scheduled ? data.publishAt : null };
}
