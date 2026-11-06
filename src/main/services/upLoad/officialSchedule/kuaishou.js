import { WAIT_SELECTOR_APPEAR_MS } from "../uploadTimeouts.js";

export async function setKuaishouSchedule(page, publishAt) {
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
