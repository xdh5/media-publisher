import { setPublishStage } from "../publishStage.js";
import fs from 'fs';
import path from 'path';
import maybeClosePublishWindow from './closeWindow.js';
import { getCreativeStatementOption, resolveBlblCreativeStatementLabel } from '../../../shared/creativeStatement.js';
import { pollPageUntil } from "./publishPageWait.js";
import { setOfficialSchedule } from './officialSchedule.js';
import { waitBilibiliElement, uploadBilibiliVideo, selectBilibiliCategory, uploadBilibiliCover, submitBilibiliVideo } from './bilibiliPublishing.js';

async function selectBlblCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  console.log("[blbl] creativeStatement 值 =", value);
  // 注意：「无标注」对应 B 站「内容无需标注」，也必须主动点选，不能跳过
  const opt = getCreativeStatementOption(value);
  const label = resolveBlblCreativeStatementLabel(value);
  console.log(
    "[blbl] 准备选择创作声明:",
    label,
    "optionalAuth=",
    !!opt.optionalAuth
  );

  const trigger = await page.$(
    ".statement-content .bcc-select-input-wrap input"
  );
  if (!trigger) {
    console.warn("未找到哔哩哔哩创作声明选择器，跳过");
    return;
  }
  await trigger.evaluate(e => e.click());
  await pollPageUntil(page, () => !!document.querySelector('.statement-content .bcc-select-list-wrap'), undefined, 250);

  const picked = await page.evaluate(
    (text, isAuthOption) => {
      if (isAuthOption) {
        const auth = document.querySelector(
          ".statement-content .auth-content .option-text"
        );
        if (auth && auth.textContent.trim() === text) {
          auth.closest(".auth-content")?.click();
          return true;
        }
        return false;
      }
      const spans = document.querySelectorAll(
        ".statement-content li.bcc-option span"
      );
      for (const span of spans) {
        if (span.textContent.trim() === text) {
          span.closest("li.bcc-option")?.click();
          return true;
        }
      }
      return false;
    },
    label,
    !!opt.optionalAuth
  );

  if (!picked) {
    console.warn(`未找到哔哩哔哩创作声明选项: ${label}`);
  }
  await page.waitForTimeout(300);
}

export default async function (page, data, window, event) {
  try {
    const options = data.publishOptions || {};
    const draft = data.publishMode === 'draft' || data.publishToDraft === true;
    await uploadBilibiliVideo(page, data.filePath);

    setPublishStage(page, '填写B站稿件标题');
    await waitBilibiliElement(page, 'input[placeholder="请输入稿件标题"]');
    await page.$eval('input[placeholder="请输入稿件标题"]', e => e.focus());
    await page.keyboard.down('Control');
    await page.keyboard.press('KeyA');
    await page.keyboard.up('Control');
    await page.keyboard.press('Backspace');
    await page.keyboard.type(data.data.bt1);
    await page.keyboard.press('Tab');
    setPublishStage(page, '设置B站创作声明');
    await selectBlblCreativeStatement(page, data);
    console.log("[blbl] 创作声明已设置");
    setPublishStage(page, '设置B站投稿分区');
    await selectBilibiliCategory(page, options.category);
    console.log("[blbl] 分区已设置：" + (options.category || "页面默认"));
    setPublishStage(page, '填写B站简介和标签');
    await page.$eval('.desc-container .ql-editor', (element, text) => {
      element.focus();
      document.execCommand('selectAll');
      document.execCommand('insertText', false, text);
    }, data.data.bdText || '');
    while (await page.$('.tag-container .label-item-v2-container .close')) {
      const count = await page.$$eval('.tag-container .label-item-v2-container', nodes => nodes.length);
      await page.$eval('.tag-container .label-item-v2-container .close', e => e.dispatchEvent(new MouseEvent('click', { bubbles: true })));
      await page.waitForFunction(previous => document.querySelectorAll('.tag-container .label-item-v2-container').length < previous, { polling: 100, timeout: 0 }, count);
    }
    const tags = String(data.data.bq || '').trim().split(/\s+/).filter(Boolean);
    for (const tag of tags) {
      await page.$eval('.tag-container .input-instance input', e => e.focus());
      await page.keyboard.type(tag.replace(/^#/, ''));
      await page.keyboard.press('Enter');
      await page.waitForTimeout(500);
    }
    console.log("[blbl] 上传完成，设置封面");
    if (options.coverPath) await uploadBilibiliCover(page, options.coverPath, options.widescreenCoverPath);
    console.log("[blbl] 封面已设置");
    if (data.officialScheduledPublish) await setOfficialSchedule(page, '哔哩哔哩', data.publishAt);
    let result;
    if (draft) {
      await page.$eval('.submit-draft', e => e.click());
      await page.waitForFunction(() => /草稿保存成功|保存成功/.test(document.body.innerText), { polling: 250, timeout: 0 });
      result = { draft: true };
    } else {
      result = await submitBilibiliVideo(page, data);
    }
    const receipt = path.join(path.dirname(path.resolve(data.filePath)), 'bilibili-publication.json');
    setPublishStage(page, '登记B站投稿回执');
    fs.writeFileSync(receipt, JSON.stringify({ ...result, title: data.data.bt1, category: options.category || null, saved_at: new Date().toISOString() }, null, 2));
    event.reply('puppeteerFile-done', { ...data, status: true, officialScheduled: result.scheduled === true, scheduled: result.scheduled === true,
      publishMode: draft ? 'draft' : 'publish', publishToDraft: draft, message: draft ? '草稿保存成功' : 'B站投稿已核验', outcome: result, publicationReceipt: receipt });
    maybeClosePublishWindow(data, window);
  } catch (error) {
    const diagnostic = await page.evaluate(() => ({ url: location.href, text: document.body.innerText,
      inputs: [...document.querySelectorAll('input')].map(e => ({ placeholder: e.placeholder, type: e.type, accept: e.accept, className: e.className, parent: e.parentElement.outerHTML.slice(0, 700) })),
      sections: [...document.querySelectorAll('[class*=cover],[class*=schedule],[class*=human-type]')].slice(0, 35).map(e => e.outerHTML.slice(0, 1500)) }));
    const frames = [];
    for (const frame of page.frames()) {
      frames.push({ url: frame.url(), text: await frame.evaluate(() => document.body?.innerText || '').catch(() => ''), html: await frame.content().catch(() => '') });
    }
    fs.writeFileSync(path.join(path.dirname(path.resolve(data.filePath)), 'bilibili-publish-frames.json'), JSON.stringify(frames, null, 2));
    fs.writeFileSync(path.join(path.dirname(path.resolve(data.filePath)), 'bilibili-publish-diagnostic.html'), await page.content());
    fs.writeFileSync(path.join(path.dirname(path.resolve(data.filePath)), 'bilibili-publish-diagnostic.json'), JSON.stringify(diagnostic, null, 2));
    event.reply('puppeteerFile-done', { ...data, status: false, message: error.message });
  }
}
