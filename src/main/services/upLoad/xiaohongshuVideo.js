import { setPublishStage } from "../publishStage.js";
import path from "path";
import { resolveXhsCreativeStatementLabel } from "../../../shared/creativeStatement.js";
import maybeClosePublishWindow from "./closeWindow.js";
import { pollPageUntil, WAIT_UPLOAD_PROCESSING_MS } from "./uploadTimeouts.js";

// 视频发布流程移植自 social-auto-upload v1.0.0-skills.2，许可证见项目根目录。
export const XIAOHONGSHU_VIDEO_INPUT = "div[class^='upload-content'] input.upload-input[type='file']";
const TITLE_INPUT = 'input[placeholder*="填写标题"]';
const DESCRIPTION_INPUT = 'p[data-placeholder*="输入正文描述"]';
const TOPIC_OPTION = "#creator-editor-topic-container .item";
const FORM_TIMEOUT_MS = 30000;

// 只识别可见的拦截提示，避免把正文里的相同文字当成风控。
function inspectSubmissionPage(mode) {
  const notices = Array.from(document.querySelectorAll(
    '[role="alert"], [role="dialog"], [class*="toast"], [class*="modal"], [class*="message"]'
  )).filter((node) => node.getClientRects().length && getComputedStyle(node).visibility === "visible");
  const blocked = notices.find((node) => /安全验证|操作频繁|疑似.*(?:自动化|托管)|账号异常|账号.*封禁|限制发布|禁止发布/.test(node.innerText));
  if (blocked) return { blocked: blocked.innerText.trim().slice(0, 160) };
  if (mode === "publish" && location.origin === "https://creator.xiaohongshu.com" &&
      location.pathname === "/publish/success") return { confirmed: true };
  if (mode === "draft" && notices.some((node) =>
    /^(草稿保存成功|已保存草稿|草稿已保存|保存草稿成功|已保存至草稿箱|暂存成功)$/.test(node.innerText?.trim())
  )) return { confirmed: true };
  return false;
}

