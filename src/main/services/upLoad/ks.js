import { setPublishStage } from "../publishStage.js";
import { uploadKsCover } from "./ksCover.js";
import path from "path";
import fs from "fs";
import { runWithKsResponse, requireKsSuccess, isKsSubmitResponse } from "./ksApiResponses.js";
import maybeClosePublishWindow from "./closeWindow.js";
import { KUAISHOU_VIDEO_UPLOAD_SELECTOR } from "../../../shared/platformPageState.js";
import {
  isCreativeStatementNone,
  resolveKsCreativeStatementLabel,
} from "../../../shared/creativeStatement.js";
import { WAIT_SELECTOR_APPEAR_MS, WAIT_UPLOAD_PROCESSING_MS, pollPageUntil } from "./uploadTimeouts.js";
import {
  clickKuaishouScheduleConfirmation,
  setOfficialSchedule,
  waitForOfficialScheduleAccepted,
} from "./officialSchedule.js";

const TITLE_SELECTORS = [
  'input[placeholder*="标题"]',
  'textarea[placeholder*="标题"]',
  '[contenteditable="true"][data-placeholder*="标题"]',
];
const DESCRIPTION_SELECTORS = [
  '#work-description-edit [contenteditable="true"]',
  "#work-description-edit textarea",
  "#work-description-edit input",
  '#work-description-edit[contenteditable="true"]',
  'textarea[placeholder*="描述"]',
  '[contenteditable="true"][data-placeholder*="描述"]',
  '[contenteditable="true"][aria-label*="描述"]',
];

async function findVisibleEditable(page, selectors) {
  for (const selector of selectors) {
    const nodes = await page.$$(selector);
    for (const node of nodes) {
      const visible = await node.evaluate((element) => {
        if (!element.isConnected) return false;
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return rect.width > 0 && rect.height > 0 && style.visibility !== "hidden" && style.display !== "none";
      }).catch(() => false);
      if (visible) return node;
    }
  }
  return null;
}

function normalizeFieldText(text) {
  return String(text || "").replace(/\s+/g, " ").trim();
}

async function readFieldText(input) {
  return input.evaluate((element) => {
    if (!element.isConnected) return "";
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      return element.value || "";
    }
    return element.innerText || element.textContent || "";
  }).catch(() => "");
}

// 整段插入。逐字输入遇到 # 会弹出话题框，后续字符进不了描述；编辑器重绘后旧节点也会失效。
async function insertFieldText(input, text) {
  await input.evaluate((element, value) => {
    if (!element.isConnected) throw new Error("输入框已脱离页面");
    element.focus();
    if (element instanceof HTMLInputElement || element instanceof HTMLTextAreaElement) {
      const prototype = element instanceof HTMLInputElement
        ? HTMLInputElement.prototype
        : HTMLTextAreaElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(prototype, "value")?.set;
      setter?.call(element, value);
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
      element.dispatchEvent(new Event("change", { bubbles: true }));
      return;
    }
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(element);
    selection.removeAllRanges();
    selection.addRange(range);
    document.execCommand("delete", false);
    if (!document.execCommand("insertText", false, value)) {
      element.textContent = value;
      element.dispatchEvent(new InputEvent("input", { bubbles: true, inputType: "insertText", data: value }));
    }
  }, text);
}

async function fillAndVerify(page, selectors, text, fieldName) {
  const normalizedExpected = normalizeFieldText(text);
  let lastText = "";
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const input = await findVisibleEditable(page, selectors);
    if (!input) throw new Error(`未找到${fieldName}输入框`);
    try {
      await insertFieldText(input, text);
    } catch (error) {
      lastText = error instanceof Error ? error.message : String(error);
      await page.waitForTimeout(400);
      continue;
    }
    await page.waitForTimeout(300);
    const current = await findVisibleEditable(page, selectors);
    lastText = current ? normalizeFieldText(await readFieldText(current)) : "";
    if (lastText.includes(normalizedExpected)) return;
    await page.waitForTimeout(400);
  }
  throw new Error(`${fieldName}写入后校验失败，当前内容为：${lastText || "空"}`);
}

