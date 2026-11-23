"use strict";

import fs from "fs";
import path from "path";

import { BrowserWindow, app, session as electronSession } from "electron";
import pie from "puppeteer-in-electron";
import puppeteerCore from "puppeteer-core";
import { addExtra } from "puppeteer-extra";
import StealthPlugin from "puppeteer-extra-plugin-stealth";
import { nativeImage } from "electron";
import ptConfig from "../../config/ptConfig";
import {
  clearTerminalScreen,
  nativeImageToTerminalQrLines,
} from "./qrBitmapToBlocks.js";
import { cliLoginQrTerminalBlockWidth } from "./cliLoginQrRefresh.js";
import {
  tryDecodeQrPayloadFromNativeImage,
  renderQrPayloadWithQrcodeTerminal,
} from "./terminalQrQrcodeTerminal.js";
import {
  hasSphSession,
  getSphSessionId,
  normalizeSphPartition,
} from "./sphSessionUtil.js";
import { applyAccountProxyForTask } from "../proxyConfig.js";
import { verifyPublishLogin } from "./verifyPublishLogin.js";
import {
  CLI_LOGIN_QR_FIRST_DELAY_MS,
  CLI_LOGIN_QR_REFRESH_MS,
} from "./cliLoginQrRefresh.js";

const puppeteer = addExtra(puppeteerCore);
puppeteer.use(StealthPlugin());

function cliQrDebugLog(...args) {
  const v = process.env.MATRIX_CLI_QR_DEBUG;
  if (
    v === undefined ||
    v === null ||
    String(v).trim() === "" ||
    String(v).trim() === "0"
  ) {
    return;
  }
  console.error("[media-publisher][cli-qr][sph]", ...args);
}

