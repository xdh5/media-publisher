"use strict";

import { WAIT_SELECTOR_APPEAR_MS, pollPageUntil } from "./uploadTimeouts.js";

const OFFICIAL_SCHEDULE_PLATFORMS = new Set([
  "抖音",
  "快手",
  "视频号",
  "百家号",
  "头条",
]);
const WAIT_SCHEDULE_CONFIRM_MS = 60 * 1000;
const WAIT_SCHEDULE_INPUT_MS = 15 * 1000;

export function supportsOfficialSchedule(platform) {
  return OFFICIAL_SCHEDULE_PLATFORMS.has(String(platform || "").trim());
}

export function parseOfficialPublishAt(value, nowMs = Date.now()) {
  const text = String(value || "").trim();
  const matched = text.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (!matched) {
    return { ok: false, error: "官方定时发布时间格式应为 YYYY-MM-DD HH:mm:ss" };
  }
  const [year, month, day, hour, minute, second] = matched
    .slice(1)
    .map((item) => Number(item));
  const scheduled = new Date(year, month - 1, day, hour, minute, second, 0);
  const valid =
    scheduled.getFullYear() === year &&
    scheduled.getMonth() === month - 1 &&
    scheduled.getDate() === day &&
    scheduled.getHours() === hour &&
    scheduled.getMinutes() === minute &&
    scheduled.getSeconds() === second;
  if (!valid) {
    return { ok: false, error: "官方定时发布时间不是有效日期" };
  }
  if (scheduled.getTime() <= nowMs) {
    return { ok: false, error: "官方定时发布时间必须是未来时间" };
  }
  return { ok: true, value: scheduled.getTime(), text };
}

function normalizePublishAt(value) {
  const text = String(value || "").trim();
  const matched = text.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (!matched) {
    throw new Error("官方定时发布时间格式应为 YYYY-MM-DD HH:mm:ss");
  }
  return {
    full: text,
    minute: `${matched[1]}-${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}`,
    year: matched[1],
    month: String(Number(matched[2])),
    day: String(Number(matched[3])),
    time: `${matched[4]}:${matched[5]}`,
    monthDay: `${matched[2]}月${matched[3]}日`,
    hour: String(Number(matched[4])),
    minuteValue: String(Number(matched[5])),
  };
}

async function replaceDateTimeInput(page, selector, value) {
  await pollPageUntil(
    page,
    (target) => {
      const input = [...document.querySelectorAll(target)].find((node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      });
      if (!input) return false;
      input.id = "__mm_official_schedule_input";
      return true;
    },
    selector,
    WAIT_SCHEDULE_INPUT_MS,
    1500,
    `未找到可见的官方定时发布时间输入框：${selector}`
  );
  // 抖音和快手的日期输入框是 React 受控组件，部分页面还会设置 readonly。
  // 直接键盘输入会被日期面板的默认时间覆盖，因此使用原生 setter 并派发事件。
  await page.$eval(
    "#__mm_official_schedule_input",
    (input, nextValue) => {
      input.removeAttribute("readonly");
      input.readOnly = false;
      const setter = Object.getOwnPropertyDescriptor(
        HTMLInputElement.prototype,
        "value"
      ).set;
      setter.call(input, nextValue);
      input.dispatchEvent(
        new InputEvent("input", {
          bubbles: true,
          inputType: "insertText",
          data: nextValue,
        })
      );
      input.dispatchEvent(new Event("change", { bubbles: true }));
      input.focus();
    },
    value
  );
  await page.keyboard.press("Tab");
  await page.waitForTimeout(800);

  const actual = await page.$eval("#__mm_official_schedule_input", (input) => input.value || "");
  if (!String(actual).startsWith(value.slice(0, 16))) {
    throw new Error(`平台定时发布时间填写失败，页面当前值为: ${actual || "空"}`);
  }
}

async function setDouyinSchedule(page, publishAt) {
  await page.waitForFunction(
    () => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      return [...document.querySelectorAll("label, [class]")].some((el) => {
        const className = typeof el.className === "string" ? el.className : "";
        const isRadio = className.split(/\s+/).some((name) => name.startsWith("radio"));
        return isRadio && norm(el.textContent).includes("定时发布");
      });
    },
    { timeout: WAIT_SCHEDULE_INPUT_MS }
  );

  const triggerId = await page.evaluate(() => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const candidates = [...document.querySelectorAll("label, [class]")]
      .filter((el) => {
        const className = typeof el.className === "string" ? el.className : "";
        const isRadio = className.split(/\s+/).some((name) => name.startsWith("radio"));
        return isRadio && norm(el.textContent).includes("定时发布");
      })
      .sort((a, b) => norm(a.textContent).length - norm(b.textContent).length);
    const candidate = candidates[0];
    if (!candidate) return "";
    const clickable = candidate.closest("label") || candidate;
    const id = `__mm_dy_schedule_${Date.now()}`;
    clickable.id = id;
    return id;
  });
  if (!triggerId) throw new Error("未找到抖音官方「定时发布」选项");

  await page.click(`#${triggerId}`, { delay: 100 });
  await page.waitForTimeout(500);
  await replaceDateTimeInput(
    page,
    '.semi-input[placeholder="日期和时间"]',
    publishAt.minute
  );
  console.log(`[dy] 已设置抖音官方定时发布: ${publishAt.minute}`);
}

