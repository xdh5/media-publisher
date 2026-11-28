# media-publisher

独立的发布 CLI 和 MCP。

## 安装

需要 Node.js 20、Python 3.10 以上。在 Publisher 根目录执行：

```powershell
npm install
npm run build:dir
python -m pip install ./python
```

源码运行时，将下文 `media-publisher` 替换为 `npx electron .`。

## CLI 命令

| 命令 | 功能 |
| --- | --- |
| `media-publisher cli login` | 登录 |
| `media-publisher cli accounts` | 账号预检 |
| `media-publisher cli publish` | 视频发布，支持目录批量 |
| `media-publisher cli publish-toutiao-video` | 头条视频 |
| `media-publisher cli publish-toutiao-article` | 头条文章 |
| `media-publisher cli publish-toutiao-micro` | 微头条 |
| `media-publisher cli douyin-creator-works` | 抖音作品及指标 |
| `python -m publishing configure-accounts` | 保存账号配置，JSON 从标准输入读取 |
| `python -m publishing groups` | 列出账号组 |
| `python -m publishing accounts` | 查询组内账号 |
| `python -m publishing platform <平台>` | 查询平台能力 |
| `python -m publishing publish` | JSON 批次发布，从标准输入读取 |
| `python -m platform_api.cli accounts --group <组>` | 查询官方接口账号 |
| `python -m platform_api.cli publish` | 官方接口发布 |
| `python -m platform_api.oauth` | YouTube 授权辅助 |

完整参数及请求 JSON 见 [CLI 手册](docs/cli.md)。

## 使用

```powershell
media-publisher cli login -p dy --phone demo --save-qr-png ./login.png
media-publisher cli accounts --phone demo --platforms dy,ks,sph --json
media-publisher cli publish -p dy --phone demo --file D:/video.mp4 --title "标题" --ai-chapters
media-publisher cli publish-toutiao-article --phone demo --file D:/article-request.json
Get-Content -Raw -Encoding utf8 ./accounts.json | python -m publishing configure-accounts
```

平台码：抖音 `dy`、快手 `ks`、视频号 `sph`、B站 `blbl`、头条 `tt`、YouTube `youtube`、TikTok `tiktok`、Instagram `instagram`、Facebook `facebook`。

| 可选功能 | 参数 |
| --- | --- |
| 智能章节 | `--ai-chapters` |
| 视频号原创 | `--declare-original` |
| 封面 | `--cover`、`--portrait-cover`、`--widescreen-cover` |
| B站分区 | `--category` |
| 创作声明 | `--creative-statement` |
| 预约 | `--publish-at` |
| 草稿 | `--draft` |

## 账号文件

账号组配置：`data/accounts.json`。官方凭据：`data/credentials.json` 或 `data/<账号组>/.env`。浏览器会话：`data/<账号组>/Partitions/`。

视频号首次登录保存唯一 ID 到 `data/<账号组>/wechat-channels-identity.json`。预检和上传前通过个人信息接口核对，ID 不匹配时停止发布。

运行日志：`logs/`。超时截图和诊断：`logs/publish-stalls/`。

## MCP

```powershell
cd mcp
npm install
npm run build
node dist/index.js
```

工具：`configure_accounts`、`list_accounts`、`login`、`login_status`、`start_publish`、`poll_task`。宿主设置 `MEDIA_PUBLISHER_DIR` 和 `MEDIA_PUBLISHER_PYTHON`。

## 许可

感谢 [MatrixMedia](https://github.com/hanliang97/MatrixMedia) 和 [social-auto-upload](https://github.com/dreammis/social-auto-upload)。许可证：[GPL-2.0-only](LICENSE)。
