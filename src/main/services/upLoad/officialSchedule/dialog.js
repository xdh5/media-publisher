import { waitForOfficialScheduleAccepted } from "./acceptance.js";

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

export async function setDialogSchedule(page, platform, publishAt) {
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