async function setKuaishouSchedule(page, publishAt) {
  const triggerId = await page.evaluate(() => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const labels = [...document.querySelectorAll("label")];
    const title = labels.find((label) => norm(label.textContent) === "发布时间");
    if (!title) return "";
    let container = title.parentElement;
    for (let i = 0; i < 8 && container; i += 1) {
      if (container.querySelectorAll(".ant-radio-input").length >= 2) break;
      container = container.parentElement;
    }
    if (!container) return "";
    const radios = container.querySelectorAll(".ant-radio-input");
    const input = radios[1];
    if (!input) return "";
    const id = `__mm_ks_schedule_${Date.now()}`;
    input.id = id;
    return id;
  });
  if (!triggerId) throw new Error("未找到快手官方「定时发布」选项");

  const scheduleSelected = await page.evaluate((id) => {
    const input = document.getElementById(id);
    if (!input) return false;
    input.click();
    return input.checked === true;
  }, triggerId);
  if (!scheduleSelected) {
    throw new Error("已找到快手「定时发布」选项，但点击后未选中");
  }
  await page.waitForTimeout(500);

  const scheduleState = await page.evaluate(() => {
    const visible = (el) => {
      const style = window.getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const inputs = [
      ...document.querySelectorAll(
        ".ant-picker-input input, .ant-picker input, input[placeholder*='日期'], input[placeholder*='时间']"
      ),
    ].filter((input) => input.type !== "file" && visible(input));
    const input = inputs[0];
    let id = "";
    if (input) {
      id = `__mm_ks_schedule_input_${Date.now()}`;
      input.id = id;
    }
    return {
      id,
      radios: [...document.querySelectorAll(".ant-radio-input")].map(
        (radio) => ({
          checked: radio.checked,
          text: String((radio.closest("label") || radio.parentElement)?.textContent || "")
            .replace(/\s+/g, "")
            .trim(),
        })
      ),
      inputs: [...document.querySelectorAll("input")]
        .filter((item) => item.type !== "file" && visible(item))
        .map((item) => ({
          type: item.type,
          placeholder: item.placeholder || "",
          value: item.value || "",
          className: String(item.className || ""),
        })),
    };
  });
  console.log("[ks] 定时控件状态:", JSON.stringify(scheduleState));
  const dateInputId = scheduleState.id;
  if (!dateInputId) {
    throw new Error("快手已选择定时发布，但未找到可见的发布时间输入框");
  }
  const pickerAlreadyOpen = await page.evaluate(() => {
    const active = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        style.pointerEvents !== "none" &&
        rect.width > 0 &&
        rect.height > 0 &&
        !String(node.className || "").includes("-leave")
      );
    };
    return [...document.querySelectorAll(".ant-picker-dropdown")].some(active);
  });
  // 选择“定时发布”后，快手当前版本会自动打开日期时间面板；只有未打开时才点输入框。
  if (!pickerAlreadyOpen) {
    await page.click(`#${dateInputId}`, { delay: 100 });
  }
  await page.waitForFunction(
    () => {
      const visible = (node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          style.pointerEvents !== "none" &&
          rect.width > 0 &&
          rect.height > 0 &&
          !String(node.className || "").includes("-leave")
        );
      };
      return [...document.querySelectorAll(".ant-picker-dropdown")].some(visible);
    },
    { timeout: WAIT_SELECTOR_APPEAR_MS }
  );
  const targetDate = publishAt.minute.slice(0, 10);
  const selectPickerPart = async (kind, value, columnIndex = -1) => {
    const result = await page.evaluate(
      ({ partKind, expected, targetColumnIndex }) => {
        const visible = (node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return (
            style.display !== "none" &&
            style.visibility !== "hidden" &&
            style.pointerEvents !== "none" &&
            rect.width > 0 &&
            rect.height > 0 &&
            !String(node.className || "").includes("-leave")
          );
        };
        const dropdowns = [...document.querySelectorAll(".ant-picker-dropdown")].filter(visible);
        const dropdown = dropdowns[dropdowns.length - 1];
        if (!dropdown) return { ok: false, reason: "picker-missing" };

        if (partKind === "date") {
          const cell = [...dropdown.querySelectorAll(".ant-picker-cell")].find(
            (node) => String(node.getAttribute("title") || "").trim() === expected
          );
          const target = cell && (cell.querySelector(".ant-picker-cell-inner") || cell);
          if (!target || cell.classList.contains("ant-picker-cell-disabled")) {
            return {
              ok: false,
              reason: "date-option-missing",
              options: [...dropdown.querySelectorAll(".ant-picker-cell[title]")]
                .map((node) => node.getAttribute("title"))
                .filter(Boolean),
            };
          }
          const id = `__mm_ks_picker_date_${Date.now()}`;
          target.id = id;
          return { ok: true, id };
        }

        const columns = [...dropdown.querySelectorAll(".ant-picker-time-panel-column")];
        const column = columns[targetColumnIndex];
        if (!column) {
          return { ok: false, reason: "time-column-missing", columnCount: columns.length };
        }
        const expectedNumber = Number(expected);
        const cells = [...column.querySelectorAll(".ant-picker-time-panel-cell")];
        const cell = cells.find((node) => {
          const text = String(node.textContent || "").replace(/\s+/g, "").trim();
          return Number(text) === expectedNumber;
        });
        if (!cell || cell.classList.contains("ant-picker-time-panel-cell-disabled")) {
          return {
            ok: false,
            reason: "time-option-missing",
            options: cells.map((node) => String(node.textContent || "").replace(/\s+/g, "").trim()),
          };
        }
        const target = cell.querySelector(".ant-picker-time-panel-cell-inner") || cell;
        column.scrollTop = Math.max(0, cell.offsetTop - Math.floor(column.clientHeight / 2));
        const id = `__mm_ks_picker_time_${targetColumnIndex}_${Date.now()}`;
        target.id = id;
        return { ok: true, id };
      },
      { partKind: kind, expected: value, targetColumnIndex: columnIndex }
    );
    if (!result.ok) {
      throw new Error(`快手定时面板选择${kind === "date" ? "日期" : "时间"}失败：${JSON.stringify(result)}`);
    }
    // 面板位于页面底部的浮层中，可能超出无头窗口视口；直接向活动选项派发完整事件链。
    await page.waitForTimeout(250);
    await page.evaluate((id) => {
      const target = document.getElementById(id);
      if (!target) throw new Error("快手定时面板目标选项已失效");
      const rect = target.getBoundingClientRect();
      const options = {
        bubbles: true,
        cancelable: true,
        view: window,
        clientX: rect.left + rect.width / 2,
        clientY: rect.top + rect.height / 2,
        button: 0,
      };
      target.dispatchEvent(new MouseEvent("mousedown", options));
      target.dispatchEvent(new MouseEvent("mouseup", options));
      target.dispatchEvent(new MouseEvent("click", options));
    }, result.id);
    await page.waitForTimeout(350);
    const pickerState = await page.evaluate((inputId) => {
      const input = document.getElementById(inputId);
      const columns = [...document.querySelectorAll(".ant-picker-time-panel-column")];
      return {
        value: String(input?.value || "").trim(),
        selected: columns.map((column) => {
          const cell = column.querySelector(".ant-picker-time-panel-cell-selected");
          return String(cell?.textContent || "").replace(/\s+/g, "").trim();
        }),
      };
    }, dateInputId);
    console.log(
      `[ks] 快手定时面板已选择${kind === "date" ? "日期" : "时间"} ${value}，当前状态: ${JSON.stringify(pickerState)}`
    );
    if (
      kind === "time" &&
      Number(pickerState.selected[columnIndex]) !== Number(value)
    ) {
      throw new Error(
        `快手定时面板时间选项未生效，目标 ${value}，当前 ${pickerState.selected[columnIndex] || "空"}`
      );
    }
  };

  await selectPickerPart("date", targetDate);
  await selectPickerPart("time", publishAt.hour.padStart(2, "0"), 0);
  await selectPickerPart("time", publishAt.minuteValue.padStart(2, "0"), 1);
  const timeColumnCount = await page.evaluate(() => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none" && rect.width > 0 && rect.height > 0 && !String(node.className || "").includes("-leave");
    };
    const dropdowns = [...document.querySelectorAll(".ant-picker-dropdown")].filter(visible);
    const dropdown = dropdowns[dropdowns.length - 1];
    return dropdown ? dropdown.querySelectorAll(".ant-picker-time-panel-column").length : 0;
  });
  if (timeColumnCount >= 3) {
    await selectPickerPart("time", "00", 2);
  }

  const pickerConfirmed = await page.evaluate(() => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && style.pointerEvents !== "none" && rect.width > 0 && rect.height > 0 && !String(node.className || "").includes("-leave");
    };
    const dropdowns = [...document.querySelectorAll(".ant-picker-dropdown")].filter(visible);
    const dropdown = dropdowns[dropdowns.length - 1];
    const button = dropdown && (
      dropdown.querySelector(".ant-picker-ok button") ||
      [...dropdown.querySelectorAll("button")].find((node) => String(node.textContent || "").trim() === "确定")
    );
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  if (!pickerConfirmed) {
    throw new Error("快手定时面板未找到可用的“确定”按钮");
  }
  await page.waitForTimeout(800);
  const actual = await page.$eval(`#${dateInputId}`, (input) => String(input.value || "").trim());
  if (!actual.startsWith(publishAt.minute)) {
    throw new Error(`快手定时面板确认后时间不一致，页面当前值为: ${actual || "空"}`);
  }
  console.log(`[ks] 快手定时面板确认后的时间: ${actual}`);
  console.log(`[ks] 已设置快手官方定时发布: ${publishAt.full}`);
}

