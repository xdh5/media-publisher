"use strict";

import fs from "fs";

function isBrokenPipe(err) {
  return Boolean(
    err &&
      (err.code === "EPIPE" ||
        err.code === "ERR_STREAM_DESTROYED" ||
        /write EPIPE/.test(String(err.message || err)))
  );
}

/**
 * CLI 机器可读输出必须走 fd 1。Electron 主进程的 console.log 会被重定向到日志文件，
 * MCP 只读子进程 stdout，所以账号 JSON 一直解析成空数组。
 */
export function writeCliStdout(text) {
  const chunk = String(text).endsWith("\n") ? String(text) : `${text}\n`;
  try {
    fs.writeSync(1, chunk);
  } catch (err) {
    if (isBrokenPipe(err)) return;
    try {
      process.stdout.write(chunk);
    } catch (nested) {
      if (isBrokenPipe(nested)) return;
      throw err;
    }
  }
}

export function writeCliJson(value) {
  if (process.env.MEDIA_PUBLISHER_RESULT_PATH) {
    fs.writeFileSync(process.env.MEDIA_PUBLISHER_RESULT_PATH, JSON.stringify(value), "utf8");
  }
  writeCliStdout(JSON.stringify(value));
}
