## 命令行（CLI）说明

命令行是唯一入口。参数中出现 `cli` 即进入命令行模式。

> 返回 [README](../README.md) · 相关：[MCP](./mcp.md)

## 故障排除

若启动时报 `require('electron') 异常` 且类型为 `string`，多半是环境变量 **`ELECTRON_RUN_AS_NODE`** 被设为 `1`。在该模式下 Electron 以纯 Node 运行，`require('electron')` 只会得到可执行文件路径。请在本终端执行 `unset ELECTRON_RUN_AS_NODE`，或在命令前显式清空后再启动，例如：

```bash
ELECTRON_RUN_AS_NODE= electron . cli publish --help
```

`yarn dev` 已尝试在子进程中清除该变量；若仍异常，请检查 shell 配置（如 `.zshrc`）是否全局导出了 `ELECTRON_RUN_AS_NODE`。

## CLI 登录

当前支持**抖音**和**视频号**两个平台。

### 通用机制

1. **会话**：`partition` 形如 `persist:<手机号段><平台名>`，与账号树、webview 一致。
2. **Cookie 持久化**：登录成功后自动 `cookies.flushStore()` + `flushStorageData()`，Cookie 写在 media-publisher 目录的 `data` 下。
3. **终端扫码**：CLI 自动捕获二维码并在终端展示，用户扫码后继续轮询登录 Cookie。
4. **退出**：检测到 Cookie 后关窗；超时 / 用户关窗返回码 3。

### 抖音 CLI 登录

- **登录判定**：轮询 `https://creator.douyin.com` 下 Cookie `passport_assist_user`。
- **窗口模式**：默认屏外隐藏窗口 + 终端二维码；支持 `--puppeteer-headless` 无头模式。
- `--show` 会被忽略（不弹窗）。

```bash
electron . cli login -p dy --phone 13800138000
```

### 视频号 CLI 登录

- **登录判定**：轮询 `https://channels.weixin.qq.com` 下 Cookie `sessionid`，检测与旧值不同的新 sessionid 即为登录成功（支持重复登录）。
- **窗口模式**：默认透明窗口（`opacity: 0`）+ 终端二维码；支持 `--show` 弹出可见登录窗口。
- **UA 注入**：通过 puppeteer CDP `page.setUserAgent()` 在导航前设置微信 UA，覆盖主 frame + iframe 所有请求。
- **QR 提取**：遍历所有 frame（含 wujie micro-frontend 的 `login-for-iframe`），从 `img.qrcode` 的 `data:` URL 直接解码。
- 不支持 `--puppeteer-headless`。

```bash
# 终端二维码（默认，无弹窗）
electron . cli login -p sph --phone 13800138000

# 弹出登录窗口
electron . cli login -p sph --phone 宠物 --show
```

### Linux / SSH 环境

无显示器或 SSH 环境下请用 `xvfb-run -a` 提供虚拟显示：

```bash
xvfb-run -a ./矩媒.AppImage cli login -p dy --phone 13800138000
```

若 stdout 不是 TTY（如管道重定向），终端截图可能无法正常展示，请在可交互终端中执行。参数见 `cli login --help`。成功后再执行 `cli publish`。

## 发布视频

```bash
# 开发（项目根目录，需已执行 yarn build:dir）
electron . cli publish -p dy --phone 13800138000 -f /path/to/video.mp4 -t "标题"
```

### 参数摘要

与发布载荷同一套字段：

| 参数                      | 载荷字段                                                                   |
| ------------------------- | -------------------------------------------------------------------------- |
| `-p` / `--platform`       | 发布平台                                                                   |
| `-f` / `--file`           | 本地视频路径 → `filePath`、`data.textOtherName`（文件名无扩展名）          |
| `--phone` / `--partition` | 会话分区，与账号树一致                                                     |
| `-t` / `--title`          | **视频标题**（必填）→ `data.bt1`                                           |
| `--name` / `--book-name`  | **名称**（任务记录名）→ `bookName`；省略时默认与视频文件名（无扩展名）一致 |
| `--bt2`                   | **概括短标题** → `data.bt2`；省略时默认与视频标题一致（视频号等场景）      |
| `--tags` / `--bq`         | **视频标签** → `data.bq`                                                   |
| `--address`               | **地址** → `data.address`（仅百家号）                                      |
| `--publish-at`            | 一次性定时发布，格式 `YYYY-MM-DD HH:mm:ss`；抖音、快手、视频号、百家号、头条和小红书使用平台官方定时 |
| `--show`                  | 当前 CLI 会忽略，仍后台运行                                                |
| `--no-close-window`       | 发布后不自动关窗                                                           |
| `--draft`                 | 保存到平台草稿箱，不直接发布                                               |
| `--sph-product-id`        | 视频号商品上架快捷参数（商品编号）；其他平台忽略                           |
| `--sph-link-type`         | 视频号链接类型，当前支持 `none` / `product`；其他平台忽略                  |
| `--sph-link-value`        | 视频号商品编号；可单独传（默认按商品上架）                                 |

