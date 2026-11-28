'use strict'

import { validAccountGroup } from "../services/matrixDataPaths";

const OFFICIAL_ALIASES = {
  youtube: 'youtube',
  yt: 'youtube',
  ytb: 'youtube',
  tiktok: 'tiktok',
  tk: 'tiktok',
  instagram: 'instagram',
  ig: 'instagram',
  ins: 'instagram',
  facebook: 'facebook',
  fb: 'facebook'
}

const PLATFORM_ALIASES = {blbl: '哔哩哔哩',
bilibili: '哔哩哔哩',
哔哩哔哩: '哔哩哔哩',
dy: '抖音',
douyin: '抖音',
抖音: '抖音',
sph: '视频号',
shipin: '视频号',
shipinhao: '视频号',
视频号: '视频号',
ks: '快手',
kuaishou: '快手',
快手: '快手',
tt: '头条',
toutiao: '头条',
头条: '头条',
头条号: '头条'}

/** 当前支持抖音、视频号、快手、头条和B站扫码登录 */
const SUPPORTED_LOGIN = ['抖音', '视频号', '快手', '头条', '哔哩哔哩']

/**
 * 解析 `cli login` 后的 argv（不含子命令名 login）
 * @returns {{ ok: true, value: object } | { ok: false, error: string }}
 */
export function parseLoginArgs(subArgv) {
  const args = Array.isArray(subArgv) ? subArgv : []
  if (args.includes('--help') || args.includes('-h')) {
    return { ok: true, value: { help: true } }
  }

  const out = {
    platform: null,
    phone: null,
    partition: null,
    show: false,
    terminalQr: true,
    timeoutSec: 900,
    saveQrPng: null,
    puppeteerHeadless: false,
    force: false,
    clientSecretPath: null,
    apiKey: null,
    profile: null
  }

  for (let i = 0; i < args.length; i++) {
    const a = args[i]
    if (a === '--platform' || a === '-p') {
      out.platform = args[++i]
    } else if (a === '--phone') {
      out.phone = args[++i]
    } else if (a === '--partition') {
      out.partition = args[++i]
    } else if (a === '--hide') {
      out.show = false
    } else if (a === '--show') {
      out.show = true
    } else if (a === '--no-terminal-qr') {
      out.terminalQr = false
    } else if (a === '--timeout-sec') {
      const n = parseInt(args[++i], 10)
      if (!Number.isFinite(n) || n < 30) {
        return { ok: false, error: '--timeout-sec 需为不小于 30 的整数（秒）' }
      }
      out.timeoutSec = n
    } else if (a === '--save-qr-png') {
      out.saveQrPng = args[++i] || null
    } else if (a === '--puppeteer-headless') {
      out.puppeteerHeadless = true
    } else if (a === '--force') {
      out.force = true
    } else if (a === '--client-secret') {
      out.clientSecretPath = args[++i] || null
    } else if (a === '--api-key') {
      out.apiKey = args[++i] || null
    } else if (a === '--profile') {
      out.profile = args[++i] || null
    }
  }

  if (!out.platform) {
    return {
      ok: false,
      error: '缺少 --platform（或 -p）。扫码支持 dy / sph / ks / tt / blbl；官方登录支持 youtube / tiktok / instagram / facebook'
    }
  }
  const raw = String(out.platform).trim()
  const lower = raw.toLowerCase()
  const official = OFFICIAL_ALIASES[lower]
  if (official) {
    const group = String(out.phone || '').split('-')[0]
    if (!validAccountGroup(group)) {
      return {
        ok: false,
        error: '官方登录必须用 --phone 指定有效账号组'
      }
    }
    out.platform = official
    out.phone = group
    out.official = true
    return { ok: true, value: out }
  }
  const pt = PLATFORM_ALIASES[raw] || PLATFORM_ALIASES[lower] || raw
  if (!SUPPORTED_LOGIN.includes(pt)) {
    return {
      ok: false,
      error: `cli login 当前支持抖音、视频号、快手、头条和B站，收到: ${out.platform}。`
    }
  }
  out.platform = pt

  if (!out.partition) {
    if (!out.phone) {
      return {
        ok: false,
        error:
          '缺少 --phone 或完整 --partition（须与 publish 一致，如 persist:13800138000抖音）'
      }
    }
    const phoneSeg = String(out.phone).split('-')[0]
    out.partition = `persist:${phoneSeg}${out.platform}`
  }

  if (out.show && !['视频号', '抖音', '哔哩哔哩'].includes(out.platform)) {
    console.warn('media-publisher: CLI 模式不打开登录窗口，已忽略 --show。')
    out.show = false
  }

  if (!out.puppeteerHeadless) {
    if (!out.terminalQr) {
      return {
        ok: false,
        error:
          'CLI 模式不打开浏览器登录窗口。请保留默认终端二维码（勿加 --no-terminal-qr），或使用 --puppeteer-headless。'
      }
    }
  } else if (out.platform === '视频号') {
    return {
      ok: false,
      error:
        '视频号暂不支持 --puppeteer-headless 模式，请使用默认终端二维码方式登录。'
    }
  } else if (!out.terminalQr && !out.saveQrPng) {
    return {
      ok: false,
      error:
        '--puppeteer-headless 须保留终端二维码（默认），或配合 --no-terminal-qr 时指定 --save-qr-png 以周期性写入扫码图。'
    }
  }

  return { ok: true, value: out }
}

