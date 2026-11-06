import { pollPageUntil } from "../uploadTimeouts.js";

const WAIT_SCHEDULE_INPUT_MS = 15 * 1000;

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

export async function setDouyinSchedule(page, publishAt) {
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