async function selectShipinhaoCalendarDay(page, publishAt) {
  const expected = {
    year: Number(publishAt.year),
    month: Number(publishAt.month),
    day: publishAt.day,
  };
  const deadline = Date.now() + 20000;
  let lastState = null;
  while (Date.now() < deadline) {
    const state = await page.evaluate((target) => {
      const visible = (node) => {
        if (!node || !node.getBoundingClientRect) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return (
          style.display !== "none" &&
          style.visibility !== "hidden" &&
          rect.width > 0 &&
          rect.height > 0
        );
      };
      const inCalendar = (el) => {
        let cur = el;
        for (let i = 0; i < 10 && cur; i += 1) {
          const cls = String(cur.className || "");
          if (/picker|calendar|date/i.test(cls)) return true;
          cur = cur.parentElement || (cur.getRootNode && cur.getRootNode().host) || null;
        }
        return false;
      };
      const app = document.querySelector("wujie-app.wujie_iframe");
      const root = app && app.shadowRoot;
      const scopes = [root, document].filter(Boolean);
      if (!root) return { ok: false, reason: "shadow-root-missing" };
      const allNodes = scopes.flatMap((scope) => [...scope.querySelectorAll("*")]);
      const headers = allNodes
        .filter(visible)
        .filter((node) =>
          /^\d{4}年\d{1,2}月$/.test(String(node.textContent || "").replace(/\s+/g, ""))
        )
        .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
      const headerNode = headers[0];
      if (!headerNode) return { ok: false, reason: "month-header-missing" };
      const headerText = String(headerNode.textContent || "").replace(/\s+/g, "");
      const matched = headerText.match(/^(\d{4})年(\d{1,2})月$/);
      const year = Number(matched[1]);
      const month = Number(matched[2]);
      const picker =
        headerNode.closest("[class*='picker']") ||
        headerNode.closest("[class*='calendar']") ||
        headerNode.parentElement ||
        root;
      const collectDayNodes = () => {
        const nodes = [];
        const addFrom = (scope) => {
          if (!scope || !scope.querySelectorAll) return;
          nodes.push(
            ...scope.querySelectorAll(
              ".weui-desktop-picker__table a, .weui-desktop-picker__table td, [class*='picker'] a, [class*='picker'] td, [class*='calendar'] a, [class*='calendar'] td, td, a, span"
            )
          );
        };
        addFrom(picker);
        scopes.forEach(addFrom);
        const wanted = [String(target.day), String(target.day).padStart(2, "0")];
        return [...new Set(nodes)]
          .filter(visible)
          .filter((item) => {
            const text = String(item.textContent || "").replace(/\s+/g, "").trim();
            const cls = String(item.className || "");
            return (
              wanted.includes(text) &&
              /^\d{1,2}$/.test(text) &&
              item.querySelectorAll("*").length <= 4 &&
              !/disabled|faded|unselected|outside|prev|next/i.test(cls)
            );
          })
          .filter((item) => inCalendar(item) || picker.contains(item))
          .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
      };
      if (year === target.year && month === target.month) {
        const dayCell = collectDayNodes()[0];
        if (!dayCell) {
          return {
            ok: false,
            reason: "day-missing",
            year,
            month,
            days: [...picker.querySelectorAll("a, td, span")]
              .filter(visible)
              .map((item) => ({
                text: String(item.textContent || "").replace(/\s+/g, "").trim().slice(0, 20),
                cls: String(item.className || "").slice(0, 80),
              }))
              .filter((item) => item.text)
              .slice(0, 42),
          };
        }
        dayCell.click();
        return { ok: true, action: "select-day", year, month };
      }
      const wantNext = year * 12 + month < target.year * 12 + target.month;
      const arrowScopes = [picker, ...scopes];
      const arrows = arrowScopes.flatMap((scope) =>
        [...(scope.querySelectorAll ? scope.querySelectorAll("a, i, button, span, div") : [])]
      ).filter((el) => {
        if (!visible(el)) return false;
        return /arrow|prev|next|left|right|forward|back/i.test(String(el.className || ""));
      });
      const nav = arrows.find((el) =>
        wantNext
          ? /next|right|forward/i.test(String(el.className || "")) && !/prev|left|back/i.test(String(el.className || ""))
          : /prev|left|back/i.test(String(el.className || "")) && !/next|right|forward/i.test(String(el.className || ""))
      );
      if (!nav) {
        return {
          ok: false,
          reason: "month-nav-missing",
          year,
          month,
          arrows: arrows.map((el) => String(el.className || "")).slice(0, 20),
        };
      }
      nav.click();
      return { ok: true, action: wantNext ? "next-month" : "prev-month", year, month };
    }, expected);
    lastState = state;
    if (state.ok && state.action === "select-day") {
      console.log(`[sph] 已选择视频号日期 ${publishAt.year}-${publishAt.month.padStart(2, "0")}-${publishAt.day.padStart(2, "0")}`);
      return;
    }
    if (state.ok && (state.action === "next-month" || state.action === "prev-month")) {
      console.log(`[sph] 日期面板翻月：${state.action}（当前 ${state.year}-${state.month}）`);
    } else {
      console.log(`[sph] 日期面板暂未就绪：${JSON.stringify(state)}`);
    }
    await page.waitForTimeout(400);
  }
  throw new Error(`视频号日期面板未找到可选的 ${publishAt.day} 日：${JSON.stringify(lastState)}`);
}