完整说明请执行：

```bash
<应用> cli publish --help
```

### 退出码

| 码  | 含义                                           |
| --- | ---------------------------------------------- |
| 0   | 成功                                           |
| 1   | 未捕获异常                                     |
| 2   | 参数错误                                       |
| 3   | 任务失败（如未登录、上传失败）                 |
| 4   | 视频号链接添加失败，视频已转存草稿，需人工检查 |

视频号商品上架并保存草稿：

```bash
electron . cli publish -p sph --phone 13800138000 -f /path/to/video.mp4 \
  -t "视频标题" --bt2 "视频号短标题" --draft \
  --sph-product-id 10000591263144
```

视频号链接参数属于视频号专属能力。即使误传给抖音、B 站等其他平台，也会被忽略，不会阻断任务。

### 注意事项

登录与发布使用同一账号组下的持久化分区，浏览器运行目录位于 `data/<账号组>/runtime`。同账号组的命令独占配置目录，等待超过一分钟会返回占用原因。MCP 退出后，其启动的浏览器会自动退出；发布外层超时会清理本次进程树。

抖音、快手扫码后必须通过真实发布页验证并保存会话才返回成功。账号列表中的 Cookie 检查仅为本地预检；只有明确跳转登录地址或出现可见登录界面才要求重新扫码，未出现上传控件属于页面异常。

发布页面每五秒采集页面状态与上传进度，连续五分钟无变化会终止本次任务并释放浏览器。上传进度变化时继续等待；超时结果需要先在平台作品管理核对，不能直接认定未发布或自动重发。

1. **登录态**：Cookie 保存在 media-publisher 目录的 `data` 中。抖音、快手、头条和视频号使用 `cli login` 扫码登录。
2. **进程生命周期**：命令会启动 Electron 主进程，不打开图形界面。命令完成、参数失败或业务失败后会主动退出；执行发布期间进程存在属于正常现象。
3. **启动诊断**：终端会依次输出 Puppeteer 初始化、Electron ready、CLI 参数识别和最终退出码。初始化超过 15 秒会以退出码 `1` 结束并打印明确错误，不会无限静默等待。
4. **登录失效**：视频号发布页若跳转到 `channels.weixin.qq.com/login.html`，CLI 会立即提示重新登录并以退出码 `3` 结束，不再按普通 URL 不匹配重复重试。
5. **官方预约发布**：`--publish-at "YYYY-MM-DD HH:mm:ss"` 只支持抖音、快手、视频号、百家号、头条和小红书。矩媒会立即上传，并在平台后台确认官方预约成功后返回；其他平台直接报错，不再创建应用内定时任务。
6. **编译**：在项目根目录执行 `yarn build:dir` 编译命令行主进程。

## 编译

- `yarn build:dir`：编译命令行主进程到 `dist/electron/main.js`


## 抖音智能章节和自定义封面

单文件发布支持 `--ai-chapters`、`--cover <横封面路径>`、`--portrait-cover <竖封面路径>`。智能章节等待平台 `/aweme/v1/chapter/recommend/get` 返回非空章节后点击保存；自定义封面按 4:3 和 3:4 完整适配后上传并保存。

财经账号 `finance` 默认生成智能章节，并要求提供横竖封面。财经发布工作流自动传入本期 `cover.png` 与 `cover-portrait.png`，本地缺失时从 R2 恢复。


## 快手自定义封面

快手发布使用 `--cover <3:4封面路径>`。视频上传完成后，发布器进入封面设置的上传封面页，上传图片，选择3:4并确认。财经账号必须提供封面；财经工作流自动使用本期 `cover-portrait.png`。


## 视频号双封面

视频号通过 `--portrait-cover` 上传3:4个人主页卡片，通过 `--cover` 上传4:3分享卡片。发布器分别打开对应编辑入口；出现素材推荐提示时选择直接编辑。每张图片校验上传内容及保存后的封面比例，两张均成功后才允许发表。财经发布默认提供本期两张封面。

视频号登录二维码通过登录 iframe 中的确切 XPath 定位 `img.qrcode`，直接保存图片原始数据，不遍历猜测，不截取或重绘。
