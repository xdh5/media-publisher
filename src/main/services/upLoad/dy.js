import path from "path";
import maybeClosePublishWindow from "./closeWindow.js";
import { resolveDyCreativeStatementLabel } from "../../../shared/creativeStatement.js";
import {
  WAIT_SELECTOR_APPEAR_MS,
  WAIT_UPLOAD_PROCESSING_MS,
  pollPageUntil,
} from "./uploadTimeouts.js";
import {
  setOfficialSchedule,
  waitForOfficialScheduleAccepted,
} from "./officialSchedule.js";

async function selectDyCreativeStatement(page, data) {
  const value = data.data && data.data.creativeStatement;
  console.log("[dy] creativeStatement 值 =", value);
  // 注意：「无标注」对应抖音「无需添加自主声明」，也必须主动点选，不能跳过
  const label = resolveDyCreativeStatementLabel(value);
  console.log("[dy] 准备选择自主声明:", label);

  const opened = await page.evaluate(() => {
    const norm = (t) => String(t).replace(/\s+/g, "").trim();
    const keywords = ["请选择自主声明", "添加自主声明", "自主声明"];
    const isSelectText = (el) => {
      const cls = el.className;
      if (typeof cls !== "string") return false;
      return cls.split(/\s+/).some((c) => c.startsWith("selectText-"));
    };
    for (const el of document.querySelectorAll("[class]")) {
      if (!isSelectText(el)) continue;
      const text = norm(el.textContent);
      if (!keywords.some((k) => text.includes(norm(k)))) continue;
      el.click();
      return true;
    }
    for (const el of document.querySelectorAll(
      "span, div, label, [role='button'], .semi-select"
    )) {
      const text = norm(el.textContent);
      if (!keywords.some((k) => text.includes(norm(k)))) continue;
      if (text.length > 24) continue;
      el.click();
      return true;
    }
    return false;
  });
  if (!opened) {
    throw new Error("未找到抖音「请选择自主声明」入口");
  }

  await page.waitForSelector(".semi-modal-body .semi-radio-addon", {
    visible: true,
    timeout: WAIT_SELECTOR_APPEAR_MS,
  });

  const picked = await page.evaluate((text) => {
    const modal = document.querySelector(".semi-modal-body");
    if (!modal) return false;
    for (const addon of modal.querySelectorAll(".semi-radio-addon")) {
      if (addon.textContent.trim() !== text) continue;
      const labelEl = addon.closest("label.semi-radio");
      if (labelEl) {
        labelEl.click();
        return true;
      }
    }
    return false;
  }, label);

  if (!picked) {
    throw new Error(`未找到抖音自主声明选项: ${label}`);
  }
  await page.waitForTimeout(400);

  // 点击弹窗里的「确认」按钮提交声明
  const confirmed = await page.evaluate(() => {
    const modal = document.querySelector(".semi-modal-body");
    const root = modal ? modal.closest(".semi-modal") || modal : document;
    const btn = root.querySelector(".semi-button.semi-button-primary");
    if (btn) {
      btn.click();
      return true;
    }
    return false;
  });
  if (!confirmed) {
    throw new Error("未找到抖音自主声明确认按钮");
  }
  console.log("[dy] 已点击声明确认按钮");
  await page.waitForTimeout(400);
}

async function selectDyCreativeStatementWithRetry(page, data, maxMs = 60000) {
  const deadline = Date.now() + maxMs;
  let lastErr = null;
  while (Date.now() < deadline) {
    try {
      await selectDyCreativeStatement(page, data);
      return;
    } catch (e) {
      lastErr = e;
      await page.waitForTimeout(2000);
    }
  }
  throw lastErr || new Error("抖音自主声明选择失败");
}

async function clickDyPublish(page, isDraftMode) {
  if (!isDraftMode) {
    const dismissedGuide = await page.evaluate(() => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const button = [...document.querySelectorAll("button, [role='button']")]
        .find((element) => visible(element) && norm(element.textContent) === "我知道了");
      if (!button) return false;
      button.click();
      return true;
    });
    if (dismissedGuide) {
      console.log("[dy] 已关闭遮挡发布按钮的页面引导");
      await page.waitForTimeout(500);
    }
  }

  const submitSelector = isDraftMode
    ? "#popover-tip-container+button"
    : "#popover-tip-container";
  if (isDraftMode) {
    const submitBtn = await page.waitForSelector(submitSelector, {
      timeout: WAIT_SELECTOR_APPEAR_MS,
      visible: true,
    });
    await submitBtn.click({ delay: 200 });
  } else {
    await page.waitForFunction(() => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const visible = (element) => {
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      return [...document.querySelectorAll("button, [role='button']")]
        .some((element) => visible(element) && !element.disabled && norm(element.textContent) === "发布");
    }, { timeout: WAIT_SELECTOR_APPEAR_MS });
    const buttonHandles = await page.$$("button, [role='button']");
    let clicked = false;
    for (const buttonHandle of buttonHandles) {
      const isPublishButton = await buttonHandle.evaluate((element) => {
        const text = String(element.textContent || "").replace(/\s+/g, "").trim();
        const style = window.getComputedStyle(element);
        const rect = element.getBoundingClientRect();
        return (
          text === "发布" &&
          !element.disabled &&
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      });
      if (!isPublishButton) continue;
      await buttonHandle.click({ delay: 200 });
      clicked = true;
      break;
    }
    if (!clicked) throw new Error("抖音真实发布按钮点击失败");
  }
  console.log(
    isDraftMode
      ? "[dy] 已点击存草稿按钮 (#popover-tip-container+button)"
      : "[dy] 已点击真实发布按钮（文字=发布）"
  );
}

