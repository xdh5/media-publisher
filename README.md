# media-publisher

多平台视频发布工具。国内平台用本机浏览器登录态发布，YouTube、TikTok、Instagram、Facebook 走官方接口。没有图形界面，入口是命令行和 MCP。

## 致谢

感谢原作者 [@hanliang97](https://github.com/hanliang97)。本仓库参考了 [MatrixMedia](https://github.com/hanliang97/MatrixMedia)。

小红书视频发布流程移植自 [social-auto-upload v1.0.0-skills.2](https://github.com/dreammis/social-auto-upload/tree/7023053ec4c21bc85901cb5a66302f889ddc7fa9)，使用本工具的账号会话。上游许可证见 [MIT 许可证](./LICENSE.social-auto-upload)。

## 平台

| 平台 | 发布方式 | 登录 | 预约 |
| --- | --- | --- | --- |
| 抖音、快手、头条、视频号、百家号 | 浏览器 | 抖音、快手、头条、视频号可扫码 | 转为北京时间，由平台官方确认 |
| 哔哩哔哩 | 浏览器 | 使用已有登录态 | 只能立即发布 |
| 小红书 | 浏览器 | 创作者中心扫码，支持真实发布页预检 | 立即发布、保存草稿或平台预约发布 |
| YouTube、TikTok、Instagram、Facebook | 官方接口 | 系统浏览器授权 | 把带时区的时间交给官方接口 |

账号放在 `data/finance`、`data/korean`、`data/chinese`。浏览器 Cookie 在对应账号组的 `Partitions` 里，海外平台凭据在该账号组的环境变量里。

统一发布在 `python/publishing`，官方接口在 `python/platform_api`。

## 命令行

参数里带 `cli` 即进入命令行。说明见 [docs/cli.md](./docs/cli.md)。

| 子命令 | 作用 |
| --- | --- |
| `cli login` | 扫码，或打开系统浏览器完成海外平台授权 |
| `cli publish` | 发布一条视频 |
| `cli accounts` | 查看账号和登录态 |

```bash
media-publisher cli login -p dy --phone 13800138000
media-publisher cli publish -p dy --phone 13800138000 -f ./video.mp4 -t "标题"
media-publisher cli login -p xhs --phone korean
media-publisher cli accounts -p xhs --phone korean --json
```

开发时在项目根目录执行：

```bash
electron . cli accounts --help
```

退出码：`0` 成功，`1` 异常，`2` 参数错误，`3` 登录或上传失败。

## MCP

`mcp/` 把登录和发布暴露给支持 MCP 的工具。发布可以一次提交多条视频、多个平台，再用任务轮询取结果。说明见 [docs/mcp.md](./docs/mcp.md)。

```bash
cd mcp && npm install && npm run build
```

## 小红书账号与内容核对

发布前使用 `cli accounts -p xhs --phone <账号组>` 检查真实视频发布页。先核对素材和创作声明，含 AI 合成内容时如实标注。需要人工审核可保存草稿，由账号所有者在创作者中心检查后提交。

发布窗口保持可见。出现安全验证、频率限制或疑似自动化提示时暂停，批量任务遇到小红书失败后停止提交后续小红书作品。提交结果不明时先查作品管理。发布页验证仅确认当前会话可打开上传表单，平台审核与账号处置以创作者中心为准。参见 [上游小红书说明](https://github.com/dreammis/social-auto-upload/blob/7023053ec4c21bc85901cb5a66302f889ddc7fa9/skills/xiaohongshu-upload/SKILL.md) 和 [上游风控反馈](https://github.com/dreammis/social-auto-upload/issues/289)。

## 开发

需要 Node.js 20。

```bash
yarn
yarn build:dir
```

若启动时报 `require('electron')` 得到字符串，先关掉环境变量 `ELECTRON_RUN_AS_NODE`。

## 使用声明

本项目只用于合法合规的发布。请遵守各平台协议和当地法律，不要用于作弊、侵权或刷量。账号、Cookie 和素材由使用者自行保管。

## 许可

[GPL-2.0-only](./LICENSE)

## 头条三种独立发布

财经生产清单包含完整正文、约150字的 `micro_summary`、三张插图计划和封面路径。三个命令互不触发，可分别运行：

```bash
electron . cli publish-toutiao-video --phone finance --file manifest.json
electron . cli publish-toutiao-article --phone finance --file manifest.json
electron . cli publish-toutiao-micro --phone finance --file manifest.json
```

视频使用16:9封面并关闭生成图文；文章使用完整正文及三张插图、4:3封面，开启头条首发并关闭同时发布微头条；微头条使用定稿摘要和一张4:3封面。正文、图片与摘要均从清单读取，不在发布时生成内容。每个命令等待平台提交成功后保存独立回执；`--help` 查看参数。当前三条专用命令立即发布，预约视频使用原有 `cli publish`。
