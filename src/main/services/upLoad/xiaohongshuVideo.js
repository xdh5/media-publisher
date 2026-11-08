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

async function fillMetadata(page, metadata) {
  const title = await page.waitForSelector(TITLE_INPUT, { visible: true, timeout: FORM_TIMEOUT_MS });
  await title.click({ clickCount: 3 });
  await page.keyboard.press("Backspace");
  await page.keyboard.type(Array.from((metadata.bt1 || metadata.bt2 || "").trim()).slice(0, 20).join(""));

  const description = (metadata.bdText || metadata.bt2 || "").trim();
  const tags = (metadata.bq || "").trim().split(/\s+/)
    .map((tag) => tag.replace(/^#+/, "")).filter(Boolean).slice(0, 10);
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
  const label = draft ? "暂存离开" : "发布";
  const input = await page.waitForSelector(XIAOHONGSHU_VIDEO_INPUT, { timeout: FORM_TIMEOUT_MS });
  await input.uploadFile(path.resolve(data.filePath));

  // 预览出现后继续填写，提交前等待平台报告上传完成。
  await fillMetadata(page, data.data);
  await pollPageUntil(page, () => {
    return Array.from(document.querySelectorAll(".preview-new, .video-plugin-title-action"))
      .some((element) => /上传成功|重新上传/.test(element.innerText));
  }, WAIT_UPLOAD_PROCESSING_MS, 2000, "小红书未确认视频上传完成");

  const pkCover = await page.$(".pk-cover-title-wrapper input:checked");
  if (pkCover) await pkCover.click();
  await applyCreativeStatement(page, data.data.creativeStatement);

  let submitting = false;
  try {
    await page.waitForSelector("xhs-publish-btn, .publish-page-publish-btn", {
      visible: true, timeout: FORM_TIMEOUT_MS,
    });
    submitting = true;
    await clickSubmit(page, label);
    await pollPageUntil(page, (isDraft) => {
      if (!isDraft) {
        return location.origin === "https://creator.xiaohongshu.com" &&
          location.pathname === "/publish/success";
      }
      return Array.from(document.querySelectorAll('[role="alert"], [class*="toast"], [class*="message"]'))
        .some((element) => /^(草稿保存成功|已保存草稿|草稿已保存|保存草稿成功|已保存至草稿箱|暂存成功)$/.test(element.innerText?.trim()));
    }, draft, FORM_TIMEOUT_MS, 250, `小红书未确认「${label}」结果`);
    event.reply("puppeteerFile-done", {
      ...data, status: true, message: draft ? "保存草稿成功" : "上传成功",
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