// 点击发布后必须看到平台确认。只点到按钮并等待数秒不能当作发布成功。
async function waitForDyImmediatePublish(page) {
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
        ".semi-toast, .semi-toast-content, .semi-notification, .semi-modal, .semi-banner, [role='alert'], [role='dialog']"
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
    const stillOnPublishPage = /\/content\/post\/video(?:[/?#]|$)/.test(url);
    const loginPage = /\/login|passport/i.test(url);
    if (url && !stillOnPublishPage && !loginPage) {
      console.log(`[dy] 平台已离开发布页：${url}`);
      return;
    }
    if (/发布成功|提交成功|发布完成|作品已发布|已成功发布/.test(joined)) {
      console.log(`[dy] 平台确认发布成功：${joined.slice(0, 300)}`);
      return;
    }
    if (/发布失败|提交失败|上传失败|请重试|无法发布|不能发布/.test(joined)) {
      throw new Error(`抖音平台拒绝发布：${joined.slice(0, 300)}`);
    }
    console.log(`[dy][publish-wait] ${JSON.stringify({ url, texts: snapshot.texts })}`);
    await page.waitForTimeout(2000);
  }
  throw new Error(`点击发布后未收到抖音成功确认：${JSON.stringify(lastSnapshot || {})}`);
}

function readDyTitleValue() {
  const root = document.querySelector(".semi-input");
  const input =
    root && root.matches("input,textarea")
      ? root
      : root && root.querySelector("input,textarea");
  return input ? String(input.value || "") : "";
}

async function fillDyTitle(page, title) {
  const expected = String(title || "");
  if (!expected) {
    throw new Error("抖音标题为空");
  }
  // 上传后平台会异步把文件名写进标题框。等它落定再清空，避免写完后又被接上一次。
  await page
    .waitForFunction(
      () => {
        const root = document.querySelector(".semi-input");
        const input =
          root && root.matches("input,textarea")
            ? root
            : root && root.querySelector("input,textarea");
        return Boolean(input && String(input.value || "").trim());
      },
      { timeout: 8000 }
    )
    .catch(() => {});

  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const input = await page.$(".semi-input");
    if (!input) {
      throw new Error("未找到抖音标题输入框");
    }
    await input.click();
    await page.keyboard.down("Control");
    await page.keyboard.press("KeyA");
    await page.keyboard.up("Control");
    await page.keyboard.press("Backspace");
    await page.evaluate(() => {
      const root = document.querySelector(".semi-input");
      const input =
        root && root.matches("input,textarea")
          ? root
          : root && root.querySelector("input,textarea");
      if (!input) return;
      input.focus();
      const proto =
        input instanceof HTMLTextAreaElement
          ? HTMLTextAreaElement.prototype
          : HTMLInputElement.prototype;
      const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
      setter?.call(input, "");
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "deleteContentBackward",
          data: null,
        })
      );
      input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    const residue = await page.evaluate(readDyTitleValue);
    if (residue) {
      console.log(`[dy] 标题框第 ${attempt} 次清空后仍有残留：${residue}`);
    }
    await page.type(".semi-input", expected, { delay: 50 });
    await page.waitForTimeout(300);
    const written = await page.evaluate(readDyTitleValue);
    if (written === expected) {
      console.log(`[dy] 标题已写入：${written}`);
      return;
    }
    console.log(`[dy] 标题与预期不一致，期望「${expected}」，实际「${written}」`);
  }
  throw new Error(`抖音标题被重复写入或未能清空：${expected}`);
}