async function fillKsCopy(page, data) {
  const title = String(data.data?.bt1 || "").trim();
  const description = String(data.data?.bdText || "").trim();
  const tags = String(data.data?.bq || "").trim();
  if (!title) throw new Error("快手标题不能为空");

  const titleInput = await findVisibleEditable(page, TITLE_SELECTORS);
  const descriptionInput = await findVisibleEditable(page, DESCRIPTION_SELECTORS);
  if (!descriptionInput) throw new Error("未找到快手作品描述输入框");

  if (titleInput) {
    await fillAndVerify(page, TITLE_SELECTORS, title, "快手标题");
  }
  const descriptionParts = [];
  if (!titleInput) descriptionParts.push(title);
  if (description && description !== title) descriptionParts.push(description);
  if (tags) {
    const existingTags = new Set(
      descriptionParts.join("\n").match(/#[^\s#】]+/g) || []
    );
    const missingTags = [...new Set(tags.split(/\s+/).filter(item => item.startsWith("#")))]
      .filter(item => !existingTags.has(item));
    if (missingTags.length) descriptionParts.push(missingTags.join(" "));
  }
  const copy = descriptionParts.join("\n").trim() || title;
  await fillAndVerify(page, DESCRIPTION_SELECTORS, copy, "快手作品描述");
  console.log(`[ks] 标题和作品描述已写入，独立标题框=${Boolean(titleInput)}`);
}

async function selectKsCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  console.log("[ks] creativeStatement 值 =", value);
  // 快手目前只支持 AI 生成 / 演绎情节 两个选项；其它值（含「无标注」）无对应选项，跳过即可。
  if (isCreativeStatementNone(value)) {
    console.log("[ks] 无标注，快手保持默认不选");
    return;
  }
  const label = resolveKsCreativeStatementLabel(value);
  // 当前快手「作者声明」下拉支持的四个文案；未匹配则跳过。
  const SUPPORTED = new Set([
    "内容为AI生成",
    "演绎情节，仅供娱乐",
    "个人观点，仅供参考",
    "素材来源于网络",
  ]);
  if (!SUPPORTED.has(label)) {
    console.warn(`[ks] 当前声明值 "${value}" 在快手没有对应选项，跳过`);
    return;
  }
  console.log("[ks] 准备选择声明:", label);

  // 1. 通过 label 文本"作者声明 / 作品声明 / 声明"定位下拉触发器；返回它的 id 给后续用 page.click。
  //    ant-design Select 监听的是 mousedown，必须用真实鼠标事件（page.click 自带）才能打开下拉。
  const triggerInfo = await page.evaluate(() => {
    var norm = function (t) {
      return String(t || "").replace(/\s+/g, "").trim();
    };
    var LABEL_KEYWORDS = ["作者声明", "作品声明", "创作声明", "声明"];
    var formItems = document.querySelectorAll(
      '[class*="edit-form-item"], [class*="form-item"]'
    );
    for (var i = 0; i < formItems.length; i++) {
      var item = formItems[i];
      var label = item.querySelector("label");
      var labelText = norm(label && label.textContent);
      var matched = false;
      for (var k = 0; k < LABEL_KEYWORDS.length; k++) {
        if (labelText.indexOf(LABEL_KEYWORDS[k]) !== -1) {
          matched = true;
          break;
        }
      }
      if (!matched) continue;
      var sel = item.querySelector(".ant-select");
      var selector = sel && sel.querySelector(".ant-select-selector");
      if (!selector) continue;
      var id = "__ks_statement_trigger_" + Date.now() + "__";
      selector.setAttribute("id", id);
      return { ok: true, matchedLabel: labelText, id: id };
    }
    var labels = [];
    for (var j = 0; j < formItems.length; j++) {
      var l = formItems[j].querySelector("label");
      labels.push(norm(l && l.textContent));
    }
    return { ok: false, labels: labels };
  });

  if (!triggerInfo || !triggerInfo.ok) {
    console.warn(
      "未找到快手声明下拉触发器，跳过。当前页 form-item labels:",
      JSON.stringify(triggerInfo && triggerInfo.labels)
    );
    return;
  }
  console.log("[ks] 找到下拉触发器, label =", triggerInfo.matchedLabel);

  // 用 puppeteer 真鼠标事件打开 dropdown（ant-design 走 mousedown）
  try {
    await page.evaluate(id => document.getElementById(id).dispatchEvent(new MouseEvent("mousedown", { bubbles: true })), triggerInfo.id);
    console.log("[ks] 已 page.click 打开下拉");
  } catch (e) {
    console.warn("[ks] page.click 失败，尝试 DOM 派发事件:", e?.message || e);
    await page.evaluate((id) => {
      const el = document.getElementById(id);
      if (!el) return;
      const rect = el.getBoundingClientRect();
      const opts = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };
      el.dispatchEvent(new MouseEvent("mousedown", opts));
      el.dispatchEvent(new MouseEvent("mouseup", opts));
      el.dispatchEvent(new MouseEvent("click", opts));
    }, triggerInfo.id);
    console.log("[ks] 已 DOM 派发 mousedown/mouseup/click");
  }

  // 2. 等下拉项可见（ant-design 用 rc-virtual-list，可见项是 .ant-select-item.ant-select-item-option，
  //    其 title 属性 = 文案；隐藏的 [role="option"] 不可点击，要忽略）
  try {
    await page.waitForFunction(
      (text) => {
        var opts = document.querySelectorAll(
          '.ant-select-dropdown .ant-select-item.ant-select-item-option'
        );
        for (var i = 0; i < opts.length; i++) {
          var o = opts[i];
          var t =
            o.getAttribute('title') ||
            ((o.querySelector('.ant-select-item-option-content') || {}).textContent || '');
          if (String(t).trim() === text) return true;
        }
        return false;
      },
      { timeout: 15000 },
      label
    );
  } catch (e) {
    console.warn("快手声明下拉项未出现:", e?.message || e);
    // 声明下拉虽然没有匹配项，但遮罩可能仍覆盖页面；关闭后再继续设置发布时间。
    await page.keyboard.press("Escape");
    await page.waitForTimeout(300);
    return;
  }

  // 3. 点选目标选项：点 .ant-select-item-option 本身（ant-design 在它上面绑定 mousedown）
  const pickResult = await page.evaluate((text) => {
    var opts = document.querySelectorAll(
      '.ant-select-dropdown .ant-select-item.ant-select-item-option'
    );
    var titles = [];
    for (var ti = 0; ti < opts.length; ti++) {
      titles.push(opts[ti].getAttribute('title') || '');
    }
    for (var i = 0; i < opts.length; i++) {
      var o = opts[i];
      var t =
        o.getAttribute('title') ||
        ((o.querySelector('.ant-select-item-option-content') || {}).textContent || '');
      if (String(t).trim() !== text) continue;
      var rect = o.getBoundingClientRect();
      var opts2 = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };
      // ant-design Option 走 mousedown 选中：派发完整事件序列保证生效
      o.dispatchEvent(new MouseEvent('mousedown', opts2));
      o.dispatchEvent(new MouseEvent('mouseup', opts2));
      o.dispatchEvent(new MouseEvent('click', opts2));
      var inner = o.querySelector('.ant-select-item-option-content');
      if (inner) {
        inner.dispatchEvent(new MouseEvent('click', opts2));
      }
      return { ok: true, titles: titles };
    }
    return { ok: false, titles: titles };
  }, label);

  if (!pickResult || !pickResult.ok) {
    console.warn(
      `未找到快手声明选项: ${label}；下拉里实际 title 列表 = ${JSON.stringify(
        pickResult && pickResult.titles
      )}`
    );
    return;
  }
  await page.waitForTimeout(300);
  console.log("[ks] 已选择声明:", label);
}

