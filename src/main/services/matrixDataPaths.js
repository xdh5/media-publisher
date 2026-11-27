"use strict";

import fs from "fs";
import path from "path";

function readPackageName(dir) {
  try {
    const raw = fs.readFileSync(path.join(dir, "package.json"), "utf8");
    const pkg = JSON.parse(raw);
    return pkg && pkg.name ? String(pkg.name) : "";
  } catch {
    return "";
  }
}

function walkUpForMatrixRoot(start) {
  let current = path.resolve(start);
  for (let i = 0; i < 8; i++) {
    if (readPackageName(current) === "media-publisher") return current;
    const parent = path.dirname(current);
    if (parent === current) break;
    current = parent;
  }
  return "";
}

/** 账号组使用通用标识，所有入口共享相同的会话目录规则。 */
export function validAccountGroup(value) {
  return /^[a-z][a-z0-9_]{0,63}$/.test(value);
}

export function accountGroupFromArgv(argv = process.argv) {
  const args = Array.isArray(argv) ? argv : [];
  const index = args.indexOf("--phone");
  if (index >= 0) {
    const group = String(args[index + 1] || "").split("-")[0];
    if (!validAccountGroup(group)) throw new Error("账号组必须是小写字母开头的字母、数字或下划线标识");
    return group;
  }
  if (args.includes("--partition")) throw new Error("使用 --partition 时仍须通过 --phone 指定账号组");
  return "";
}

/** 定位 media-publisher 项目根目录。 */
export function resolveMatrixRoot(app) {
  const candidates = [];
  if (app && app.isPackaged) {
    candidates.push(path.dirname(process.execPath));
  }
  candidates.push(process.cwd());
  for (const arg of process.argv) {
    if (!arg || arg.startsWith("-")) continue;
    if (arg.endsWith("main.js") || arg.endsWith(".exe") || arg === ".") {
      candidates.push(path.resolve(arg));
    }
  }
  for (const candidate of candidates) {
    const found = walkUpForMatrixRoot(candidate);
    if (found) return found;
  }
  return path.resolve(process.cwd());
}

/**
 * 把本次命令的 Electron 会话固定到 data/<账号组>。
 * 必须在 app ready 之前调用。没有账号组时落在 data 根目录。
 */
export function configureMatrixSessionData(app) {
  const group = accountGroupFromArgv();
  const dataDir = path.join(resolveMatrixRoot(app), "data", group);
  fs.mkdirSync(dataDir, { recursive: true });
  app.setPath("sessionData", dataDir);
  const runtimeDir = path.join(dataDir, "runtime");
  fs.mkdirSync(runtimeDir, { recursive: true });
  app.setPath("userData", runtimeDir);
  return dataDir;
}

/** 同一账号组独占浏览器配置；进程退出时操作系统自动释放锁。 */
export async function acquireMatrixSession(app) {
  const deadline = Date.now() + 60000;
  let reported = false;
  while (!app.requestSingleInstanceLock()) {
    if (!reported) {
      console.log("[startup] 当前账号组正在登录或发布，等待浏览器配置释放。");
      reported = true;
    }
    if (Date.now() >= deadline) {
      throw new Error("当前账号组仍有登录或发布任务运行，请等待任务完成后再试；无需重新扫码");
    }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
}