export default async function (page, data, window, event) {
  const isDraftMode =
    data.publishMode === "draft" || data.publishToDraft === true;

  try {
    // 等待 name=upload-btn 的 input 出现
    await page.waitForSelector('input[name="upload-btn"]', {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    const uploadInputs = await page.$$('input[name="upload-btn"]');
    // 取最后一个 input 元素
    const uploadFileHandle = uploadInputs[uploadInputs.length - 1];
    await uploadFileHandle.uploadFile(path.resolve(data.filePath));
  } catch (e) {
    console.error("❌ 输入文件失败", e);
  }
  try {
    await page.waitForSelector(".semi-input", {
      timeout: WAIT_SELECTOR_APPEAR_MS,
    });
    await fillDyTitle(page, data.data.bt1);

    const input2 = await page.$(".zone-container.editor-kit-container");
    await input2.click(); // 三击全选
    const description = String(data.data.bdText || "").trim();
    const fallbackDescription = [data.data.bt2, data.data.bq]
      .map(value => String(value || "").trim())
      .filter(Boolean)
      .join(" ");
    await page.keyboard.type(description || fallbackDescription, { delay: 50 });
    // 抖音话题只有遇到空格/回车才会把当前 #xxx 转成话题胶囊；
    // bq 末尾没有分隔符会导致最后一个标签没被识别，这里补一次空格触发。
    await page.keyboard.press("Space");
  } catch (e) {
    console.error("❌ 输入标题失败", e);
    throw e;
  }

  try {
    // 不依赖会随打包变化的 container-xxx：等预览区 video（抖音 CDN）与同容器内的 rc 进度条同时出现
    await pollPageUntil(
      page,
      () => {
        for (const v of document.querySelectorAll("video")) {
          const src = v.currentSrc || v.getAttribute("src") || "";
          if (!src.includes("douyin.com")) continue;
          const parent = v.parentElement;
          if (
            parent &&
            parent.querySelector(".rc-slider.rc-slider-horizontal")
          ) {
            return true;
          }
        }
        return false;
      },
      WAIT_UPLOAD_PROCESSING_MS
    );

    // 「保存权限」区域往往在预览视频就绪后才挂载；放在预览等待之后，并放宽文案/控件匹配
    await page.waitForFunction(
      () => {
        const norm = (t) => String(t).replace(/\s+/g, "").trim();
        const hasSaveTitleIn = (root) =>
          [...root.querySelectorAll("span")].some((s) =>
            norm(s.textContent).includes("保存权限")
          );
        for (const label of document.querySelectorAll("label")) {
          if (!label.textContent.includes("不允许")) continue;
          const inp = label.querySelector('input[value="0"]');
          if (!inp || (inp.type !== "checkbox" && inp.type !== "radio"))
            continue;
          let a = label;
          for (let i = 0; i < 28 && a; i++) {
            if (hasSaveTitleIn(a)) return true;
            a = a.parentElement;
          }
        }
        return false;
      },
      { timeout: 30000 }
    );
    const saved = await page.evaluate(() => {
      const norm = (t) => String(t).replace(/\s+/g, "").trim();
      const hasSaveTitleIn = (root) =>
        [...root.querySelectorAll("span")].some((s) =>
          norm(s.textContent).includes("保存权限")
        );
      for (const label of document.querySelectorAll("label")) {
        if (!label.textContent.includes("不允许")) continue;
        const inp = label.querySelector('input[value="0"]');
        if (!inp || (inp.type !== "checkbox" && inp.type !== "radio")) continue;
        let a = label;
        for (let i = 0; i < 28 && a; i++) {
          if (hasSaveTitleIn(a)) {
            label.click();
            return true;
          }
          a = a.parentElement;
        }
      }
      return false;
    });
    if (!saved) throw new Error("未找到保存权限-不允许");

    // 自主声明入口在视频转码完成后才出现，必须在点击发布前完成
    await selectDyCreativeStatementWithRetry(page, data);

    const isOfficialSchedule = Boolean(data.officialScheduledPublish);
    if (isOfficialSchedule) {
      await setOfficialSchedule(page, "抖音", data.publishAt);
    }

    const previousUrl = page.url();
    await clickDyPublish(page, isDraftMode);
    if (isOfficialSchedule) {
      await waitForOfficialScheduleAccepted(page, "抖音", previousUrl, data.title, window);
    }
    console.log(
      isDraftMode
        ? "✅ 抖音视频已保存草稿"
        : isOfficialSchedule
          ? `✅ 抖音视频已由平台预约到 ${data.publishAt}`
          : "✅ 抖音视频已触发发布"
    );
    if (!isDraftMode && !isOfficialSchedule) {
      await waitForDyImmediatePublish(page);
    }
    event.reply("puppeteerFile-done", {
      ...data,
      status: true,
      scheduled: isOfficialSchedule,
      officialScheduled: isOfficialSchedule,
      message: isDraftMode
        ? "保存草稿成功"
        : isOfficialSchedule
          ? `抖音官方定时发布已预约: ${data.publishAt}`
          : "发布成功",
    });
    maybeClosePublishWindow(data, window);
  } catch (e) {
    const detail = (e && e.message) || String(e);
    event.reply("puppeteerFile-done", {
      ...data,
      status: false,
      message: detail.length > 200 ? `${detail.slice(0, 200)}…` : detail,
    });
    console.error("❌ 上传失败", e);
  }
}