// 点击发布后必须看到平台确认。只点到按钮并等待数秒不能当作发布成功。
async function waitForKsImmediatePublish(page) {
  const deadline = Date.now() + 60 * 1000;
  let lastSnapshot = null;
  while (Date.now() < deadline) {
    const snapshot = await page.evaluate(() => {
      const norm = (text) => String(text || "").replace(/\s+/g, " ").trim();
      const visible = (node) => {
        if (!node || !node.isConnected) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const roots = Array.from(document.querySelectorAll(
        ".ant-message, .ant-message-notice, .ant-notification, .ant-modal, [role='alert'], [role='dialog']"
      ));
      const texts = [];
      for (const root of roots) {
        if (!visible(root)) continue;
        const text = norm(root.innerText || root.textContent);
        if (text && text.length <= 160) texts.push(text);
      }
      return { url: location.href, texts };
    }).catch((error) => ({
      url: "",
      texts: [],
      inspectError: error && error.message ? error.message : String(error),
    }));
    lastSnapshot = snapshot;
    const url = String(snapshot.url || "");
    const joined = (snapshot.texts || []).join(" | ");
    const stillOnPublishPage = /\/article\/publish\/video(?:[/?#]|$)/.test(url);
    const loginPage = /\/login|passport/i.test(url);
    if (url && !stillOnPublishPage && !loginPage) {
      console.log(`[ks] 平台已离开发布页：${url}`);
      return;
    }
    if (/发布成功|提交成功|发布完成|作品已发布|已成功发布/.test(joined)) {
      console.log(`[ks] 平台确认发布成功：${joined.slice(0, 300)}`);
      return;
    }
    if (/发布失败|提交失败|上传失败|请重试|无法发布|不能发布/.test(joined)) {
      throw new Error(`快手平台拒绝发布：${joined.slice(0, 300)}`);
    }
    console.log(`[ks][publish-wait] ${JSON.stringify({ url, texts: snapshot.texts })}`);
    await page.waitForTimeout(2000);
  }
  throw new Error(`点击发布后未收到快手成功确认：${JSON.stringify(lastSnapshot || {})}`);
}

export default async function (page, data, window,event) {
  const isDraftMode = data.publishMode === "draft" || data.publishToDraft === true;
  const submitText = isDraftMode ? "取消" : "发布";
  let submitting = false;
  let publication;

  console.log(data);
  try {
    const sel = KUAISHOU_VIDEO_UPLOAD_SELECTOR;
    setPublishStage(page, "等待快手视频上传控件");
    await page.waitForSelector(sel, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const uploadInputs = await page.$(sel);
    setPublishStage(page, "上传快手视频文件");
    await uploadInputs.uploadFile(path.resolve(data.filePath));
  } catch (err) {
    console.error("文件上传失败:", err);
  }

  try {
    await page.waitForFunction(
      () => Boolean(
        document.querySelector('#work-description-edit [contenteditable="true"]') ||
        document.querySelector("#work-description-edit textarea") ||
        document.querySelector("#work-description-edit input") ||
        document.querySelector('#work-description-edit[contenteditable="true"]') ||
        document.querySelector('textarea[placeholder*="描述"]') ||
        document.querySelector('[contenteditable="true"][data-placeholder*="描述"]') ||
        document.querySelector('[contenteditable="true"][aria-label*="描述"]')
      ),
      { timeout: WAIT_SELECTOR_APPEAR_MS }
    );
    setPublishStage(page, "填写快手标题和作品描述");
    await fillKsCopy(page, data);
  } catch (e) {
    throw new Error(`快手标题或作品描述填写失败：${e?.message || e}`);
  }
  try {
    await page.click(".ant-checkbox-group>label:nth-of-type(2)", { delay: 200 });
  } catch (e) {
    console.error("❌ 输入标签失败", e);
  }

  // 选择创作声明（快手只支持 AI 生成 / 演绎情节，其它值跳过）
  try {
    setPublishStage(page, "设置快手创作声明");
    await selectKsCreativeStatement(page, data);
  } catch (e) {
    console.warn("快手创作声明选择未完成:", e?.message || e);
  }

  try {
    // 用 pollPageUntil 替代 waitForSelector，避免 puppeteer 默认 protocolTimeout
    setPublishStage(page, "等待快手上传完成和预览播放器就绪");
    // (约 180s) 在大文件/弱网下把单次 Runtime.callFunctionOn 砍掉。
    await pollPageUntil(
      page,
      () => !!document.querySelector("#preview-tours video"),
      WAIT_UPLOAD_PROCESSING_MS,
      2000,
      "等待快手视频上传完成超时"
    );
    await page.waitForFunction(
      text => {
        const bar = document.querySelector("#setting-tours + div");
        if (!bar || bar.offsetParent === null) return false;
        for (const row of bar.querySelectorAll(":scope > div")) {
          const t = row.textContent.replace(/\s+/g, "").trim();
          if (t === text) return true;
        }
        return false;
      },
      { timeout: 10000 },
      submitText
    );

    setPublishStage(page, "设置快手竖版封面");
    const coverPath = data.publishOptions?.coverPath;
    const cover = coverPath ? await uploadKsCover(page, coverPath) : null;

    const isOfficialSchedule = Boolean(data.officialScheduledPublish);
    if (isOfficialSchedule) {
      setPublishStage(page, "设置快手官方预约时间");
      await setOfficialSchedule(page, "快手", data.publishAt);
    }

    // 快手发布按钮点击：原先用 page.evaluateHandle 返回行级 div 再 puppeteer click，
    // 在 hidden window 下几何中心常落不到真正的 <button> 上，结果是"看起来点过了但没发"。
    // 改为在 evaluate 内部遍历真实 button / 行 div，直接调 DOM .click()，避开鼠标几何问题。
    // 快手草稿功能和发布一个逻辑一个是 发布 一个是取消两个字
    const previousUrl = page.url();
    setPublishStage(page, "提交快手发布或草稿");
    let clicked;
    const submit = async () => {
      clicked = await page.evaluate(text => {
        const norm = t => String(t || "").replace(/\s+/g, "").trim();
        const bar = document.querySelector("#setting-tours + div");
        if (!bar) return { ok: false, reason: "no-bar" };
        for (const btn of bar.querySelectorAll("button")) {
          if (norm(btn.textContent) === text && !btn.disabled) {
            btn.click();
            return { ok: true, via: "button" };
          }
        }
        for (const row of bar.querySelectorAll(":scope > div")) {
          if (norm(row.textContent) === text) {
            const inner = row.querySelector("button,[role='button']");
            if (inner) {
              inner.click();
              return { ok: true, via: "row>inner" };
            }
            row.click();
            return { ok: true, via: "row" };
          }
        }
        return { ok: false, reason: "no-match" };
      }, submitText);
      if (!clicked || !clicked.ok) {
        throw new Error(`未找到${submitText}按钮(${clicked && clicked.reason})`);
      }
      if (isOfficialSchedule) await clickKuaishouScheduleConfirmation(page);
    };
    if (isDraftMode) {
      await submit();
    } else {
      let submission;
      submitting = true;
      const listed = await runWithKsResponse(page, "快手作品管理回执", async response => {
        if (new URL(response.url()).pathname !== "/rest/cp/works/v2/video/pc/photo/list") return false;
        if (!response.ok()) return true;
        const body = await response.json();
        return body.result !== 1 || body.data.list.some(item => item.title.startsWith(data.data.bt1));
      }, async () => {
        submission = await runWithKsResponse(page, "快手提交视频", isKsSubmitResponse, submit, 600000);
        requireKsSuccess(submission, "快手提交视频");
        const requestBody = submission.request.postData();
        const submitted = (submission.request.headers()["content-type"] || "").includes("application/json")
          ? JSON.parse(requestBody) : Object.fromEntries(new URLSearchParams(requestBody));
        console.log("[快手提交封面核对]", JSON.stringify({ uploadedCoverKey: cover?.coverKey, submittedCoverKey: submitted.coverKey }));
        if (cover && submitted.coverKey !== cover.coverKey) throw new Error("快手提交的封面key与已核验封面不一致，结果待核对，禁止自动重发");
        setPublishStage(page, "等待快手提交成功并核对作品管理接口");
        if (isOfficialSchedule) await waitForOfficialScheduleAccepted(page, "快手", previousUrl);
        else await waitForKsImmediatePublish(page);
      }, 600000);
      const body = requireKsSuccess(listed, "快手作品管理回执");
      const work = body.data.list.find(item => item.title.startsWith(data.data.bt1));
      if (!work.publishId) throw new Error("快手作品管理接口未返回作品ID，禁止自动重发");
      if (cover && work.unPublishCoverKey && work.unPublishCoverKey !== cover.coverKey) {
        throw new Error("快手作品管理返回的封面key与已核验封面不一致，禁止自动重发");
      }
      publication = { id: String(work.publishId), platform_status: work.publishStatus, cover,
        apiReceipt: { submitPath: submission.requestPath, httpStatus: submission.httpStatus,
          result: submission.body.result, managementPath: listed.requestPath } };
      fs.writeFileSync(path.join(path.dirname(path.resolve(data.filePath)), "kuaishou-publication.json"), JSON.stringify(publication, null, 2));
      console.log("[快手发布回执]", JSON.stringify(publication));
    }
    setPublishStage(page, "快手发布回执已核验");
    console.log(isDraftMode ? `✅ 快手视频已保存草稿，click via=${clicked.via}` : `✅ 快手视频已触发发布，click via=${clicked.via}`);
    event.reply("puppeteerFile-done", {
      ...data,
      status: true,
      scheduled: isOfficialSchedule,
      officialScheduled: isOfficialSchedule,
      outcome: publication,
      message: isDraftMode
        ? "保存草稿成功"
        : isOfficialSchedule
          ? `快手官方定时发布已预约: ${data.publishAt}`
          : "发布成功",
    });
    maybeClosePublishWindow(data, window);
  } catch (e) {
    const detail = (e && e.message) || String(e);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      needsAttention: submitting,
      outcome: publication || (submitting ? "unknown" : undefined),
      message: detail.length > 200 ? `${detail.slice(0, 200)}…` : detail,
    });
    console.error("❌ 发布失败", e);
  }
}

export { fillKsCopy, selectKsCreativeStatement, waitForKsImmediatePublish };