async function setShipinhaoSchedule(page, publishAt) {
  const selected = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { ok: false, reason: "shadow-root-missing" };
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const candidates = [...root.querySelectorAll("label")].filter(
      (label) => norm(label.textContent) === "定时"
    );
    const label = candidates[0];
    if (!label) {
      return {
        ok: false,
        reason: "schedule-radio-missing",
        labels: [...root.querySelectorAll("label")]
          .map((item) => norm(item.textContent))
          .filter(Boolean)
          .slice(-40),
      };
    }
    const input = label.querySelector('input[type="radio"]');
    if (input) input.click();
    else label.click();
    return {
      ok: input ? input.checked === true : true,
      reason: input && !input.checked ? "schedule-radio-not-checked" : "",
    };
  });
  if (!selected.ok) {
    throw new Error(`视频号选择「定时」失败：${JSON.stringify(selected)}`);
  }
  await page.waitForTimeout(500);

  const state = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    if (!root) return { ok: false, reason: "shadow-root-missing" };
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const inputs = [...root.querySelectorAll("input")].filter(
      (input) => input.type !== "file" && visible(input)
    );
    const input = inputs.find((item) => {
      const marker = `${item.placeholder || ""} ${item.className || ""}`;
      return /日期|时间|发表|date|time|picker/i.test(marker);
    });
    if (!input) {
      return {
        ok: false,
        reason: "schedule-input-missing",
        inputs: inputs.map((item) => ({
          type: item.type,
          placeholder: item.placeholder || "",
          value: item.value || "",
          className: String(item.className || ""),
        })),
      };
    }
    input.removeAttribute("readonly");
    input.readOnly = false;
    input.setAttribute("data-mm-sph-schedule", "true");
    input.focus();
    input.click();
    return {
      ok: true,
      actual: input.value || "",
      type: input.type,
      placeholder: input.placeholder || "",
      className: String(input.className || ""),
      parent: String((input.parentElement && input.parentElement.outerHTML) || "").slice(0, 1200),
    };
  });
  console.log("[sph] 定时控件状态:", JSON.stringify(state));
  if (!state.ok) {
    throw new Error(`视频号填写定时发表时间失败：${JSON.stringify(state)}`);
  }

  await page.waitForTimeout(500);
  await selectShipinhaoCalendarDay(page, publishAt);
  await page.waitForTimeout(300);

  const timeFocused = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    const input = root && root.querySelector('input[placeholder="请选择时间"]');
    if (!input) return false;
    input.removeAttribute("readonly");
    input.readOnly = false;
    input.focus();
    return true;
  });
  if (!timeFocused) throw new Error("视频号未找到独立时间输入框");

  await page.keyboard.down("Control");
  await page.keyboard.press("A");
  await page.keyboard.up("Control");
  await page.keyboard.press("Backspace");
  await page.keyboard.type(publishAt.time, { delay: 80 });
  await page.keyboard.press("Tab");
  await page.waitForTimeout(800);
  const actual = await page.evaluate(() => {
    const app = document.querySelector("wujie-app.wujie_iframe");
    const root = app && app.shadowRoot;
    const input =
      root && root.querySelector('input[data-mm-sph-schedule="true"]');
    return String((input && input.value) || "");
  });
  if (!actual.startsWith(publishAt.minute)) {
    throw new Error(
      `视频号定时发表时间填写失败，页面当前值为: ${actual || "空"}`
    );
  }
  console.log(`[sph] 已设置视频号官方定时发表: ${publishAt.minute}`);
}

