/** 视频号内容区使用独立iframe或无界Shadow DOM。 */
export function resolveSphSurface(page) {
  const frame = page.frames().find(item => item.url().startsWith("https://channels.weixin.qq.com/micro/content/"));
  if (!frame) return page;
  const selectors = new Set(["$", "$$"]);
  const context = new Set(["evaluate", "evaluateHandle", "waitForFunction"]);
  return new Proxy(page, {
    get(target, name) {
      if (name === "waitForSelector") return async (selector, options = {}) => {
        const value = selector.replace("wujie-app.wujie_iframe >>> ", "");
        await frame.waitForFunction((query, visible) => {
          const element = document.querySelector(query);
          return element && (!visible || element.getBoundingClientRect().width > 0);
        }, { timeout: 0, polling: 100 }, value, options.visible);
        return frame.$(value);
      };
      if (name === "click") return selector => frame.evaluate(query => document.querySelector(query).click(), selector.replace("wujie-app.wujie_iframe >>> ", ""));
      if (selectors.has(name)) return (selector, ...args) => frame[name](selector.replace("wujie-app.wujie_iframe >>> ", ""), ...args);
      if (context.has(name)) return frame[name].bind(frame);
      const value = target[name];
      return typeof value === "function" ? value.bind(target) : value;
    },
  });
}
