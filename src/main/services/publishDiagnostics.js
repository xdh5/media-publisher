"use strict";

import { app } from "electron";
import fs from "fs";
import path from "path";

/** 截图使用 Electron，不依赖可能已经无响应的 Puppeteer 连接。 */
export async function saveStalledPublishDiagnostics(win, state) {
  const name = `${Date.now()}-${state.taskId}-${state.attempt}`.replace(/[^\w.-]/g, "_");
  const directory = path.join(app.getPath("sessionData"), "logs", "publish-stalls", name);
  fs.mkdirSync(directory, { recursive: true });
  const screenshotPath = path.join(directory, "screenshot.png");
  let timer;
  let screenshotError = null;
  try {
    const screenshot = await Promise.race([
      win.webContents.capturePage(),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error("截图等待超过5秒")), 5000); }),
    ]);
    if (screenshot.isEmpty()) throw new Error("浏览器返回空截图");
    fs.writeFileSync(screenshotPath, screenshot.toPNG());
  } catch (error) {
    screenshotError = error.message;
  } finally {
    clearTimeout(timer);
  }
  const diagnosticPath = path.join(directory, "diagnostic.json");
  const result = { diagnosticPath, screenshotPath: screenshotError ? null : screenshotPath, screenshotError };
  fs.writeFileSync(diagnosticPath, JSON.stringify({ time: new Date().toISOString(), ...state, ...result }, null, 2));
  console.error("[发布超时诊断]", JSON.stringify(result));
  return result;
}