async function inspectAndOpenScheduleDialog(page, platform) {
  const result = await page.evaluate((platformName) => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const selectors =
      platformName === "头条"
        ? [
            ".video-batch-footer .timer",
            ".video-batch-footer .action-footer-btn",
            "button",
            "[role='button']",
          ]
        : ["button", "[role='button']", "div", "span"];
    const candidates = [...document.querySelectorAll(selectors.join(","))]
      .filter(visible)
      .filter((node) => norm(node.textContent) === "定时发布")
      .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length);
    const found = candidates[0];
    if (!found) {
      return {
        ok: false,
        reason: "schedule-trigger-missing",
        texts: [...document.querySelectorAll("button,[role='button']")]
          .filter(visible)
          .map((node) => norm(node.textContent))
          .filter(Boolean)
          .slice(-40),
      };
    }
    const target = found.closest("button,[role='button']") || found;
    const id = `__mm_official_schedule_trigger_${Date.now()}`;
    target.id = id;
    return {
      ok: true,
      id,
      tag: target.tagName,
      className: String(target.className || ""),
      disabled: Boolean(target.disabled),
      outerHtml: String(target.outerHTML || "").slice(0, 3000),
    };
  }, platform);
  if (!result.ok) {
    throw new Error(`${platform}未找到官方「定时发布」入口：${JSON.stringify(result)}`);
  }
  if (platform === "百家号") {
    const box = await page.evaluate((id) => {
      const target = document.getElementById(id);
      if (!target || target.disabled) return null;
      target.scrollIntoView({ block: "center", inline: "center" });
      const rect = target.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
    }, result.id);
    if (!box || box.width < 2 || box.height < 2) {
      throw new Error("百家号官方定时发布按钮没有可点击区域");
    }
    await page.mouse.click(box.x, box.y, { delay: 80 });
  } else {
    const clicked = await page.evaluate((id) => {
      const target = document.getElementById(id);
      if (!target || target.disabled) return false;
      target.scrollIntoView({ block: "center", inline: "center" });
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      target.click();
      return true;
    }, result.id);
    if (!clicked) throw new Error(`${platform}官方定时发布按钮点击失败`);
  }
  await page.waitForTimeout(800);
  return result;
}

