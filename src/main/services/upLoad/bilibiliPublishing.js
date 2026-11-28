import { setPublishStage } from "../publishStage.js";
import fs from 'fs';
import path from 'path';

export async function uploadBilibiliVideo(page, filename) {
  const file = path.resolve(filename);
  setPublishStage(page, '等待B站上传视频按钮');
  const button = await page.waitForXPath('//*[normalize-space(text())="上传视频"]', { visible: true, timeout: 0 });
  setPublishStage(page, '点击B站上传视频并选择文件');
  const chooserReady = page.waitForFileChooser({ timeout: 0 });
  const [chooser] = await Promise.all([chooserReady, button.click()]);
  await chooser.accept([file]);
  console.log('[B站选择视频文件]', path.basename(file));
  let started = false;
  let lastState = '';
  while (!page.isClosed()) {
    const state = await page.evaluate(() => {
      const item = document.querySelector('.file-item');
      const visible = node => node.getBoundingClientRect().width > 0;
      const messages = [...document.querySelectorAll('.bcc-message, [role="alert"]')]
        .filter(visible).map(node => node.textContent).join(' ');
      const text = String(item?.textContent || '').replace(/\s+/g, ' ').trim();
      return { started: Boolean(item && visible(item)),
        done: Boolean(item?.querySelector('.file-item-content-status .success')),
        error: /上传失败|不支持.*格式|文件过大|超过.*大小限制/.test(text + messages) ? text + messages : '',
        text };
    });
    if (state.error) throw new Error(`B站视频上传失败：${state.error}`);
    if (state.started && !started) {
      started = true;
      setPublishStage(page, '等待B站视频上传完成');
      console.log('[B站上传已开始]', path.basename(file));
    }
    const current = JSON.stringify(state);
    if (current !== lastState) {
      console.log('[B站视频上传状态]', current);
      lastState = current;
    }
    if (state.done) return;
    await page.waitForTimeout(1000);
  }
  throw new Error('发布页面已关闭，停止等待B站视频上传');
}

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
  const body = submitted.request().postData() || '{}';
  const payload = scheduledRequests.get(page)?.submitted || JSON.parse(body);
  if (payload.title !== data.data.bt1) throw new Error('B站已提交稿件标题与本次任务不一致');
  const scheduled = Boolean(data.officialScheduledPublish);
  if (scheduled) {
    const expected = new Date(data.publishAt.replace(' ', 'T') + '+08:00').getTime() / 1000;
    if (Number(payload.dtime) !== expected) throw new Error('B站提交的预约时间与指定时间不一致');
  }
  fs.writeFileSync(path.join(path.dirname(path.resolve(data.filePath)), 'bilibili-submit-response.json'), JSON.stringify({ aid, bvid, title: payload.title, dtime: payload.dtime || 0, cover: payload.cover, cover16_9: payload.cover16_9 }, null, 2));
  return { aid, bvid, video_id: bvid || (aid ? String(aid) : ""), video_url: bvid ? `https://www.bilibili.com/video/${bvid}` : '', scheduled, publish_at: scheduled ? data.publishAt : null };
}