async function fillMetadata(page, metadata) {
  const title = await page.waitForSelector(TITLE_INPUT, { visible: true, timeout: FORM_TIMEOUT_MS });
  await title.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  const suppliedTitle = (metadata.bt1 || "").trim();
  if (Array.from(suppliedTitle).length > 20) throw new Error("小红书标题超过20字，请由发布业务指定标题");
  await page.keyboard.type(suppliedTitle);

  const description = (metadata.bdText || "").trim();
  const tags = (metadata.bq || "").trim().split(/\s+/)
    .map((tag) => tag.replace(/^#+/, "")).filter(Boolean);
  if (tags.length > 10) throw new Error("小红书话题超过10个，请由发布业务指定话题");
  if (!description && !tags.length) return;

  const editor = await page.waitForSelector(DESCRIPTION_INPUT, { visible: true, timeout: FORM_TIMEOUT_MS });
  await editor.click();
  if (description) {
    await page.keyboard.down("Control");
    await page.keyboard.press("a");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(description);
    if (tags.length) await page.keyboard.press("Enter");
  }

  for (const tag of tags) {
    await page.keyboard.type("#" + tag, { delay: 30 });
    try {
      const option = await page.waitForSelector(TOPIC_OPTION, { visible: true, timeout: 6000 });
      await option.click();
    } catch (error) {
      if (error.name !== "TimeoutError") throw error;
      // 候选接口未返回时保留用户提供的话题文字。
      await page.keyboard.press("Escape");
    }
    await page.keyboard.type(" ");
  }
}

async function applyCreativeStatement(page, value) {
  const label = resolveXhsCreativeStatementLabel(value);
  const supported = ["笔记含AI合成内容", "虚构演绎，仅供娱乐", "内容包含营销广告"];
  if (!supported.includes(label)) return;

  const trigger = await page.waitForXPath(
    "//div[contains(@class,'d-select-placeholder') and normalize-space(.)='添加内容类型声明']",
    { visible: true, timeout: FORM_TIMEOUT_MS }
  );
  await trigger.click();
  const option = await page.waitForXPath(
    `//div[contains(@class,'d-option-name') and normalize-space(.)=${JSON.stringify(label)}]`,
    { visible: true, timeout: FORM_TIMEOUT_MS }
  );
  await option.click();
  await page.waitForFunction((expected) => {
    return Array.from(document.querySelectorAll(".d-select-description, .d-select-placeholder"))
      .some((element) => element.textContent.trim() === expected);
  }, { timeout: FORM_TIMEOUT_MS }, label);
}

// 定时表单参考 social-auto-upload 3847fff，许可证见项目根目录。
async function setXiaohongshuSchedule(page, publishAt) {
  setPublishStage(page, "设置并核对小红书官方预约时间");
  const toggle = await page.waitForXPath(
    '//div[contains(concat(" ", normalize-space(@class), " "), " custom-switch-card ")][contains(., "定时发布")]//*[contains(concat(" ", normalize-space(@class), " "), " d-switch ")]',
    { visible: true, timeout: FORM_TIMEOUT_MS },
  );
  await toggle.click();

  const timeInput = await page.waitForSelector(".d-datepicker-input-filter input.d-text", {
    visible: true, timeout: FORM_TIMEOUT_MS,
  });
  const publishMinute = publishAt.slice(0, 16);
  await timeInput.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await timeInput.type(publishMinute);
  await page.keyboard.press("Tab");
  if (await timeInput.evaluate((input) => input.value) !== publishMinute) {
    throw new Error("小红书页面未接受指定的定时发布时间");
  }
}

async function clickSubmit(page, label) {
  // 创作者中心新版按钮在闭合的影子根中，通过 CDP 读取按钮并按实际坐标点击。
  const client = await page.target().createCDPSession();
  try {
    const { root } = await client.send("DOM.getDocument");
    const { nodeId: host } = await client.send("DOM.querySelector", {
      nodeId: root.nodeId, selector: "xhs-publish-btn",
    });
    let container = root.nodeId;
    if (host) {
      const { node } = await client.send("DOM.describeNode", { nodeId: host });
      const shadow = node.shadowRoots?.[0];
      if (shadow) {
        const { nodeIds } = await client.send("DOM.pushNodesByBackendIdsToFrontend", {
          backendNodeIds: [shadow.backendNodeId],
        });
        [container] = nodeIds;
      } else {
        container = host;
      }
    }
    const { nodeIds } = await client.send("DOM.querySelectorAll", {
      nodeId: container, selector: host ? "button" : ".publish-page-publish-btn button",
    });
    for (const nodeId of nodeIds) {
      const { object } = await client.send("DOM.resolveNode", { nodeId });
      const { result } = await client.send("Runtime.callFunctionOn", {
        objectId: object.objectId,
        functionDeclaration: `function(label) {
          return this.textContent.trim() === label && !this.disabled &&
            this.getAttribute("aria-disabled") !== "true" && this.getClientRects().length > 0;
        }`,
        arguments: [{ value: label }],
        returnByValue: true,
      });
      if (!result.value) continue;
      await client.send("DOM.scrollIntoViewIfNeeded", { nodeId });
      const { model } = await client.send("DOM.getBoxModel", { nodeId });
      const [left, top, , , right, bottom] = model.content;
      await page.mouse.click((left + right) / 2, (top + bottom) / 2);
      return;
    }
    throw new Error(`小红书未找到可用的「${label}」按钮，请检查页面提示`);
  } finally {
    await client.detach().catch(() => {});
  }
}

export default async function publishXiaohongshuVideo(page, data, window, event) {
  const draft = data.publishMode === "draft" || data.publishToDraft === true;
  const scheduled = data.officialScheduledPublish === true;
  const label = scheduled ? "定时发布" : draft ? "暂存离开" : "发布";
  let submitting = false;
  try {
    const beforeUpload = await page.evaluate(inspectSubmissionPage, "check");
    setPublishStage(page, "检查小红书发布限制和上传控件");
    if (beforeUpload?.blocked) throw new Error(`小红书上传已暂停：${beforeUpload.blocked}`);
    const input = await page.waitForSelector(XIAOHONGSHU_VIDEO_INPUT, { timeout: FORM_TIMEOUT_MS });
    setPublishStage(page, "上传小红书视频文件");
    await input.uploadFile(path.resolve(data.filePath));

    // 预览出现后继续填写，提交前等待平台报告上传完成。
    setPublishStage(page, "填写小红书标题、简介和话题");
    await fillMetadata(page, data.data);
    setPublishStage(page, "等待小红书确认视频上传成功");
    await pollPageUntil(page, () => {
      return Array.from(document.querySelectorAll(".preview-new, .video-plugin-title-action"))
        .some((element) => /上传成功|重新上传/.test(element.innerText));
    }, WAIT_UPLOAD_PROCESSING_MS, 2000, "小红书未确认视频上传完成");

    const pkCover = await page.$(".pk-cover-title-wrapper input:checked");
    if (pkCover) await pkCover.click();
    setPublishStage(page, "设置小红书创作声明");
    await applyCreativeStatement(page, data.data.creativeStatement);

    await page.waitForSelector("xhs-publish-btn, .publish-page-publish-btn", {
      visible: true, timeout: FORM_TIMEOUT_MS,
    });
    if (scheduled) await setXiaohongshuSchedule(page, data.publishAt);
    setPublishStage(page, "核验小红书提交前页面状态");
    const before = await page.evaluate(inspectSubmissionPage, "check");
    if (before?.blocked) throw new Error(`小红书发布已暂停：${before.blocked}`);
    submitting = true;
    setPublishStage(page, `提交小红书${label}`);
    await clickSubmit(page, label);
    setPublishStage(page, "等待小红书发布或草稿回执");
    const receipt = await page.waitForFunction(inspectSubmissionPage, {
      timeout: FORM_TIMEOUT_MS, polling: 250,
    }, draft ? "draft" : "publish").catch((error) => {
      if (error.name !== "TimeoutError") throw error;
      throw new Error(`小红书未确认「${label}」结果`);
    });
    const result = await receipt.jsonValue();
    if (result.blocked) throw new Error(`小红书发布已暂停：${result.blocked}`);
    event.reply("puppeteerFile-done", {
      ...data, status: true, officialScheduled: scheduled,
      message: scheduled ? "定时发布成功" : draft ? "保存草稿成功" : "上传成功",
    });
    maybeClosePublishWindow(draft ? { ...data, closeWindowAfterPublish: true } : data, window);
  } catch (error) {
    event.reply("puppeteerFile-done", {
      ...data, status: false, needsAttention: true,
      ...(submitting ? { outcome: "unknown" } : {}),
      message: submitting ? `${error.message}，请核对创作者中心后再重试` : error.message,
    });
  }
}
