# media-publisher

独立的发布 CLI 和 MCP，支持账号管理、登录、视频、头条文章和微头条发布。

## 安装

Node.js 20、Python 3.10 以上。在 Publisher 根目录执行：

```powershell
npm install
npm run build:dir
python -m pip install ./python
```

下文 `media-publisher` 可替换为 `npx electron .`。Python 命令在 Publisher 根目录运行，或设置 `MEDIA_PUBLISHER_DIR`。

## 平台码

| 平台 | 平台码 |
| --- | --- |
| 抖音 | dy / douyin |
| 快手 | ks / kuaishou |
| 视频号 | sph / wechat_channels |
| B站 | blbl / bilibili |
| 头条 | tt / toutiao |
| 百家号 | bjh / baijiahao |
| 小红书 | xhs / xiaohongshu |
| YouTube | youtube / yt / ytb |
| TikTok | tiktok / tk |
| Instagram | instagram / ig / ins |
| Facebook | facebook / fb |

## 账号

账号组使用小写字母开头的字母、数字或下划线，最长64位。

| 文件 | 内容 |
| --- | --- |
| data/accounts.json | 账号组、账号和凭据引用 |
| data/credentials.json | 官方接口凭据 |
| data/账号组/Partitions/ | 浏览器会话 |
| data/账号组/.env | 官方登录写入的凭据 |

accounts.json 示例：

```json
{
  "groups": [{"code":"demo","name":"demo"}],
  "members": [{
    "group_code":"demo", "platform":"youtube", "account_key":"demo_youtube",
    "connector_account_id":"频道ID", "platform_account_id":"频道ID",
    "credential_ref":"google", "enabled":true
  }]
}
```

浏览器账号的 members 可为空。credentials.json 示例：

```json
{
  "google":{"client_id":"客户端ID","client_secret":"客户端密钥","refresh_token":"刷新令牌"},
  "social":{"api_key":"Zernio密钥"}
}
```

```powershell
Get-Content -Raw -Encoding utf8 ./accounts.json | python -m publishing configure-accounts
python -m publishing groups
python -m publishing accounts --group demo --platform youtube
python -m publishing platform douyin
```

configure-accounts 完整替换账号目录。

## 登录与预检

```powershell
media-publisher cli login -p dy --phone demo --save-qr-png ./login.png
media-publisher cli login -p youtube --phone demo --client-secret ./client_secret.json
media-publisher cli accounts --phone demo --platforms dy,ks,sph --json
media-publisher cli accounts --phone demo --official --json
```

| 参数 | 说明 |
| --- | --- |
| -p、--platform | 平台码，浏览器扫码支持 dy、sph、ks、tt、xhs、blbl |
| --phone | 账号组 |
| --partition | 完整浏览器分区，仍须提供账号组 |
| --show、--hide | 请求显示或隐藏窗口，实际行为由平台决定 |
| --no-terminal-qr | 不向终端输出二维码 |
| --save-qr-png 路径 | 保存二维码图片 |
| --timeout-sec 秒数 | 登录等待上限，默认900秒 |
| --force | 刷新旧登录会话 |
| --puppeteer-headless | 抖音使用系统 Chrome/Chromium 无头登录 |
| --client-secret 文件 | Google OAuth 客户端 JSON |
| --api-key 密钥 | Zernio API Key |
| --profile ID | Zernio 资料 ID |
| -h、--help | 帮助 |

accounts 参数：`--phone`、`-p/--platform`、`--platforms`（逗号分隔）、`--official`、`--logged-in`、`--logged-out`、`--json`、`-h/--help`。platforms 与 platform、official 互斥；logged-in 与 logged-out 互斥。

## 浏览器视频

```powershell
media-publisher cli publish -p dy --phone demo --file D:/video.mp4 --title "标题" --tags "成长 职场" --ai-chapters
media-publisher cli publish -p blbl --phone demo --file D:/video.mp4 --title "标题" --category "知识" --cover D:/cover.png
```

