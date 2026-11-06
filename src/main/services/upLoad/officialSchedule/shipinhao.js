// 视频号使用日历和时间滚轮设置预约时间。

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

export async function setShipinhaoSchedule(page, publishAt) {
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
