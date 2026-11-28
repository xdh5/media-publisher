import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import type { ChildProcess } from "node:child_process";
import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { spawnCli, runMatrixPublish, stopCliProcess } from "../runner.js";

interface LoginPlatform {
  code: string;
  cli: string;
  label: string;
  official: boolean;
  qr_login: boolean;
}

export type McpContent =
  | { type: "text"; text: string }
  | { type: "image"; data: string; mimeType: string };

type LoginSession = {
  loginId: string;
  platform: string;
  accountGroup: string;
  official: boolean;
  qrPath: string;
  child: ChildProcess;
  exitCode: number | null;
  stderr: string;
  stdout: string;
};

const sessions = new Map<string, LoginSession>();

function asNonEmpty(value: unknown, name: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new Error(`${name} 不能为空`);
  }
  return value.trim();
}

async function asLoginPlatform(value: unknown): Promise<LoginPlatform> {
  const name = asNonEmpty(value, "platform");
  const result = await runMatrixPublish(["platform", name], { timeoutMs: 30_000 });
  const spec = result.lastJson;
  if (result.exitCode !== 0 || !spec || typeof spec !== "object" || Array.isArray(spec)) {
    const message = spec && typeof spec === "object" && "error" in spec
      ? String((spec as { error?: unknown }).error || "")
      : result.stderr;
    throw new Error(message || `未知平台：${name}`);
  }
  const platform = spec as LoginPlatform;
  if (!platform.qr_login && !platform.official) {
    throw new Error(`${platform.label}不能在 MCP 里登录。请先在矩媒里准备好该平台会话。`);
  }
  return platform;
}

async function requireDataGroup(name: string): Promise<string> {
  const group = asNonEmpty(name, "account_group").toLowerCase();
  const result = await runMatrixPublish(["groups"], { timeoutMs: 30_000 });
  const groups = Array.isArray(result.lastJson) ? result.lastJson.map((item) => String(item)) : [];
  if (result.exitCode !== 0 || !groups.includes(group)) {
    throw new Error(
      groups.length > 0
        ? `账号组「${name}」不在 data 中。现有账号组：${groups.join("、")}`
        : "Publisher 尚未配置账号组",
    );
  }
  return group;
}

function makeLoginId(platform: string, accountGroup: string): string {
  return `${platform}:${accountGroup}`;
}