| 参数 | 说明及默认行为 |
| --- | --- |
| -p、--platform | 平台，必填 |
| --phone | 账号组，必填 |
| --partition | 完整分区，例如 persist:demo抖音 |
| -f、--file | 本地视频或 HTTP(S) 视频 URL，远程文件先下载，任务结束清理临时文件 |
| -t、--title | 单文件标题，必填 |
| --description、--desc | 描述 |
| --tags、--bq | 空格分隔标签；抖音、快手、视频号补 #，B站、小红书按独立标签处理 |
| --bt2 | 视频号短标题，建议6–16字，不传为空 |
| --name、--book-name | 任务名称，默认取文件名 |
| --creative-statement、--cs | 创作声明，默认 none |
| --cover 路径 | 自定义封面；抖音和B站首页4:3、快手3:4、头条视频16:9、视频号分享卡片4:3 |
| --portrait-cover 路径 | 抖音或视频号3:4封面 |
| --widescreen-cover 路径 | B站16:9个人空间封面 |
| --category 分区 | B站分区，不传保留页面默认值 |
| --ai-chapters | 抖音、B站智能章节，不传不主动启用 |
| --declare-original | 视频号原创声明，不传不主动勾选 |
| --generate-image-text true/false | 头条生成图文，不传不主动修改页面状态 |
| --system-cover-index 整数 | 头条系统候选封面索引，从0开始 |
| --publish-at 时间 | 北京时间，格式 YYYY-MM-DD HH:mm:ss；不传立即发布 |
| --draft | 保存草稿，与预约互斥 |
| --show | 显示抖音、快手、视频号、B站或头条执行窗口，完成后保留现场 |
| --no-close-window | 发布结束不自动关窗 |
| --sph-product-id 编号 | 视频号挂载商品 |
| --sph-link-type none/product | 视频号链接类型 |
| --sph-link-value 编号 | 视频号商品编号，单独传入时按商品处理 |
| --dir 目录、--config/--xlsx XLSX | 目录批量模式，须配对，不能同时传 file |
| -h、--help | 帮助 |

创作声明：none、ai_generated、fiction、marketing、personal_opinion、repost、self_made_no_repost（仅B站）。

XLSX 首个工作表列为：文件名、标题、标签、描述、短标题、创作声明。文件名和标题必填，标签用逗号分隔。

## 官方平台视频

```powershell
media-publisher cli publish -p youtube --phone demo --account-id demo_youtube --file D:/video.mp4 --title "标题" --privacy public
media-publisher cli publish -p tiktok --phone demo --account-id <账号ID> --video-url https://example.com/video.mp4 --description "描述"
```

| 参数 | 说明 |
| --- | --- |
| -p、--platform | 官方平台，必填 |
| --phone | 账号组，必填 |
| --account-id | connector_account_id 或配置中的 account_key，必填 |
| -f、--file | YouTube 本地视频 |
| --video-url | TikTok、Instagram、Facebook 可下载的公网视频地址 |
| --title、--description | 标题和描述 |
| --privacy | YouTube private、unlisted、public，CLI默认 public |
| --category-id | YouTube 分类 ID，默认24 |
| --language | YouTube 语言，默认 zh |
| --made-for-kids | YouTube 儿童内容声明，不传为 false |
| --thumbnail-path | YouTube 封面文件 |
| --publication-id | YouTube 去重标识，与文件内容共同识别上传 |
| --publish-at | 带时区的未来 ISO 8601，例如 2030-01-10T18:00:00+08:00 |
| -h、--help | 帮助 |

YouTube 使用 Google API，TikTok、Instagram、Facebook 使用 Zernio。也可用 `python -m platform_api.cli publish`；查询官方账号用 `python -m platform_api.cli accounts --group demo`。

## 头条

```powershell
media-publisher cli publish-toutiao-video --phone demo --file D:/video-request.json
media-publisher cli publish-toutiao-article --phone demo --file D:/article-request.json
media-publisher cli publish-toutiao-micro --phone demo --file D:/micro-request.json
```

请求公共字段：

```json
{
  "title":"标题", "description":"描述", "tags":"", "creative_statement":"none",
  "output_dir":"D:/results", "publish_options":{}
}
```

按类型补充：

| 类型 | 请求字段 | publish_options |
| --- | --- | --- |
| video | video_path、cover_path | generateImageText：布尔值 |
| article | toutiao_article_path | quote_ai、first_publish、sync_micro：布尔值 |
| micro | micro_text、micro_image_path：单个图片路径 | quote_ai：布尔值 |

文章正文 JSON：

```json
{"title":"标题","paragraphs":[{"text":"正文"},{"text":"正文","image":"picture.png"}]}
```