async function setDialogSchedule(page, platform, publishAt) {
  const trigger = await inspectAndOpenScheduleDialog(page, platform);
  console.log(`[${platform === "头条" ? "tt" : "bjh"}] 官方定时入口:`, JSON.stringify(trigger));
  const firstModalOpened = await page.evaluate((platformName) => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const selector = platformName === "头条"
      ? ".common-timing-picker"
      : ".cheetah-modal-confirm, .cheetah-modal-content, [class*='timepublish']";
    return [...document.querySelectorAll(selector)].some(visible);
  }, platform);
  const dismissedGuide = await page.evaluate(() => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const button = [...document.querySelectorAll("button,[role='button']")]
      .find((node) => visible(node) && norm(node.textContent) === "我知道了");
    if (!button) return false;
    button.click();
    return true;
  });
  if (dismissedGuide) {
    await page.waitForTimeout(500);
    if (!firstModalOpened) {
      await inspectAndOpenScheduleDialog(page, platform);
    }
  }
  const state = await page.evaluate(() => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return (
        style.display !== "none" &&
        style.visibility !== "hidden" &&
        rect.width > 0 &&
        rect.height > 0
      );
    };
    const inputs = [...document.querySelectorAll("input")]
      .filter((input) => input.type !== "file" && visible(input))
      .map((input) => ({
        type: input.type,
        placeholder: input.placeholder || "",
        value: input.value || "",
        className: String(input.className || ""),
      }));
    const buttons = [...document.querySelectorAll("button,[role='button']")]
      .filter(visible)
      .map((button) => ({
        text: String(button.textContent || "").replace(/\s+/g, "").trim(),
        className: String(button.className || ""),
      }))
      .filter((item) => item.text)
      .slice(-50);
    const parts = [...document.querySelectorAll("div,span,li,td,a")]
      .filter(visible)
      .map((node) => ({
        tag: node.tagName,
        text: String(node.textContent || "").replace(/\s+/g, " ").trim(),
        className: String(node.className || ""),
      }))
      .filter(
        (item) =>
          item.text.length <= 140 &&
          /日期|时间|年|月|日|时|分|今天|明天|calendar|picker|date|time/i.test(
            `${item.text} ${item.className}`
          )
      )
      .slice(-180);
    const modal =
      document.querySelector(".common-timing-picker") ||
      document.querySelector("[class*='timing-picker']") ||
      document.querySelector("[class*='timepublish']") ||
      document.querySelector(".cheetah-modal-confirm") ||
      document.querySelector(".cheetah-modal-content") ||
      document.querySelector("[class*='schedule']");
    const modalHtml = modal ? String(modal.outerHTML || "").slice(0, 24000) : "";
    return { inputs, buttons, parts, modalHtml };
  });
  console.log(`[${platform === "头条" ? "tt" : "bjh"}] 官方定时弹窗状态:`, JSON.stringify(state));
  if (platform === "百家号") {
    const bjhPanelReady = async () => page.evaluate(() => {
      const visible = (node) => {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const wrap = document.querySelector(".timepublish-wrap-select");
      if (wrap && visible(wrap)) {
        return [...wrap.querySelectorAll(".cheetah-select-selector")].filter(visible).length >= 3;
      }
      return ["select-date", "select-hour", "select-minute"].every((id) => {
        const input = document.getElementById(id);
        return input && visible(input.closest(".cheetah-select-selector") || input);
      });
    });
    let ready = await bjhPanelReady();
    for (let attempt = 1; attempt <= 3 && !ready && trigger.id; attempt += 1) {
      console.log(`[bjh] 定时面板未出现，第 ${attempt} 次用鼠标重试点击定时发布`);
      const box = await page.evaluate((id) => {
        const target = document.getElementById(id);
        if (!target) return null;
        target.scrollIntoView({ block: "center", inline: "center" });
        const rect = target.getBoundingClientRect();
        return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
      }, trigger.id);
      if (box && box.width > 2 && box.height > 2) {
        await page.mouse.click(box.x, box.y, { delay: 80 });
      }
      await page.waitForTimeout(1000);
      ready = await bjhPanelReady();
    }
    if (!ready) {
      throw new Error(`百家号未找到日期下拉框：${JSON.stringify(state)}`);
    }
  }
  if (platform === "头条") {
    const selectValue = async (selector, value, label) => {
      const opened = await page.evaluate((targetSelector) => {
        const target = document.querySelector(targetSelector);
        if (!target) return false;
        target.click();
        return true;
      }, selector);
      if (!opened) throw new Error(`头条未找到${label}下拉框`);
      await page.waitForTimeout(250);
      const pickOnce = () =>
        page.evaluate((expected) => {
          const visible = (node) => {
            const style = window.getComputedStyle(node);
            const rect = node.getBoundingClientRect();
            return (
              style.display !== "none" &&
              style.visibility !== "hidden" &&
              rect.width > 0 &&
              rect.height > 0
            );
          };
          const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
          const candidates = [
            ...document.querySelectorAll(
              ".byte-select-option, [class*='select-option'], [role='option'], li"
            ),
          ].filter(visible);
          const target = candidates.find((node) => norm(node.textContent) === expected);
          if (!target) {
            return {
              ok: false,
              options: candidates.map((node) => norm(node.textContent)).filter(Boolean).slice(-80),
            };
          }
          target.click();
          return { ok: true };
        }, value);
      let picked = await pickOnce();
      // 头条的下拉同样是虚拟列表，目标值可能不在首屏：逐屏滚动后再重试。
      for (let scrolled = 0; !picked.ok && scrolled < 15; scrolled += 1) {
        const moved = await page.evaluate((offset) => {
          const holders = [...document.querySelectorAll("*")].filter(
            (node) => node.scrollHeight > node.clientHeight + 4 && node.clientHeight > 0
          );
          if (!holders.length) return false;
          holders.forEach((node) => {
            node.scrollTop = node.scrollTop + offset;
          });
          return true;
        }, scrolled === 0 ? 0 : 180);
        if (!moved) break;
        await page.waitForTimeout(150);
        const retried = await pickOnce();
        picked = retried.ok ? retried : { ok: false, options: [...picked.options, ...retried.options].slice(-80) };
      }
      if (!picked.ok) {
        throw new Error(`头条${label}未找到选项 ${value}：${JSON.stringify(picked.options)}`);
      }
      await page.waitForTimeout(250);
    };

    await selectValue(".common-timing-picker .day-select", publishAt.monthDay, "日期");
    await selectValue(".common-timing-picker .hour-select", publishAt.hour, "小时");
    await selectValue(
      ".common-timing-picker .minute-select",
      publishAt.minuteValue,
      "分钟"
    );
    const actual = await page.$eval(
      ".common-timing-picker .timer-time",
      (node) => String(node.textContent || "").trim()
    );
    if (actual !== publishAt.minute) {
      throw new Error(`头条定时发布时间校验失败，弹窗当前值为: ${actual || "空"}`);
    }
    const confirmed = await page.evaluate(() => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const modal = document.querySelector(".common-timing-picker");
      const button = modal && [...modal.querySelectorAll("button")].find(
        (node) => norm(node.textContent) === "定时发布"
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    });
    if (!confirmed) throw new Error("头条官方定时发布确认按钮不可用");
    await waitForOfficialScheduleAccepted(page, "头条", page.url());
    console.log(`[tt] 已确认头条官方定时发布: ${publishAt.minute}`);
    return;
  }

  const selectBjhValue = async (index, expectedList, label) => {
    const expected = (Array.isArray(expectedList) ? expectedList : [expectedList])
      .map((item) => String(item || "").replace(/\s+/g, "").trim())
      .filter(Boolean);
    const targetInfo = await page.evaluate((targetIndex) => {
      const visible = (node) => {
        if (!node) return false;
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const nativeIds = ["select-date", "select-hour", "select-minute"];
      const input = document.getElementById(nativeIds[targetIndex]);
      let target = input && (input.closest(".cheetah-select-selector") || input.closest(".cheetah-select"));
      if (!target || !visible(target)) {
        const wrap = document.querySelector(".timepublish-wrap-select");
        const selectors = wrap
          ? [...wrap.querySelectorAll(".cheetah-select-selector")].filter(visible)
          : [];
        target = selectors[targetIndex];
      }
      if (!target || !visible(target)) return { id: "", current: "" };
      const id = `__mm_bjh_schedule_select_${targetIndex}_${Date.now()}`;
      target.setAttribute("data-mm-bjh-select", id);
      return {
        id,
        listId: input && (input.getAttribute("aria-controls") || input.getAttribute("aria-owns")),
        current: String(target.querySelector(".cheetah-select-selection-item")?.textContent || "").trim(),
      };
    }, index);
    if (!targetInfo.id) throw new Error(`百家号未找到${label}下拉框`);
    await page.click(`[data-mm-bjh-select="${targetInfo.id}"]`, { delay: 100 });
    await page.waitForTimeout(500);
    const pickOnce = () =>
      page.evaluate((values, listId) => {
        const visible = (node) => {
        const style = window.getComputedStyle(node);
        const rect = node.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      // 组件会额外渲染一个与 aria-controls 同名 id 的隐藏无障碍列表（0×0），里面选项不可点：
      // 必须以含可见候选项的弹出层优先，无障碍列表只作兜底。
      const list = listId && document.getElementById(listId);
      const optionSelector = ".cheetah-select-item-option, [role='option']";
      const dropdowns = [...document.querySelectorAll(".cheetah-select-dropdown")].filter(visible);
      const popups = dropdowns.filter((node) => [...node.querySelectorAll(optionSelector)].some(visible));
      const scopes = [popups[popups.length - 1], list, ...dropdowns].filter(Boolean);
      const candidates = scopes
        .flatMap((scope) => [...scope.querySelectorAll(optionSelector)])
        .filter(visible);
      const target = candidates
        .filter((node) => values.includes(norm(node.textContent)))
        .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];
      if (!target) {
        return {
          ok: false,
          options: candidates.map((node) => norm(node.textContent)).filter(Boolean).slice(-100),
        };
      }
      target.click();
      return { ok: true };
    }, expected, targetInfo.listId);
    let picked = await pickOnce();
    // 候选项是虚拟列表，目标值可能不在首屏：把弹出层逐屏滚动后再重试，直到命中。
    for (let scrolled = 0; !picked.ok && scrolled < 15; scrolled += 1) {
      const moved = await page.evaluate((offset) => {
        const dropdowns = [...document.querySelectorAll(".cheetah-select-dropdown")];
        const popup = dropdowns[dropdowns.length - 1];
        if (!popup) return false;
        const holders = [popup, ...popup.querySelectorAll("*")].filter(
          (node) => node.scrollHeight > node.clientHeight + 4 && node.clientHeight > 0
        );
        if (!holders.length) return false;
        holders.forEach((node) => {
          node.scrollTop = node.scrollTop + offset;
        });
        return true;
      }, scrolled === 0 ? 0 : 180);
      if (!moved) break;
      await page.waitForTimeout(150);
      const retried = await pickOnce();
      picked = retried.ok ? retried : { ok: false, options: [...picked.options, ...retried.options].slice(-100) };
    }
    if (!picked.ok && index === 0) {
      const calendarPicked = await page.evaluate((iso) => {
        const visible = (node) => {
          const style = window.getComputedStyle(node);
          const rect = node.getBoundingClientRect();
          return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
        };
        const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
        const isoHit = [...document.querySelectorAll("[role='option'], .cheetah-select-item-option, li, td, span, div")]
          .filter(visible)
          .filter((node) => norm(node.textContent) === iso)
          .sort((a, b) => a.querySelectorAll("*").length - b.querySelectorAll("*").length)[0];
        if (isoHit) {
          isoHit.click();
          return true;
        }
        return false;
      }, expected[0]);
      if (calendarPicked) {
        await page.waitForTimeout(250);
        return;
      }
    }
    if (!picked.ok && index === 1) {
      // 小时选不到位不阻断发布，按日期优先继续。
      console.log(`[bjh] 小时未找到选项 ${expected.join("/")}：${JSON.stringify(picked.options)}`);
    }
    await page.waitForTimeout(250);
  };

  const isoDate = `${publishAt.year}-${String(Number(publishAt.month)).padStart(2, "0")}-${String(Number(publishAt.day)).padStart(2, "0")}`;
  const month = Number(publishAt.month);
  const day = Number(publishAt.day);
  const dateLabels = [
    isoDate,
    `${month}月${day}日`,
    `${month}月${String(day).padStart(2, "0")}日`,
    `${String(month).padStart(2, "0")}月${String(day).padStart(2, "0")}日`,
  ];
  await selectBjhValue(0, dateLabels, "日期");
  await selectBjhValue(1, [`${publishAt.hour}点`, publishAt.hour], "小时");
  await selectBjhValue(2, [
    `${publishAt.minuteValue}分`,
    `${String(Number(publishAt.minuteValue)).padStart(2, "0")}分`,
    publishAt.minuteValue,
    String(Number(publishAt.minuteValue)).padStart(2, "0"),
  ], "分钟");
  const actual = await page.evaluate(() => {
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const wrap = document.querySelector(".timepublish-wrap-select");
    const items = wrap
      ? [...wrap.querySelectorAll(".cheetah-select-selection-item")]
          .filter(visible)
          .map((node) => String(node.textContent || "").replace(/\s+/g, "").trim())
      : [];
    return items.slice(0, 3);
  });
  // 百家号的下拉是虚拟列表，小时/分钟可能选不到位；业务上只要求日期准确，时分不作为失败条件。
  // 百家号的时/分下拉是虚拟列表，目标值常常不在当前渲染窗口里，键盘逐项移动也压不到正确位置。
  // 业务约定：百家号只保证日期准确即可，小时和分钟选不到位不视为失败，照常提交定时。
  const actualText = actual.join("");
  const dateOk = dateLabels.includes(actual[0]);
  if (!dateOk) {
    throw new Error(`百家号定时发布日期校验失败，弹窗当前值为: ${actualText || "空"}`);
  }
  const hourOk = actual[1] === `${publishAt.hour}点` || actual[1] === publishAt.hour;
  if (!hourOk) console.log(`[bjh] 小时未精确命中（期望 ${publishAt.hour}点，实际 ${actual[1] || "空"}），按日期优先继续发布`);
  const confirmed = await page.evaluate(() => {
    const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
    const visible = (node) => {
      const style = window.getComputedStyle(node);
      const rect = node.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const roots = [
      ...document.querySelectorAll(
        ".cheetah-modal-confirm, .cheetah-modal-content, [class*='timepublish']"
      ),
    ].filter(visible);
    const searchRoots = roots.length ? roots : [document];
    let button = null;
    for (const root of searchRoots.reverse()) {
      button = [...root.querySelectorAll("button")].find(
        (node) => visible(node) && norm(node.textContent) === "定时发布"
      );
      if (button) break;
    }
    if (!button || button.disabled) return false;
    button.click();
    return true;
  });
  if (!confirmed) throw new Error("百家号官方定时发布确认按钮不可用");
  await waitForOfficialScheduleAccepted(page, "百家号", page.url());
  console.log(`[bjh] 已确认百家号官方定时发布: ${publishAt.minute}`);
}

export async function setOfficialSchedule(page, platform, publishAtText) {
  if (!supportsOfficialSchedule(platform)) {
    throw new Error(`${platform}不支持矩媒官方定时发布自动化`);
  }
  const publishAt = normalizePublishAt(publishAtText);
  if (platform === "抖音") {
    await setDouyinSchedule(page, publishAt);
    return;
  }
  if (platform === "快手") {
    await setKuaishouSchedule(page, publishAt);
    return;
  }
  if (platform === "视频号") {
    await setShipinhaoSchedule(page, publishAt);
    return;
  }
  await setDialogSchedule(page, platform, publishAt);
}

export async function clickKuaishouScheduleConfirmation(page) {
  const deadline = Date.now() + 10000;
  while (Date.now() < deadline) {
    const clicked = await page.evaluate(() => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const dialog = [...document.querySelectorAll(".ant-modal, [role='dialog']")]
        .find((element) => visible(element));
      if (!dialog) return false;
      for (const button of dialog.querySelectorAll("button, [role='button']")) {
        if (visible(button) && ["确认发布", "确认", "确定"].includes(norm(button.textContent))) {
          button.click();
          return true;
        }
      }
      return false;
    }).catch(() => false);
    if (clicked) {
      console.log("[ks] 已确认快手官方定时发布");
      return true;
    }
    await page.waitForTimeout(300);
  }
  return false;
}

async function confirmDouyinScheduledItem(page, expectedTitle) {
  const title = String(expectedTitle || "").replace(/\s+/g, "").trim();
  if (!title) return false;

  const manageUrl = "https://creator.douyin.com/creator-micro/content/manage";
  if (!page.url().includes("/content/manage")) {
    await page.goto(manageUrl, { waitUntil: "domcontentloaded", timeout: WAIT_SCHEDULE_CONFIRM_MS });
  }

  try {
    await page.waitForFunction((expected) => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      return [...document.querySelectorAll("body *")].some((element) => {
        const text = norm(element.textContent);
        return text === expected;
      });
    }, { timeout: WAIT_SCHEDULE_CONFIRM_MS }, title);
    return true;
  } catch {
    return false;
  }
}

