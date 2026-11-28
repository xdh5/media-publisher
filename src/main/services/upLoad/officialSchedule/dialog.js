

async function inspectAndOpenScheduleDialog(page, platform, article = false) {
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
      [
            ".video-batch-footer .timer",
            ".video-batch-footer .action-footer-btn",
            "button",
            "[role='button']",
            "span",
          ];
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
  if (article) {
    const box = await page.evaluate((id) => {
      const target = document.getElementById(id);
      if (!target || target.disabled) return null;
      target.scrollIntoView({ block: "center", inline: "center" });
      const rect = target.getBoundingClientRect();
      return { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2, width: rect.width, height: rect.height };
    }, result.id);
    if (!box || box.width < 2 || box.height < 2) {
      throw new Error("头条官方定时发布按钮没有可点击区域");
    }
    await page.mouse.click(box.x, box.y, { delay: 80 });
  } else {
    const clicked = await page.evaluate((id, platform, article) => {
      const target = platform === "头条" && article
        ? [...document.querySelectorAll("button")].find(node => node.textContent.trim() === "定时发布" &&
          !node.disabled && node.getBoundingClientRect().width > 0)
        : document.getElementById(id);
      if (!target || target.disabled) return false;
      target.scrollIntoView({ block: "center", inline: "center" });
      target.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
      target.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
      target.click();
      return true;
    }, result.id, platform, article);
    if (!clicked) throw new Error(`${platform}官方定时发布按钮点击失败`);
  }
  await page.waitForTimeout(800);
  return result;
}

export async function setDialogSchedule(page, platform, publishAt, article = false) {
  if (article) await page.waitForFunction(() => [...document.querySelectorAll("button")].some(node =>
    node.textContent.trim() === "定时发布" && !node.disabled && node.getBoundingClientRect().width > 0),
  { timeout: 0, polling: 250 });
  const trigger = await inspectAndOpenScheduleDialog(page, platform, article);
  console.log(`[tt] 官方定时入口:`, JSON.stringify(trigger));
  if (article) await page.waitForSelector(".common-timing-picker", { visible: true, timeout: 0 });
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
    const selector = ".common-timing-picker";
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
  console.log(`[tt] 官方定时弹窗状态:`, JSON.stringify(state));

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
          const norm = (text) => String(text || "").replace(/\s+/g, "").replace(/\d+/g, value => String(Number(value))).trim();
          const candidates = [
            ...document.querySelectorAll(
              ".byte-select-option, [class*='select-option'], [role='option'], li"
            ),
          ].filter(visible);
          const target = candidates.find((node) => norm(node.textContent) === norm(expected));
          if (!target) {
            return {
              ok: false,
              options: candidates.map((node) => norm(node.textContent)).filter(Boolean).slice(-80),
            };
          }
          const textNode = [...target.querySelectorAll('*')].find(node =>
            node.childElementCount === 0 && norm(node.textContent) === norm(expected));
          (textNode || target).id = '__mm_timing_option';
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
      await page.click('#__mm_timing_option');
      await page.waitForFunction((targetSelector, expected) => {
        const norm = text => String(text || '').replace(/\s+/g, '').replace(/\d+/g, value => String(Number(value)));
        return norm(document.querySelector(`${targetSelector} .byte-select-view-value`)?.textContent) === norm(expected);
      }, { timeout: 0, polling: 100 }, selector, value);
    };

    await selectValue(".common-timing-picker .day-select", publishAt.monthDay, "日期");
    await selectValue(".common-timing-picker .hour-select", publishAt.hour, "小时");
    await selectValue(
      ".common-timing-picker .minute-select",
      publishAt.minuteValue,
      "分钟"
    );
    const actual = await page.$eval(
      ".common-timing-picker .timer-time, .common-timing-picker .publish-time",
      (node) => String(node.textContent || "").trim()
    );
    if (actual !== publishAt.minute) {
      throw new Error(`头条定时发布时间校验失败，弹窗当前值为: ${actual || "空"}`);
    }
    const confirmed = await page.evaluate(isArticle => {
      const norm = (text) => String(text || "").replace(/\s+/g, "").trim();
      const modal = document.querySelector(".common-timing-picker");
      const button = modal && [...modal.querySelectorAll("button")].find(
        (node) => (isArticle ? /^(预览并)?定时发布$/.test(norm(node.textContent)) : norm(node.textContent) === "定时发布")
      );
      if (!button || button.disabled) return false;
      button.click();
      return true;
    }, article);
    if (!confirmed) throw new Error("头条官方定时发布确认按钮不可用");
    console.log(`[tt] 已确认头条官方定时发布: ${publishAt.minute}`);
    return;
  }

}