function qrPathFor(loginId: string): string {
  const safe = loginId.replace(/[^A-Za-z0-9._-]+/g, "_");
  return path.join(os.tmpdir(), `media-publisher-login-${safe}.png`);
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function readQrImage(filePath: string): McpContent | null {
  try {
    if (!fs.existsSync(filePath) || fs.statSync(filePath).size < 80) {
      return null;
    }
    const data = fs.readFileSync(filePath).toString("base64");
    return { type: "image", data, mimeType: "image/png" };
  } catch {
    return null;
  }
}

function stopSession(loginId: string): void {
  const session = sessions.get(loginId);
  if (!session) {
    return;
  }
  try {
    if (session.exitCode === null) {
      stopCliProcess(session.child);
    }
  } catch {
    /* ignore */
  }
  sessions.delete(loginId);
}

function attachSession(session: LoginSession): void {
  session.child.stdout?.on("data", (chunk: Buffer) => {
    session.stdout += chunk.toString("utf8");
  });
  session.child.stderr?.on("data", (chunk: Buffer) => {
    session.stderr += chunk.toString("utf8");
  });
  session.child.on("close", (code) => {
    session.exitCode = typeof code === "number" ? code : 1;
  });
}

function payload(session: LoginSession, status: string, extra: Record<string, unknown> = {}) {
  return {
    status,
    login_id: session.loginId,
    platform: session.platform,
    account_group: session.accountGroup,
    qr_path: session.qrPath,
    message:
      status === "waiting_scan"
        ? "请把返回的二维码图片发给用户，用对应 App 扫码。扫完后调用 login_status。"
        : extra.message,
    ...extra,
  };
}

function withQr(session: LoginSession, text: string): McpContent[] {
  const image = readQrImage(session.qrPath);
  return image ? [image, { type: "text", text }] : [{ type: "text", text }];
}

export const loginTool: Tool = {
  name: "login",
  description:
    "为 data 账号组登录平台。抖音、快手、头条、视频号返回扫码二维码；YouTube、TikTok、Instagram、Facebook 打开系统浏览器授权。" +
    "扫码时必须把 qr_path 写进回复里的图片和文件链接。授权或扫码完成后用 login_status 查询，直到 success 再 start_publish。",
  inputSchema: {
    type: "object",
    properties: {
      platform: {
        type: "string",
        description: "扫码：douyin / kuaishou / toutiao / wechat_channels；官方授权：youtube / tiktok / instagram / facebook",
      },
      account_group: {
        type: "string",
        description: "数据库或本地配置中的账号组，登录态写入 data/<账号组>",
      },
      timeoutSec: {
        type: "number",
        description: "等待扫码的最长秒数，默认 900",
      },
      force: {
        type: "boolean",
        description: "检测到假在线或登录失效时设为 true，强制刷新旧会话并返回新二维码",
      },
    },
    required: ["platform", "account_group"],
  },
};

export const loginStatusTool: Tool = {
  name: "login_status",
  description:
    "查询 login 结果。waiting_scan 时把最新二维码再发给用户；waiting_authorization 时请用户在浏览器完成授权；success 后才能 start_publish。",
  inputSchema: {
    type: "object",
    properties: {
      login_id: {
        type: "string",
        description: "login 返回的 login_id",
      },
    },
    required: ["login_id"],
  },
};

export async function handleLogin(args: Record<string, unknown>): Promise<McpContent[]> {
  const spec = await asLoginPlatform(args.platform);
  const platform = spec.code;
  const accountGroup = await requireDataGroup(asNonEmpty(args.account_group, "account_group"));
  const timeoutSec =
    typeof args.timeoutSec === "number" && Number.isFinite(args.timeoutSec)
      ? Math.max(30, Math.floor(args.timeoutSec))
      : 900;
  const force = args.force === true;
  const loginId = makeLoginId(platform, accountGroup);
  stopSession(loginId);

  const qrFile = qrPathFor(loginId);
  try {
    fs.unlinkSync(qrFile);
  } catch {
    /* ignore */
  }

  const cliArgs = [
    "login",
    "-p",
    spec.cli,
    "--phone",
    accountGroup,
    "--save-qr-png",
    qrFile,
    "--timeout-sec",
    String(timeoutSec),
  ];
  if (force) {
    cliArgs.push("--force");
  }
  const child = spawnCli(cliArgs);
  const session: LoginSession = {
    loginId,
    platform,
    accountGroup,
    official: spec.official,
    qrPath: qrFile,
    child,
    exitCode: null,
    stderr: "",
    stdout: "",
  };
  attachSession(session);
  sessions.set(loginId, session);
  if (session.official) {
    return [
      {
        type: "text",
        text: JSON.stringify(payload(session, "waiting_authorization", {
          message: "已打开系统浏览器。请用该账号组对应的账号完成授权，然后调用 login_status。",
        })),
      },
    ];
  }

  const deadline = Date.now() + 90_000;
  while (Date.now() < deadline) {
    if (session.exitCode === 0) {
      sessions.delete(loginId);
      return [
        {
          type: "text",
          text: JSON.stringify({
            status: "success",
            login_id: loginId,
            platform,
            account_group: accountGroup,
            message: "该账号已登录，无需扫码，可直接 start_publish",
          }),
        },
      ];
    }
    if (session.exitCode !== null) {
      sessions.delete(loginId);
      throw new Error(
        `打开登录页失败（exit ${session.exitCode}）：${session.stderr.slice(0, 400) || "请检查矩媒是否已安装并可运行 cli login"}`
      );
    }
    const image = readQrImage(qrFile);
    if (image) {
      return withQr(
        session,
        JSON.stringify(payload(session, "waiting_scan"))
      );
    }
    await sleep(400);
  }

  stopSession(loginId);
  throw new Error(
    "90 秒内没有截到登录二维码。请确认本机可运行矩媒 cli login，或让用户在 GUI 里登录。"
  );
}

export async function handleLoginStatus(args: Record<string, unknown>): Promise<McpContent[]> {
  const loginId = asNonEmpty(args.login_id, "login_id");
  const session = sessions.get(loginId);
  if (!session) {
    throw new Error(`没有进行中的登录：${loginId}。请先调用 login。`);
  }
  if (session.exitCode === 0) {
    sessions.delete(loginId);
    return [
      {
        type: "text",
        text: JSON.stringify({
          status: "success",
          login_id: loginId,
          platform: session.platform,
          account_group: session.accountGroup,
          message: session.official ? "官方授权成功，可以 start_publish" : "扫码登录成功，可以 start_publish",
        }),
      },
    ];
  }
  if (session.exitCode !== null) {
    sessions.delete(loginId);
    const detail = session.stderr.slice(0, 400);
    throw new Error(
      session.exitCode === 3
        ? `扫码超时或仍未登录：${detail || "请让用户重新扫码"}`
        : `登录失败（exit ${session.exitCode}）：${detail}`
    );
  }
  if (session.official) {
    return [
      {
        type: "text",
        text: JSON.stringify(payload(session, "waiting_authorization", {
          message: "仍在等待浏览器授权。完成后再次调用 login_status。",
        })),
      },
    ];
  }
  return withQr(
    session,
    JSON.stringify(payload(session, "waiting_scan"))
  );
}