export async function waitForOfficialScheduleAccepted(page, platform, previousUrl, expectedTitle = "") {
  const deadline = Date.now() + WAIT_SCHEDULE_CONFIRM_MS;
  while (Date.now() < deadline) {
    const accepted = await page.evaluate((expectedUrl, platformName) => {
      const currentUrl = location.href;
      if (
        currentUrl !== expectedUrl &&
        (currentUrl.includes("/content/manage") ||
          currentUrl.includes("/article/manage/video") ||
          currentUrl.includes("/manage/content"))
      ) {
        return true;
      }

      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const visible = (el) => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      };
      const roots = document.querySelectorAll(
        ".semi-toast, .semi-notification, .ant-message, .ant-notification, .ant-modal, .byte-message, .byte-notification, .cheetah-message, [role='alert']"
      );
      const successWords = ["定时发布成功", "预约成功", "发布成功", "提交成功", "已成功预约"];
      const hasSuccess = [...roots].some((root) => {
        const text = norm(root.textContent);
        return visible(root) && successWords.some((word) => text.includes(word));
      });
      if (hasSuccess) return true;

      if (platformName === "头条" || platformName === "百家号") {
        const errorWords = ["失败", "错误", "重试", "异常", "不可用"];
        const hasError = [...roots].some((root) => {
          const text = norm(root.textContent);
          return visible(root) && errorWords.some((word) => text.includes(word));
        });
        const modal = platformName === "头条"
          ? document.querySelector(".common-timing-picker")
          : document.querySelector(".cheetah-modal-confirm");
        if (!hasError && (!modal || !visible(modal))) return true;
      }
      return false;
    }, previousUrl, platform).catch(() => false);
    if (accepted) return;

    if (
      platform === "抖音" &&
      (page.url().includes("/creator-micro/home") || page.url().includes("/content/manage"))
    ) {
      const confirmed = await confirmDouyinScheduledItem(page, expectedTitle);
      if (confirmed) return;
      throw new Error(`抖音提交后未在作品管理找到对应作品：${expectedTitle || "标题为空"}`);
    }
    await page.waitForTimeout(500);
  }
  const diagnostic = await page.evaluate(() => {
    const norm = (text) => String(text || "").replace(/\s+/g, " ").trim();
    const visible = (element) => {
      const style = window.getComputedStyle(element);
      const rect = element.getBoundingClientRect();
      return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
    };
    const selectors = [
      ".semi-toast", ".semi-notification", ".ant-message", ".ant-notification",
      ".ant-modal", ".byte-message", ".byte-notification", ".cheetah-message",
      "[role='alert']", "[role='dialog']",
    ];
    const prompts = [...document.querySelectorAll(selectors.join(","))]
      .filter(visible)
      .map((element) => norm(element.textContent))
      .filter(Boolean)
      .slice(0, 8);
    const buttons = [...document.querySelectorAll("button, [role='button']")]
      .filter(visible)
      .map((element) => ({ text: norm(element.textContent), disabled: Boolean(element.disabled) }))
      .filter((item) => item.text)
      .slice(-12);
    return { url: location.href, prompts, buttons };
  }).catch(() => ({ url: page.url(), prompts: [], buttons: [] }));
  throw new Error(`${platform}未确认官方定时发布成功，页面状态: ${JSON.stringify(diagnostic)}`);
}
