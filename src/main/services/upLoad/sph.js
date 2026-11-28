import { setPublishStage } from "../publishStage.js";
import { resolveSphSurface } from "./sphSurface.js";
import { uploadSphCovers } from "./sphCover.js";
import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { resolveVideoLinkOption } from "../../../shared/videoLink.js";
import {
  isCreativeStatementNone,
  resolveSphCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import { attachSphVideoLink } from "./sphLink.js";

import { setOfficialSchedule } from "./officialSchedule.js";

/** 声明原创必须在上传完成后勾选，并核对页面状态。 */
async function declareSphOriginal(page) {
  await page.waitForFunction(() => {
    const root = document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document;
    const container = root.querySelector(".declare-original-checkbox");
    if (!container || !container.getBoundingClientRect().width) return false;
    if (container.querySelector("input:checked, .ant-checkbox-checked")) return true;
    const label = container.querySelector(".ant-checkbox-wrapper");
    if (!label) return false;
    label.click();
    return true;
  }, { timeout: 0, polling: 500 });
  await page.waitForFunction(() => {
    const root = document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document;
    const dialogs = [...root.querySelectorAll(".weui-desktop-dialog")]
      .filter(node => node.getBoundingClientRect().width > 0 && /原创/.test(node.textContent));
    for (const dialog of dialogs) {
      const protocol = dialog.querySelector(".protocol-text");
      const label = dialog.querySelector("label.ant-checkbox-wrapper");
      const agreement = label || protocol;
      if (agreement && !agreement.querySelector("input:checked, .ant-checkbox-checked")) agreement.click();
      const confirm = [...dialog.querySelectorAll("button.weui-desktop-btn_primary")]
        .find(node => !node.disabled && /声明原创|确认|确定/.test(node.textContent));
      if (confirm) confirm.click();
      return false;
    }
    return !!root.querySelector(".declare-original-checkbox input:checked, .declare-original-checkbox .ant-checkbox-checked");
  }, { timeout: 0, polling: 500 }).catch(() => {
    throw new Error("视频号声明原创未完成勾选或确认，停止发表");
  });
  console.log("[sph] 声明原创已勾选并核验");
}

/**
 * 选择视频号「视频标注」（.post-with-mark-tag）。
 * 自行拍摄时间/地点、转载来源为平台选填，本轮只点主选项。
 */
async function applySphCreativeStatement(page, value) {
  if (isCreativeStatementNone(value)) return;
  const label = resolveSphCreativeStatementLabel(value);
  if (!label || label === "无标注" || label === "无需标注") return;

  const opened = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app?.shadowRoot || document;
    if (!root) return false;
    const trigger = root.querySelector(".post-with-mark-tag .select-display");
    if (!trigger) return false;
    trigger.click();
    return true;
  });
  if (!opened) {
    console.log("视频标注：未找到入口，跳过");
    return;
  }

  await page.waitForTimeout(300);
  const clicked = await page.evaluate((expected) => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app?.shadowRoot || document;
    if (!root) return false;
    const options = Array.from(root.querySelectorAll(".mark-tag-option"));
    const target = options.find((item) => {
      const main = item.querySelector(".option-main");
      return String((main && main.textContent) || "").trim() === expected;
    });
    if (!target) return false;
    target.click();
    return true;
  }, label);
  if (!clicked) {
    console.warn(`视频标注：未找到选项「${label}」，跳过`);
    return;
  }
  console.log(`[sph][mark-tag] 已选择：${label}`);
  await page.waitForTimeout(400);
}

async function clickSphDraftButton(page) {
  await clickSphFormButton(page, "保存草稿", "draft");
  await page.waitForTimeout(1000);
}

async function clickSphPublishButton(page) {
  await clickSphFormButton(page, "发布", "publish");
  await waitSphPublishConfirmed(page);
}

/**
 * 点击不等于平台接收。必须等到成功提示或离开创建页，才能向 CLI / MCP 回报成功。
 * 同时记录可见提示和按钮，方便定位二次确认、字段校验或平台拦截。
 */