function stripAnsi(s) {
  return String(s).replace(/\x1b\[[0-9;]*m/g, "");
}

const QR_IMAGE_XPATH = '//img[contains(concat(" ", normalize-space(@class), " "), " qrcode ")]';

async function captureQrFromIframe(page) {
  const frame = page.frames().find(item => item.url().startsWith("https://open.weixin.qq.com/connect/qrconnect")) ||
    page.frames().find(item => item.url().includes("login-for-iframe")) || page.mainFrame();
  const [image] = await frame.$x(QR_IMAGE_XPATH);
  if (!image) return null;
  const encoded = await image.evaluate(async element => {
    if (element.src.startsWith("data:")) return element.src.split(",")[1];
    const response = await fetch(element.src);
    const bytes = new Uint8Array(await response.arrayBuffer());
    let value = "";
    for (const byte of bytes) value += String.fromCharCode(byte);
    return btoa(value);
  });
  return { buf: Buffer.from(encoded, "base64"), fromDataUrl: true };
}

/**
 * 将截图写入终端
 */
async function writeSphLoginQrToStdout(image, opts) {
  if (!process.stdout.isTTY) return;
  const { width } = image.getSize();
  const termW = cliLoginQrTerminalBlockWidth(width);

  const skipDecode =
    process.env.MATRIX_CLI_QR_NO_DECODE &&
    String(process.env.MATRIX_CLI_QR_NO_DECODE).trim() !== "" &&
    String(process.env.MATRIX_CLI_QR_NO_DECODE).trim() !== "0";
  const payload = skipDecode ? null : tryDecodeQrPayloadFromNativeImage(image);

  let bodyLines;
  let modeHint;
  if (payload) {
    const art = await renderQrPayloadWithQrcodeTerminal(payload);
    bodyLines = art.split(/\n/);
    modeHint = "（jsQR + qrcode-terminal）";
    cliQrDebugLog("QR 已解码，payload 长度:", payload.length);
  } else {
    cliQrDebugLog("jsQR 未识别，使用栅格回退");
    bodyLines = nativeImageToTerminalQrLines(image, termW);
    modeHint = opts.srcHint || "（栅格）";
  }

  const visualW = Math.max(
    28,
    ...bodyLines.map((l) => stripAnsi(l).length),
    termW
  );
  const barLen = Math.min(visualW, 76);
  const bar = "-".repeat(barLen);

  clearTerminalScreen();
  process.stdout.write(
    `\x1b[0m视频号扫码登录 ${modeHint}  partition: ${opts.partitionLabel}\n${bar}\n\n`
  );
  for (const line of bodyLines) {
    process.stdout.write(line + "\n");
  }
  process.stdout.write(
    `\n${bar}\n请用微信扫描二维码登录视频号；保存图: --save-qr-png；终端异常可试 --show。\n`
  );
}

/**
 * 从 iframe 截取二维码并输出到终端 / 保存 PNG
 */
async function paintSphLoginQr(page, opts) {
  if (!process.stdout.isTTY && !opts.saveQrPngPath) return;

  const captured = await captureQrFromIframe(page);
  if (!captured || !captured.buf || !captured.buf.length) return;

  const { buf } = captured;
  const image = nativeImage.createFromBuffer(buf);
  if (!image || image.isEmpty()) return;

  const { width, height } = image.getSize();
  if (!width || !height) return;

  if (opts.saveQrPngPath) {
    try {
      fs.mkdirSync(path.dirname(opts.saveQrPngPath), { recursive: true });
      fs.writeFileSync(opts.saveQrPngPath, buf);
    } catch (e) {
      console.error("写入 --save-qr-png 失败:", e.message);
    }
  }

  if (process.stdout.isTTY) {
    await writeSphLoginQrToStdout(image, {
      partitionLabel: opts.partitionLabel,
      srcHint: "（iframe 截图）",
    });
  }
}

/**
 * CLI：打开视频号创作者首页，轮询 sessionid Cookie
 * @param {{ partition: string, show: boolean, terminalQr: boolean, timeoutMs: number, saveQrPngPath?: string | null }} opts
 * @returns {Promise<number>} 退出码
 */
export async function runSphCliLogin({
  partition,
  show,
  terminalQr,
  timeoutMs,
  saveQrPngPath = null,
  phone = null,
  force = false,
}) {
  const cfg = ptConfig.视频号;
  if (!cfg) {
    console.error("内部错误: 未找到视频号 ptConfig");
    return 1;
  }

  const part = normalizeSphPartition(partition);
  console.log(
    "[sph-cli-login] 原始 partition:",
    partition,
    "=> 实际使用:",
    part
  );

  // 与 GUI open-account-login-window 保持一致：先应用代理配置
  try {
    await applyAccountProxyForTask({ partition: part, phone, pt: "视频号" });
  } catch (proxyErr) {
    console.warn("[sph-cli-login] 应用代理失败:", proxyErr && proxyErr.message);
  }

  // 记住旧 sessionid，检测到新值后再验证真实发布页。
  // 不清除 cookie，避免破坏 login-for-iframe 页面加载
  const oldSessionId = await getSphSessionId(part);
  if (oldSessionId) {
    console.log("[sph-cli-login] 检测到旧 sessionid，将等待新的登录会话");
  }

  const useTerminalQr = Boolean(terminalQr && process.stdout.isTTY);
  if (terminalQr && !process.stdout.isTTY) {
    console.warn(
      "提示: stdout 非 TTY，无法绘制终端二维码方块图。可改用 --save-qr-png，或在有显示环境用 xvfb-run 等。"
    );
  }
  if (!useTerminalQr && !show && !saveQrPngPath) {
    console.error(
      "错误: 当前环境无法使用终端二维码，且未指定 --show 或 --save-qr-png，无法继续登录。"
    );
    return 2;
  }
  // MCP 等非 TTY 环境会同时传 --show 和 --save-qr-png：有保存路径时不弹窗，只把二维码写成 PNG
  const visibleWin = Boolean(show) && !saveQrPngPath;

  /** @type {import("puppeteer").Browser | null} */
  let pieBrowser = null;
  /** @type {import("puppeteer").Page | null} */
  let piePage = null;

  return await new Promise((resolve) => {
    let settled = false;
    let pollTimer = null;
    let qrTimer = null;
    let deadlineTimer = null;
    let verifying = false;
    /** @type {import("electron").BrowserWindow | null} */
    let win = null;

    const finish = async (code, opts = {}) => {
      if (settled) return;
      settled = true;
      if (pollTimer) clearInterval(pollTimer);
      if (qrTimer) clearInterval(qrTimer);
      if (deadlineTimer) clearTimeout(deadlineTimer);

      // 登录成功时，先将 Cookie / Storage 刷盘，再关窗口
      // 否则新 BrowserWindow 读同一 partition 时可能拿不到最新数据
      if (code === 0) {
        try {
          const ses = electronSession.fromPartition(part);
          await ses.cookies.flushStore();
          ses.flushStorageData();
        } catch (_) {}
      }

      try {
        if (pieBrowser && typeof pieBrowser.disconnect === "function") {
          pieBrowser.disconnect();
        }
      } catch (_) {}
      pieBrowser = null;
      piePage = null;
      try {
        if (win && !win.isDestroyed()) {
          win.removeAllListeners("closed");
          win.close();
        }
      } catch (_) {}
      win = null;
      if (opts.clearTerminal && useTerminalQr && process.stdout.isTTY) {
        clearTerminalScreen();
      }
      if (opts.log) {
        console.log(opts.log);
      }
      resolve(code);
    };

    const winWidth = 1100;
    const winHeight = 820;

    (async () => {
      try {
        pieBrowser = await pie.connect(app, puppeteer);
      } catch (e) {
        console.error(
          "无法连接 Puppeteer-in-Electron（终端扫码依赖 CDP）:",
          e.message
        );
        finish(1, {});
        return;
      }

      // 窗口配置与 GUI open-account-login-window 完全一致
      // 唯一区别：非 --show 时 opacity=0，窗口不可见但 Chromium 正常渲染
      win = new BrowserWindow({
        width: 1200,
        height: 800,
        opacity: visibleWin ? 1 : 0,
        title: `视频号登录 ${part}`,
        autoHideMenuBar: true,
        webPreferences: {
          partition: part,
          nodeIntegration: false,
          contextIsolation: true,
          webviewTag: false,
          devTools: true,
        },
      });

      win.on("closed", () => {
        if (!settled) {
          console.error("登录窗口已关闭，未完成登录检测。");
          finish(3, {});
        }
      });

      try {
        win.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
      } catch (_) {}

      // 先获取 piePage，通过 CDP Network.setUserAgentOverride 设置 UA
      // 这是唯一能覆盖所有请求（含 iframe）的方式
      // session.setUserAgent / webContents.setUserAgent / webRequest 都无法覆盖 iframe
      try {
        piePage = await pie.getPage(pieBrowser, win);
      } catch (e) {
        console.error("无法取得 Puppeteer Page:", e.message);
        finish(1, {});
        return;
      }

      if (cfg.useragent) {
        try {
          await piePage.setUserAgent(cfg.useragent);
          cliQrDebugLog("CDP UA 已设置:", cfg.useragent.slice(0, 60));
        } catch (e) {
          console.warn(
            "[sph-cli-login] piePage.setUserAgent 失败:",
            e && e.message
          );
        }
      }

      // UA 设置完毕后再导航
      try {
        await piePage
          .goto(cfg.index, { waitUntil: "domcontentloaded", timeout: 30000 })
          .catch(() => {});
      } catch (e) {
        console.warn(
          "[sph-cli-login] 导航失败（可能是重定向）:",
          e && e.code,
          e && e.message
        );
      }

      // 等待重定向后的登录页 + iframe 加载完成
      await new Promise((r) => setTimeout(r, 8000));

      if (visibleWin) {
        win.focus();
      }

      const paintOpts = { partitionLabel: part, saveQrPngPath };
      const shouldPaintQr = useTerminalQr || Boolean(saveQrPngPath);

      if (shouldPaintQr) {
        console.log(
          "正在加载视频号登录页，随后刷新扫码图（每 " +
            CLI_LOGIN_QR_REFRESH_MS / 1000 +
            "s）… partition:",
          part
        );
        if (saveQrPngPath) {
          console.log("二维码将写入 PNG:", saveQrPngPath);
        }
        qrTimer = setInterval(() => {
          if (settled || !piePage) return;
          // 二维码过期后页面通常只显示“刷新二维码/点击刷新”，先点击再截取新图。
          piePage
            .evaluate(() => {
              const nodes = Array.from(document.querySelectorAll("button,a,div,span,p"));
              const target = nodes.find((el) => /刷新二维码|点击刷新|重新获取/.test((el.textContent || "").trim()));
              if (target) { target.click(); return true; }
              return false;
            })
            .catch(() => false)
            .finally(() => paintSphLoginQr(piePage, paintOpts).catch(() => {}));
        }, CLI_LOGIN_QR_REFRESH_MS);
        // 首次延迟稍长，等 iframe 加载
        setTimeout(() => {
          if (!settled && piePage) {
            paintSphLoginQr(piePage, paintOpts).catch(() => {});
          }
        }, CLI_LOGIN_QR_FIRST_DELAY_MS);
      } else if (visibleWin) {
        console.log("请在浏览器窗口中完成视频号登录。partition:", part);
      }

      // 新凭证出现后，还必须通过真实发布页验证，才报告登录成功。
      pollTimer = setInterval(() => {
        if (verifying || settled) return;
        getSphSessionId(part)
          .then(async (newId) => {
            if (!newId || settled) return;
            // 无旧值 → 新出现即可；有旧值 → 必须不同
            if (!oldSessionId || newId !== oldSessionId) {
              verifying = true;
              try {
                await verifyPublishLogin(piePage, "视频号");
                await finish(0, {
                  clearTerminal: true,
                  log: "视频号登录成功，真实发布页验证通过，会话已保存。",
                });
              } catch (error) {
                console.error("视频号真实发布页验证未通过:", error.message);
              } finally {
                verifying = false;
              }
            }
          })
          .catch((e) => {
            console.error("轮询 Cookie 失败:", e.message);
          });
      }, 2000);

      deadlineTimer = setTimeout(() => {
        if (!settled) {
          console.error(
            `登录等待超时（${Math.round(
              timeoutMs / 1000
            )}s），仍未检测到 sessionid。`
          );
          finish(3, {});
        }
      }, timeoutMs);
    })().catch((e) => {
      console.error("视频号 CLI 登录初始化失败:", e.message);
      finish(1, {});
    });
  });
}

export { hasSphSession };
