import type { Tool } from "@modelcontextprotocol/sdk/types.js";
import { runMatrixPublish } from "../runner.js";

export const listAccountsTool: Tool = {
  name: "list_accounts",
  description:
    "列出 data 目录里的账号组及其平台账号。浏览器平台来自 data/<账号组>/Partitions，" +
    "YouTube、TikTok、Instagram、Facebook 来自该账号组的官方凭据。结果与统一发布使用同一份 publishing。",
  inputSchema: {
    type: "object",
    properties: {
      account_group: {
        type: "string",
        description: "可选。只看某一个账号组；不传则列出 data 里现有的全部账号组",
      },
      platform: {
        type: "string",
        description:
          "可选平台过滤。国内：douyin / kuaishou / toutiao / wechat_channels / bilibili；海外：youtube / tiktok / instagram / facebook",
      },
    },
    required: [],
  },
};

export async function handleListAccounts(args: Record<string, unknown>): Promise<string> {
  const cliArgs = ["accounts"];
  const accountGroup = args.account_group == null ? "" : String(args.account_group).trim();
  const platform = args.platform == null ? "" : String(args.platform).trim();
  if (accountGroup) cliArgs.push("--group", accountGroup);
  if (platform) cliArgs.push("--platform", platform);
  const result = await runMatrixPublish(cliArgs, { timeoutMs: 120_000 });
  if (result.exitCode !== 0) {
    const payload = result.lastJson;
    const message = payload && typeof payload === "object" && "error" in payload
      ? String((payload as { error?: unknown }).error || "")
      : result.stderr;
    throw new Error(message || "读取账号组失败");
  }
  return JSON.stringify(result.lastJson);
}

export const configureAccountsTool: Tool = {
  name: "configure_accounts",
  description: "完整保存 Publisher 本地账号目录，凭据只传引用，不传密钥正文。",
  inputSchema: { type: "object", properties: {
    groups: { type: "array", items: { type: "object", properties: { code: { type: "string" }, name: { type: "string" }, enabled: { type: "boolean" } }, required: ["code", "name"] } },
    members: { type: "array", items: { type: "object", properties: {
      group_code: { type: "string" }, platform: { type: "string" }, account_key: { type: "string" },
      connector_account_id: { type: "string" }, platform_account_id: { type: "string" },
      credential_ref: { type: "string" }, account_ref: { type: "string" }, display_name: { type: "string" }, enabled: { type: "boolean" },
    }, required: ["group_code", "platform", "account_key"] } },
  }, required: ["groups", "members"] },
};

export async function handleConfigureAccounts(args: Record<string, unknown>): Promise<string> {
  const result = await runMatrixPublish(["configure-accounts"], { stdin: JSON.stringify(args) });
  if (result.exitCode !== 0) throw new Error(JSON.stringify(result.lastJson) || result.stderr);
  return JSON.stringify(result.lastJson);
}