async function waitSphPublishConfirmed(page) {
  let lastSnapshot = null;
  while (!page.isClosed()) {
    await page.evaluate(() => {
      const root = document.querySelector("wujie-app.wujie_iframe")?.shadowRoot || document;
      const direct = [...root.querySelectorAll("button")].find(button =>
        button.textContent.trim() === "直接发表" && button.getBoundingClientRect().width > 0 && !button.disabled);
      if (direct) direct.click();
    });
    const snapshot = await page
      .evaluate(() => {
        const app = document.querySelector("wujie-app.wujie_iframe");
        const root = app?.shadowRoot || document;
        const isVisible = (node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            node.isConnected &&
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            rect.width > 0 &&
            rect.height > 0
          );
        };
        const nodes = root
          ? Array.from(root.querySelectorAll("div,span,p,button,[role='alert'],[role='dialog']"))
          : [];
        const texts = Array.from(
          new Set(
            nodes
              .filter(isVisible)
              .map((node) => String(node.textContent || "").replace(/\s+/g, " ").trim())
              .filter((text) => text && text.length <= 120)
          )
        );
        const importantTexts = texts.filter((text) =>
          /成功|失败|错误|请|不能|无法|确认|发表|发布|审核|违规|重试/.test(text)
        );
        const buttons = nodes
          .filter((node) => node.matches("button,[role='button']") && isVisible(node))
          .map((node) => ({
            text: String(node.textContent || "").replace(/\s+/g, "").trim(),
            disabled:
              Boolean(node.disabled) || node.getAttribute("aria-disabled") === "true",
          }));
        return {
          url: location.href,
          importantTexts: importantTexts.slice(-30),
          buttons: buttons.slice(-20),
        };
      })
      .catch((error) => ({
        url: "",
        importantTexts: [],
        buttons: [],
        inspectError: error && error.message ? error.message : String(error),
      }));
    lastSnapshot = snapshot;

    const url = String(snapshot.url || "");
    const joined = (snapshot.importantTexts || []).join(" | ");
    if (url && !/\/post\/create(?:[/?#]|$)/.test(url)) {
      console.log(`[sph] 平台已离开创建页：${url}`);
      return;
    }
    if (/发表成功|发布成功|提交成功|已发表|已发布/.test(joined)) {
      console.log(`[sph] 平台确认发布成功：${joined}`);
      return;
    }
    if (/发布失败|发表失败|提交失败|发布错误|网络错误|请重试|无法发布|不能发布/.test(joined)) {
      throw new Error(`视频号平台拒绝发布：${joined}`);
    }

    console.log(`[sph][publish-wait] ${JSON.stringify(snapshot)}`);
    await page.waitForTimeout(2000);
  }
  throw new Error(
    `点击发表后未收到视频号成功确认：${JSON.stringify(lastSnapshot || {})}`
  );
}

/**
 * 视频号发布页会在上传处理完成后重建底部按钮。Puppeteer 的 ElementHandle
 * 容易指向已失效或隐藏的旧节点，因此在 shadow DOM 内重新定位可见按钮并原生点击。
 */
async function clickSphFormButton(page, label, action) {
  let lastSnapshot = null;
  while (!page.isClosed()) {
    const result = await page
      .evaluate((expectedAction) => {
        const app = document.querySelector("wujie-app.wujie_iframe");
        const root = app?.shadowRoot || document;
        if (!root) return { ok: false, reason: "shadow-root-missing" };

        const form = root.querySelector(".form-btns");
        if (!form) return { ok: false, reason: "form-buttons-missing" };

        const pageText = String(root.textContent || "").replace(/\s+/g, " ");
        if (/文件上传中|正在上传|上传中，请等待|视频处理中|正在处理/.test(pageText)) {
          return { ok: false, reason: "video-still-uploading" };
        }

        // 视频号按钮文字可能由子组件或伪元素渲染，不能依赖 textContent。
        // 发布固定为最后一组，草稿固定为第一组；每轮都在页面内重新取节点并原生点击，
        // 避免上传完成重建 DOM 后 ElementHandle 指向旧节点。
        const groupSelector =
          expectedAction === "draft" ? ":scope > div:first-child" : ":scope > div:last-child";
        const group = form.querySelector(groupSelector);
        const target = group && group.querySelector("button,[role='button']");
        const buttons = Array.from(form.querySelectorAll("button,[role='button']"));
        const snapshot = buttons.map((button, index) => {
          const style = window.getComputedStyle(button);
          const rect = button.getBoundingClientRect();
          return {
            index,
            text: String(button.textContent || "").replace(/\s+/g, "").trim(),
            disabled: Boolean(button.disabled),
            ariaDisabled: button.getAttribute("aria-disabled"),
            display: style.display,
            visibility: style.visibility,
            pointerEvents: style.pointerEvents,
            width: Math.round(rect.width),
            height: Math.round(rect.height),
          };
        });
        if (!target) {
          return { ok: false, reason: "target-missing", snapshot };
        }
        if (
          !target.isConnected ||
          target.disabled ||
          target.getAttribute("aria-disabled") === "true"
        ) {
          return { ok: false, reason: "target-disabled", snapshot };
        }

        target.scrollIntoView({ block: "center", inline: "center" });
        target.click();
        return {
          ok: true,
          text: String(target.textContent || "").replace(/\s+/g, "").trim(),
          snapshot,
        };
      }, action)
      .catch((error) => ({
        ok: false,
        reason: error && error.message ? error.message : String(error),
      }));
    lastSnapshot = result;
    if (result && result.ok === true) {
      console.log(`[sph] 已点击${label}按钮：${result.text || label}`);
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(
    `发布页面已关闭，停止等待视频号${label}按钮：${JSON.stringify(lastSnapshot || {})}`
  );
}

const SEL_SPH_FILE_INPUT = 'wujie-app.wujie_iframe >>> input[type="file"]';

/**
 * 上传框在 shadow DOM 内且挂载时机不稳，setFileInputFiles 可能落在随后被重建的 input 上：
 * 页面看不到视频却不报错，后续等待「删除」标签会白等到超时。这里重取 input 并确认页面
 * 真的进入上传态再继续。
 */
async function ensureSphFileSelected(page, filePath, attempts = 3) {
  const fileName = path.basename(filePath);
  const uploadStarted = () =>
    page
      .evaluate((expectedFileName) => {
        const app = document.querySelector("wujie-app.wujie_iframe");
        const root = app?.shadowRoot || document;
        if (!root) return false;
        // input.files 只能证明文件已写入 input，不能证明页面真正接收并开始上传。
        if (root.querySelector("video")) return true;
        const tags = Array.from(root.querySelectorAll(".tag-inner"));
        if (tags.some((tag) => String(tag.textContent || "").trim() === "删除")) {
          return true;
        }
        const text = String(root.textContent || "");
        if (expectedFileName && text.includes(expectedFileName)) return true;
        const progress = Array.from(
          root.querySelectorAll(
            '.ant-progress, [class*="progress"], [role="progressbar"]'
          )
        );
        if (progress.some((node) => {
          const value = String(
            node.getAttribute("aria-valuenow") || node.textContent || ""
          ).trim();
          const style = String(node.getAttribute("style") || "");
          return /\d+\s*%/.test(value) || /width\s*:\s*\d/.test(style);
        })) {
          return true;
        }
        const wrap = root.querySelector(".upload-content, .ant-upload-drag");
        return !!(wrap && !/上传时长/.test(wrap.textContent || ""));
      }, fileName)
      .catch(() => false);

  let lastError = null;
  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      const input = await page.waitForSelector(SEL_SPH_FILE_INPUT, {
        timeout: 0,
      });
      if (!input) throw new Error("上传 input 不存在");
      await input.uploadFile(filePath);
    } catch (err) {
      lastError = err;
    }

    for (let i = 0; i < 10; i += 1) {
      await page.waitForTimeout(2000);
      if (await uploadStarted()) return;
    }
    console.warn(`视频号选择视频第 ${attempt} 次未生效，重试`);
  }

  throw new Error(
    `视频号选择视频文件失败：${
      (lastError && lastError.message) || "页面未进入上传状态"
    }`
  );
}

async function waitSphUploadProcessing(page) {
  setPublishStage(page, "等待视频号视频上传和平台处理完成");
  let lastProgress = "";
  while (!page.isClosed()) {
    const state = await page.evaluate(() => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app?.shadowRoot || document;
      const pageText = String(root.textContent || "").replace(/\s+/g, " ");
      // 「删除」标签从上传开始就会出现，不能作为完成标志。平台在未完成时会明确
      // 显示“文件上传中，请等待完成后再编辑”，此时发表按钮虽无 disabled 属性，
      // 实际仍是灰色且点击无效。
      const processing = /文件上传中|正在上传|上传中，请等待|视频处理中|正在处理/.test(pageText);
      const progressTexts = Array.from(
        root.querySelectorAll('.ant-progress, [class*="progress"], [role="progressbar"]')
      )
        .filter((node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0;
        })
        .map((node) => {
          const aria = node.getAttribute("aria-valuenow");
          if (aria !== null && aria !== "") return `${Number(aria)}%`;
          const matched = String(node.textContent || "").match(/(\d+(?:\.\d+)?)\s*%/);
          return matched ? `${matched[1]}%` : "";
        });
      const percentages = progressTexts.filter(Boolean).map((text) => Number(text.replace("%", "")));
      const percentage = percentages.length ? Math.min(...percentages) : null;
      const form = root.querySelector(".form-btns");
      const publishGroup = form && form.querySelector(":scope > div:last-child");
      return {
        done: !processing && (percentage === null || percentage >= 100) &&
          Boolean(publishGroup && publishGroup.querySelector("button,[role='button']")),
        progress: percentage === null ? "平台处理中" : `${percentage}%`,
      };
    });
    if (state.done) {
      await page.waitForTimeout(2000);
      return;
    }
    if (state.progress !== lastProgress) {
      lastProgress = state.progress;
      console.log(`[sph] 上传处理进度：${state.progress}`);
    }
    await page.waitForTimeout(2000);
  }
  throw new Error("视频号发布页面已关闭，停止等待");
}

