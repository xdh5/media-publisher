/** 在加载发布页前补齐 Electron 页面需要的浏览器属性。 */
export async function prepareElectronPublishPage(page) {
  // 注入反自动化检测脚本（在页面 JS 执行前生效）
  // 解决小红书等平台判定 Electron 为 "AI 自动化" 的问题
  await page.evaluateOnNewDocument(() => {
    // 1. 补全 window.chrome 对象（Electron 中缺失，正常 Chrome 有）
    if (!window.chrome) {
      window.chrome = {};
    }
    window.chrome.runtime = window.chrome.runtime || {};
    window.chrome.runtime.id =
      window.chrome.runtime.id ||
      "e" +
        Math.random().toString(36).slice(2, 11) +
        Math.random().toString(36).slice(2, 11);
    window.chrome.loadTimes =
      window.chrome.loadTimes ||
      function () {
        return {};
      };
    window.chrome.csi =
      window.chrome.csi ||
      function () {
        return {};
      };
    window.chrome.app =
      window.chrome.app ||
      function () {
        return {};
      };

    // 2. 补全 navigator.plugins（Electron 通常为空数组，正常 Chrome 有 PDF Viewer 等）
    if (
      !navigator.plugins ||
      navigator.plugins.length === 0
    ) {
      const createFakePlugin = (name, filename, desc) => {
        const plugin = {
          name,
          filename,
          description: desc,
          length: 1,
          0: { type: "application/x-google-chrome-pdf", suffixes: "pdf" },
          item() {
            return null;
          },
          namedItem() {
            return null;
          },
        };
        return plugin;
      };
      const fakePlugins = [
        createFakePlugin(
          "Chrome PDF Plugin",
          "internal-pdf-viewer",
          "Portable Document Format"
        ),
        createFakePlugin(
          "Chrome PDF Viewer",
          "mhjfbmdgcfjbbpaeojofohoefgiehjai",
          ""
        ),
        createFakePlugin(
          "Native Client",
          "internal-nacl-plugin",
          ""
        ),
      ];
      Object.defineProperty(navigator, "plugins", {
        get() {
          const arr = Object.create(
            fakePlugins.length === 0 ? Array.prototype : {
              ...Object.getPrototypeOf(fakePlugins[0]),
              length: fakePlugins.length,
              item(i) {
                return fakePlugins[i] || null;
              },
              namedItem(name) {
                return fakePlugins.find((p) => p.name === name) || null;
              },
              refresh() {},
            }
          );
          fakePlugins.forEach((p, i) => (arr[i] = p));
          return arr;
        },
      });
      Object.defineProperty(navigator, "mimeTypes", {
        get() {
          const types = [
            {
              type: "application/pdf",
              suffixes: "pdf",
              description: "Portable Document Format",
              enabledPlugin: fakePlugins[0],
            },
            {
              type: "text/pdf",
              suffixes: "pdf",
              description: "Portable Document Format",
              enabledPlugin: fakePlugins[0],
            },
          ];
          const arr = Object.create({
            ...Object.getPrototypeOf(types[0]),
            length: types.length,
            item(i) {
              return types[i] || null;
            },
            namedItem(name) {
              return types.find((t) => t.type === name) || null;
            },
          });
          types.forEach((t, i) => (arr[i] = t));
          return arr;
        },
      });
    }

    // 3. 覆盖 navigator.hardwareConcurrency（Electron 可能暴露真实核心数，正常 Chrome 会模糊）
    const cp = Object.getOwnPropertyDescriptor(
      Navigator.prototype,
      "hardwareConcurrency"
    );
    if (cp && cp.configurable) {
      Object.defineProperty(navigator, "hardwareConcurrency", {
        get() {
          return 8;
        },
      });
    }

    // 4. 补全 navigator.languages 为正常中文用户设置
    const origLanguages = navigator.languages;
    if (!origLanguages || origLanguages.length === 0) {
      Object.defineProperty(navigator, "languages", {
        get() {
          return ["zh-CN", "zh", "en"];
        },
      });
    }

    // 5. 覆盖 permissions.query（Electron 返回状态与 Chrome 不一致）
    const origQuery =
      window.navigator.permissions &&
      window.navigator.permissions.query;
    if (origQuery) {
      const origQueryFn = origQuery.bind(window.navigator.permissions);
      window.navigator.permissions.query = function (parameters) {
        if (parameters && parameters.name === "notifications") {
          return Promise.resolve({
            state: Notification.permission,
            onchange: null,
          });
        }
        return origQueryFn(parameters);
      };
    }

    // 6. 抹掉 webdriver 属性（双保险，stealth 插件也应处理了）
    Object.defineProperty(navigator, "webdriver", {
      get: () => false,
    });
  });
}