正文图片相对于正文 JSON。output_dir 须已存在。视频和文章支持 `--publish-at`；专用命令不接受 `--draft`。回执写入 output_dir 下的 `toutiao-类型-publication.json`。

## JSON 批次发布

```powershell
Get-Content -Raw -Encoding utf8 ./request.json | python -m publishing publish
```

```json
{
  "account_group":"demo", "platforms":["douyin"], "publish_mode":"immediate", "publish_at":"now",
  "items":[{"title":"标题","file":"D:/video.mp4","ai_chapters":false}]
}
```

| 字段 | 说明 |
| --- | --- |
| account_group、platforms、items | 账号组、平台和内容列表 |
| publish_mode、publish_at | immediate + now；scheduled + 带时区 ISO 时间 |
| publish_at_by_platform | 按平台覆盖时间：now 或带时区 ISO 时间 |
| targets | 可代替 platforms + items，逐条指定 platform |
| title、account_key | 标题、指定账号 |
| content_type、request_path | video / article / micro；文章和微头条传请求 JSON 路径 |
| file、video_url | 本地视频、公网视频地址 |
| description、tags、bt2 | 描述、标签、短标题 |
| thumbnail_path、portrait_thumbnail_path、widescreen_thumbnail_path | 封面路径 |
| ai_chapters、declare_original | 智能章节、原创声明 |
| generate_image_text、system_cover_index | 头条图文开关、系统封面索引 |
| category、creative_statement | 分区、创作声明 |
| draft、sph_product_id | 草稿、视频号商品编号 |
| publication_id、client_ref | 去重标识、跟踪标识 |
| youtube_options | privacy_status、category_id、language、made_for_kids，YouTube 必填 |

## 其他 CLI

```text
media-publisher cli douyin-creator-works --phone <账号组> <接口配置JSON>
```

接口配置字段：listPath、metricsPath、listParams（含 max_cursor）、metricsFields、metricsHeaders。返回 works、metrics。

```powershell
python -m platform_api.oauth --client-secret ./client_secret.json --output ./token.json
python -m platform_api.oauth --inspect-token ./token.json
python -m platform_api.oauth --configure-env ./data/demo/.env --token-file ./token.json --account demo --channel-id <频道ID>
```

OAuth 参数：`--client-secret`、`--output`、`--inspect-token`、`--configure-env`、`--token-file`、`--account`、`--channel-id`、`--channel-title`、`--port`（默认18765）、`--callback`。

## MCP

```powershell
cd mcp
npm install
npm run build
node dist/index.js
```

| 工具 | 参数 |
| --- | --- |
| configure_accounts | groups、members |
| list_accounts | account_group、platform，可选 |
| login | platform、account_group，可选 timeoutSec、force |
| login_status | login_id |
| start_publish | 与 JSON 批次发布相同 |
| poll_task | task_path |

宿主以 stdio 启动 `node <绝对路径>/mcp/dist/index.js`，设置 MEDIA_PUBLISHER_DIR、MEDIA_PUBLISHER_PYTHON。发布后轮询返回的 task_path。

## 环境变量

| 变量 | 用途 |
| --- | --- |
| MEDIA_PUBLISHER_DIR | Publisher 根目录 |
| MEDIA_PUBLISHER_EXECUTABLE | CLI 可执行文件 |
| MEDIA_PUBLISHER_PYTHON | Python 可执行文件 |
| PUBLISHING_CREDENTIALS_FILE | 凭据文件路径 |
| PUBLISHING_CREDENTIALS_JSON | 凭据 JSON，优先于文件 |
| MEDIA_PUBLISHER_TIMEOUT_SECONDS | 执行器等待上限，默认14520秒 |
| PUPPETEER_EXECUTABLE_PATH | 无头抖音浏览器路径 |
| YOUTUBE_FALLBACK_PROXY | YouTube 超时代理，默认本机7897；空值禁用 |
| MEDIA_PUBLISHER_DISABLE_TELEMETRY | 关闭启动统计 |
| MEDIA_PUBLISHER_GIST_ID、MEDIA_PUBLISHER_GIST_TOKEN | 可选启动统计配置 |

## 许可

感谢 [MatrixMedia](https://github.com/hanliang97/MatrixMedia) 和 [social-auto-upload](https://github.com/dreammis/social-auto-upload)。许可证：[GPL-2.0-only](./LICENSE)、[小红书上游 MIT](./LICENSE.social-auto-upload)。