/** 沿用项目原有的点击输入框 + keyboard.type 文案填写方式。 */
async function fillSphTextAsBefore(page, description, shortTitle, fields = {}) {
  if (fields.description !== false) {
    const titleInput = await page.waitForSelector(
      "wujie-app.wujie_iframe >>> .post-desc-box .input-editor",
      { timeout: 0 }
    );
    if (!titleInput) throw new Error("未找到视频号描述输入框");
    await page.evaluate(() => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const target = (app?.shadowRoot || document).querySelector(".post-desc-box .input-editor");
      if (!target) throw new Error("未找到视频号描述输入框真实节点");
      target.focus();
    });
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(description, { delay: 50 });
  }

  if (fields.shortTitle !== false) {
    const shortTitleInput = await page.waitForSelector(
      'wujie-app.wujie_iframe >>> input[placeholder="填写短标题有机会获得更多流量"]',
      { timeout: 0 }
    );
    if (!shortTitleInput) throw new Error("未找到视频号短标题输入框");
    await page.evaluate(() => {
      const app = document.querySelector("wujie-app.wujie_iframe");
      const target = (app?.shadowRoot || document).querySelector('input[placeholder="填写短标题有机会获得更多流量"]');
      if (!target) throw new Error("未找到视频号短标题输入框真实节点");
      target.focus();
    });
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.keyboard.type(shortTitle, { delay: 50 });
  }
}

