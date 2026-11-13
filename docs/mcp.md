# MCP Server 说明

仓库内置 `mcp/` 子包，实现了 [Model Context Protocol](https://modelcontextprotocol.io) Server，让支持 MCP 的 AI 工具**无需 shell 调用**即可直接操作 media-publisher。

MCP **不直接请求 HTTP**，而是通过 stdio transport 接收 tool 调用，内部 `spawn` CLI 子进程完成实际操作。

## 构建

```bash
cd mcp && npm install && npm run build
```

构建产物：`mcp/dist/index.js`

## 配置 AI 工具

将 `MEDIA_PUBLISHER_DIR` 设为本仓库根目录的绝对路径。

**Claude Desktop**（`~/Library/Application Support/Claude/claude_desktop_config.json`）：

```json
{
  "mcpServers": {
    "media-publisher": {
      "command": "node",
      "args": ["<MEDIA_PUBLISHER_DIR>/mcp/dist/index.js"],
      "env": {
        "MEDIA_PUBLISHER_DIR": "<MEDIA_PUBLISHER_DIR>"
      }
    }
  }
}
```

**Cursor / Cline**（`.cursor/mcp.json` 或全局 MCP 配置，格式相同）：

```json
{
  "mcpServers": {
    "media-publisher": {
      "command": "node",
      "args": ["<MEDIA_PUBLISHER_DIR>/mcp/dist/index.js"],
      "env": {
        "MEDIA_PUBLISHER_DIR": "<MEDIA_PUBLISHER_DIR>"
      }
    }
  }
}
```

重启 AI 工具后即可在对话中调用下方 tool。

## Tool 一览

| Tool | 说明 |
| --- | --- |
| `list_accounts` | 列出 `data/<账号组>` 里的平台账号 |
| `login` | 为账号组扫码，或打开海外平台的系统浏览器授权 |
| `login_status` | 查询扫码或授权结果 |
| `start_publish` | 按账号组把多条视频一次发到多个平台，立即返回任务 |
| `poll_task` | 轮询发布任务 |

账号只从 `data/finance`、`data/korean`、`data/chinese` 解析，不传手机号。浏览器会话看 `Partitions`，YouTube、TikTok、Instagram、Facebook 看该账号组的官方凭据。平台账号、预约时间和实际上传都由矩媒的 `python -m publishing` 完成，media-factory 的发布 MCP 调用同一份代码。官方接口在 `python/platform_api`。

### list_accounts

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `account_group` | 否 | `finance` / `korean` / `chinese`。不传则列出 data 里现有账号组 |
| `platform` | 否 | 平台过滤 |

### login

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `platform` | 是 | 扫码：`douyin` / `kuaishou` / `toutiao` / `wechat_channels`；官方授权：`youtube` / `tiktok` / `instagram` / `facebook` |
| `account_group` | 是 | data 中的账号组 |
| `timeoutSec` | 否 | 等待秒数，默认 900 |
| `force` | 否 | 登录失效时强制刷新 |

扫码平台返回二维码图片。Agent 必须把 `qr_path` 发给用户。海外平台返回 `waiting_authorization`，用户在系统浏览器里完成授权。

### login_status

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `login_id` | 是 | `login` 返回的 `login_id` |

### start_publish

一次调用覆盖多条视频和多个平台。耗时发布在后台执行，调用后用 `poll_task` 轮询。

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `account_group` | 是 | `finance` / `korean` / `chinese` |
| `platforms` | 是 | 平台列表 |
| `items` | 是 | 视频列表。每条至少有 `title`；浏览器平台和 YouTube 需要 `file`；TikTok、Instagram、Facebook 需要 `video_url` |
| `publish_mode` | 否 | `immediate` 或 `scheduled`。平台没有单独时间时必填 |
| `publish_at` | 否 | 立即发布为 `now`；预约为带时区的未来 ISO 8601 |
| `publish_at_by_platform` | 否 | 按平台覆盖。值为 `now` 或带时区 ISO 时间 |

预约按平台处理：

- 抖音、快手、头条、视频号、百家号：转成北京时间 `YYYY-MM-DD HH:mm:ss`，必须由平台官方预约确认。
- YouTube、TikTok、Instagram、Facebook：原样把带时区的 ISO 时间交给官方接口。
- 小红书：支持平台预约发布，发布时间精确到分钟。
- 哔哩哔哩：只能立即发布。

示例：

```json
{
  "account_group": "finance",
  "platforms": ["douyin", "youtube", "tiktok"],
  "items": [
    {
      "file": "D:\\videos\\a.mp4",
      "video_url": "https://example.com/a.mp4",
      "title": "视频标题",
      "description": "描述"
    }
  ],
  "publish_at_by_platform": {
    "douyin": "2026-10-15T20:00:00+08:00",
    "youtube": "now",
    "tiktok": "2026-10-15T21:00:00+08:00"
  }
}
```

### poll_task

| 参数 | 必填 | 说明 |
| --- | --- | --- |
| `task_path` | 是 | `start_publish` 返回的任务文件 |

`done=true` 后看 `result.status`：`success`、`partial` 或 `failed`。`partial` 时 `published` 和 `failed` 都会保留。

## 登录说明

- 发布前用 `list_accounts` 确认账号组里有目标平台。
- 抖音、快手、头条、视频号未登录时调用 `login`，把二维码发给用户，再用 `login_status` 等到 `success`。
- YouTube、TikTok、Instagram、Facebook 未登录时同样调用 `login`，用户在弹出的浏览器里授权。
- 登录数据写入 `data/<账号组>`。


## 相关文档

- [CLI 说明](./cli.md)