export function loginHelpText() {
  return `
用法: <应用> cli login [选项]

扫码登录的 Cookie 保存在 data/<账号组>。当前支持抖音、视频号、快手、头条和B站。
YouTube 走 Google 官方授权，TikTok、Instagram、Facebook 走 Zernio。凭据写入 data/<账号组>/.env。

官方登录示例:
  electron . cli login -p youtube --phone chinese
  electron . cli login -p youtube --phone chinese --client-secret client_secret.json
  electron . cli login -p tiktok --phone chinese
  electron . cli login -p instagram --phone chinese
  electron . cli login -p facebook --phone chinese --api-key <Zernio key>

终端扫码（默认）：同一 Electron 窗口 + puppeteer-in-electron 的 CDP 截图（page.screenshot），无需屏外坐标。Linux 无图形环境或 SSH 建议用 xvfb-run -a 包一层。

可选 --puppeteer-headless（仅抖音）：用系统 Chrome/Chromium 真无头 + page.screenshot，userDataDir 与 partition 一致（需 PUPPETEER_EXECUTABLE_PATH 或已安装 Chrome/Chromium）。无 TTY 时请配合 --save-qr-png。

视频号登录支持 --show 弹出登录窗口，扫码后窗口自动关闭。

选项:
  -p, --platform <id>   扫码：dy / sph / ks / tt / blbl；官方：youtube / tiktok / instagram / facebook
      --phone <id>      扫码为手机号或账号组；官方登录必须指定有效账号组
      --client-secret <文件>  YouTube 的 Google 客户端 JSON
      --api-key <key>   Zernio API key，TikTok 与 Instagram/Facebook 使用各自的 key
      --profile <id>    Zernio 有多个 profile 时指定
      --partition <p>   完整 partition，如 persist:13800138000抖音
      --show              弹出登录窗口（视频号默认支持；抖音 CLI 不支持）
      --hide              不显示窗口（默认即为隐藏）
      --no-terminal-qr    关闭终端二维码时须使用 --puppeteer-headless
      --save-qr-png <p>   每次刷新写 PNG（优先 #animate_qrcode_container 内 data: 原图）
      --puppeteer-headless  使用 Puppeteer 无头 Chromium（仅抖音，视频号不支持）
      --timeout-sec <n>   最长等待秒数，默认 900（15 分钟）
  -h, --help            显示本帮助

调试: MATRIX_CLI_QR_DEBUG=1 向 stderr 输出 [media-publisher][cli-qr] 日志（约每 6s 一次页面诊断）。
      MATRIX_CLI_QR_TERM_COLS=<24-260> 强制缩小终端二维码图（默认按图宽约每 1.85px 一列，上限终端宽）。
      MATRIX_CLI_QR_TERM_BLOCKS=full 栅格模式仅用 █（默认 ▀▄█；解码成功时优先 qrcode-terminal）。
      MATRIX_CLI_QR_NO_DECODE=1 强制栅格回退（不调 jsQR）。

退出码: 0 已登录或登录成功, 1 异常, 2 参数错误, 3 超时、用户关窗或仍未登录

示例:
  electron . cli login -p dy --phone 13800138000
  electron . cli login -p sph --phone 13800138000 --show
  electron . cli login -p sph --phone 宠物
  xvfb-run -a ./矩媒.AppImage cli login -p dy --phone 13800138000
  electron . cli login -p dy --phone 13800138000 --puppeteer-headless
  矩媒.exe cli login -p dy --phone 13800138000
  矩媒.exe cli login -p ks --phone finance --save-qr-png kuaishou-login.png
  矩媒.exe cli login -p tt --phone finance --save-qr-png toutiao-login.png
`.trim()
}