/** 发布前只读检查，避免上传完成重建表单后把旧方式写入的文案清空。 */
async function readSphTextState(page, title, tags, shortTitle) {
  return page.evaluate((expectedTitle, expectedTags, expectedShortTitle) => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app?.shadowRoot || document;
    if (!root) return { descriptionOk: false, shortTitleOk: false };
    const descriptionBox = root.querySelector(".post-desc-box");
    const descriptionText = String(
      (descriptionBox && descriptionBox.textContent) || ""
    ).replace(/\s+/g, " ");
    const normalize = (text) => String(text || "").replace(/[#＃\s\u200b]/g, "");
    const tagList = String(expectedTags || "")
      .split(/\s+/)
      .filter(Boolean);
    const descriptionOk =
      normalize(descriptionText).includes(normalize(expectedTitle)) &&
      tagList.every((tag) => normalize(descriptionText).includes(normalize(tag)));
    const shortInput = root.querySelector(
      'input[placeholder="填写短标题有机会获得更多流量"]'
    );
    const actualShortTitle = String((shortInput && shortInput.value) || "").trim();
    const editor = root.querySelector(".post-desc-box .input-editor");
    const editableNodes = descriptionBox
      ? Array.from(
          descriptionBox.querySelectorAll(
            'input,textarea,[contenteditable="true"],[role="textbox"]'
          )
        ).map((node) => ({
          tag: node.tagName,
          className: String(node.className || ""),
          contentEditable: node.getAttribute("contenteditable"),
          role: node.getAttribute("role"),
          placeholder: node.getAttribute("placeholder"),
        }))
      : [];
    return {
      descriptionOk,
      shortTitleOk: !expectedShortTitle || actualShortTitle === expectedShortTitle,
      descriptionText,
      actualShortTitle,
      editorTag: editor && editor.tagName,
      editorClassName: String((editor && editor.className) || ""),
      editorContentEditable: editor && editor.getAttribute("contenteditable"),
      activeTag: root.activeElement && root.activeElement.tagName,
      activeClassName: String((root.activeElement && root.activeElement.className) || ""),
      editableNodes,
    };
  }, title, tags, shortTitle);
}

async function fallbackLinkFailureToDraft(page, data, window, event, error) {
  const detail =
    (error && error.message) ||
    (typeof error === "string" ? error : String(error));
  try {
    // 链接在表单前半段填写；失败时仍需等待视频处理完成后才能可靠保存草稿。
    await waitSphUploadProcessing(page);
    await clickSphDraftButton(page);
    event.reply("puppeteerFile-done", {
      ...data,
      status: true,
      outcome: "draft_saved",
      publishMode: "draft",
      publishToDraft: true,
      needsAttention: true,
      failureStage: "video_link",
      message: `视频号链接添加失败，视频已保存为草稿：${detail}`,
    });
    maybeClosePublishWindow({ ...data, closeWindowAfterPublish: true }, window);
    return true;
  } catch (draftError) {
    const draftDetail =
      (draftError && draftError.message) || String(draftError || "未知错误");
    throw new Error(
      `视频号链接添加失败：${detail}；保存草稿也失败：${draftDetail}`
    );
  }
}

export default async function (page, data, window, event, onFinish) {
  const isDraftMode =
    data.publishMode === "draft" || data.publishToDraft === true;

  console.log(data);
  await page.waitForTimeout(1000 * 5);
  page = resolveSphSurface(page);
  setPublishStage(page, "等待视频号上传控件并选择视频文件");
  try {
    await ensureSphFileSelected(page, path.resolve(data.filePath));
  } catch (err) {
    const detail = (err && err.message) || String(err || "上传失败");
    console.error("❌ 文件上传失败:", err);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: detail,
    });
    maybeClosePublishWindow(data, window);
    return;
  }

  const suppliedDescription = String(data.data.bdText || "").trim();
  const description = suppliedDescription;
  const shortTitle = (data.data.bt2 || "").trim();
  const normalizedShortTitle = shortTitle;
  try {
    if (!description) throw new Error("视频号描述不能为空");
    setPublishStage(page, "填写视频号描述和短标题");
    await fillSphTextAsBefore(page, description, normalizedShortTitle, {
      shortTitle: Boolean(shortTitle),
    });
  } catch (err) {
    throw new Error(
      `视频号文案填写失败：${err && err.message ? err.message : String(err)}`
    );
  }

  try {
    const link = resolveVideoLinkOption("视频号", data.publishOptions);
    if (link && link.enabled === true) {
      try {
        setPublishStage(page, "添加视频号关联链接");
        const selectedLink = await attachSphVideoLink(page, link);
        console.log(
          `[sph][link] 已添加 ${selectedLink.type} ${selectedLink.value}: ${
            selectedLink.label || ""
          }`
        );
      } catch (linkError) {
        console.error("[sph][link] 添加链接失败:", linkError);
        const handled = await fallbackLinkFailureToDraft(
          page,
          data,
          window,
          event,
          linkError
        );
        if (handled) return;
      }
    }

    try {
      setPublishStage(page, "设置视频号创作声明");
      await applySphCreativeStatement(
        page,
        data.data && data.data.creativeStatement
      );
    } catch (markError) {
      console.warn(
        "视频标注选择未完成:",
        markError && markError.message ? markError.message : markError
      );
    }

    await waitSphUploadProcessing(page);

    setPublishStage(page, "核验视频号上传后的描述和短标题");
    let textState = await readSphTextState(
      page,
      description,
      "",
      normalizedShortTitle
    );
    if (!textState.descriptionOk || !textState.shortTitleOk) {
      console.warn(
        `[sph] 上传完成后文案缺失，沿用旧方式补写：${JSON.stringify(textState)}`
      );
      await fillSphTextAsBefore(page, description, normalizedShortTitle, {
        description: !textState.descriptionOk,
        shortTitle: Boolean(shortTitle) && !textState.shortTitleOk,
      });
      textState = await readSphTextState(
        page,
        description,
        "",
        normalizedShortTitle
      );
    }
    if (!textState.descriptionOk || !textState.shortTitleOk) {
      throw new Error(`视频号文案发布前校验失败：${JSON.stringify(textState)}`);
    }
    console.log(`[sph] 文案发布前校验成功：${JSON.stringify(textState)}`);

    setPublishStage(page, "设置视频号主页和分享封面");
    const { coverPath, portraitCoverPath } = data.publishOptions || {};
    if (coverPath && portraitCoverPath) await uploadSphCovers(page, portraitCoverPath, coverPath);

    if (data.publishOptions?.declareOriginal === true) {
      setPublishStage(page, "声明并核验视频号原创");
      await declareSphOriginal(page);
    }

    const isOfficialSchedule = Boolean(data.officialScheduledPublish);
    if (isOfficialSchedule) {
      setPublishStage(page, "设置视频号官方预约时间");
      await setOfficialSchedule(page, "视频号", data.publishAt);
    }

    // 所有表单项（包括商品）完成后，草稿和发布只能二选一执行。
    setPublishStage(page, "提交视频号发布或草稿并等待确认");
    if (isDraftMode) await clickSphDraftButton(page);
    else await clickSphPublishButton(page);
    console.log(
      isDraftMode ? "✅ 视频号视频已保存草稿" : "✅ 视频号视频发布成功"
    );
    setTimeout(() => {
      event.reply("puppeteerFile-done", {
        ...data,
        status: true,
        scheduled: isOfficialSchedule,
        officialScheduled: isOfficialSchedule,
        message: isDraftMode
          ? "保存草稿成功"
          : isOfficialSchedule
            ? `视频号官方定时发表已预约: ${data.publishAt}`
            : "发布成功",
      });
      maybeClosePublishWindow(data, window);
    }, 5000);
  } catch (err) {
    const detail =
      (err && err.message) || (typeof err === "string" ? err : String(err));
    console.error("❌ 视频号发布失败:", err);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message:
        detail && detail.length > 400
          ? `${detail.slice(0, 400)}…`
          : detail || "上传失败",
    });
    maybeClosePublishWindow(data, window);
  }
}

export { fillSphTextAsBefore, applySphCreativeStatement, waitSphUploadProcessing, clickSphPublishButton, waitSphPublishConfirmed };
