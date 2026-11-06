"use strict";

import { getCliSubArgv, isCliMode } from "./detectArgv";
import { parsePublishArgs, publishHelpText } from "./parsePublishArgs";
import { parseLoginArgs, loginHelpText } from "./parseLoginArgs";
import { parseAccountsArgs, accountsHelpText } from "./parseAccountsArgs";
import { runBatchDirPublish } from "./runBatchDirPublish.js";
import { runAccountsCli } from "./runAccountsCli";
import ptConfig from "../config/ptConfig";
import { runDouyinCliLogin } from "../services/cliLogin/douyinCliLogin";
import { runOfficialLogin } from "../services/officialLogin";
import { runSphCliLogin } from "../services/cliLogin/sphCliLogin";
import { runSingleFilePublish } from "../services/publishVideo";
import { isOfficialPlatform, officialPlatformFromArgv, runOfficialPython } from "../services/officialPython";
import { writeCliJson } from "./cliStdout";

export { isCliMode };

/**
 * @returns {Promise<number>} 进程退出码
 */
export async function runCliMain(argv = process.argv) {
  const sub = getCliSubArgv(argv);
  if (!sub || sub.length === 0) {
    console.error(
      "用法: <应用> cli <publish|login|accounts> ..."
    );
    console.error("  cli publish --help");
    console.error("  cli login --help");
    console.error("  cli accounts --help");
    return 2;
  }

  const cmd = sub[0];
  if (cmd === "login") {
    const parsed = parseLoginArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(loginHelpText());
      return 0;
    }
    const v = parsed.value;
    try {
      if (v.official) {
        return await runOfficialLogin({
          ...v,
          timeoutMs: v.timeoutSec * 1000,
        });
      }
      const loginOpts = {
        partition: v.partition,
        show: v.show,
        terminalQr: v.terminalQr,
        timeoutMs: v.timeoutSec * 1000,
        saveQrPngPath: v.saveQrPng || null,
        puppeteerHeadless: v.puppeteerHeadless,
        phone: v.phone || null,
        force: v.force || false,
      };
      if (v.platform === "视频号") {
        return await runSphCliLogin(loginOpts);
      }
      if (v.platform === "快手") {
        const { runKsCliLogin } = await import("../services/cliLogin/ksCliLogin.js");
        return await runKsCliLogin(loginOpts);
      }
      if (v.platform === "头条") {
        const { runTtCliLogin } = await import("../services/cliLogin/ttCliLogin.js");
        return await runTtCliLogin(loginOpts);
      }
      return await runDouyinCliLogin(loginOpts);
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "publish") {
    if (isOfficialPlatform(officialPlatformFromArgv(sub.slice(1)))) {
      try {
        writeCliJson(runOfficialPython(sub.slice(1)));
        return 0;
      } catch (error) {
        console.error(error && error.message ? error.message : error);
        return 1;
      }
    }
    const parsed = parsePublishArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(publishHelpText());
      return 0;
    }

    const v = parsed.value;
    const cfg = ptConfig[v.platform];
    if (!cfg) {
      console.error("内部错误: 未找到平台配置", v.platform);
      return 2;
    }

    // Batch directory publish mode
    if (v.dir) {
      return await runBatchDirPublish(v, cfg);
    }

    const result = await runSingleFilePublish(v);
    if (result.scheduled) {
      console.log(
        JSON.stringify({
          status: true,
          scheduled: true,
          officialScheduled: result.officialScheduled === true,
          id: result.id,
          publishAt: result.publishAt,
          message: result.message,
        })
      );
    } else if (result.exitCode === 0) {
      console.log(
        JSON.stringify({
          channel: "puppeteerFile-done",
          status: true,
          resultStatus: result.status,
          publishMode: result.publishMode,
          message: result.message,
        })
      );
    } else if (result.exitCode === 4) {
      console.log(
        JSON.stringify({
          channel: "puppeteerFile-done",
          status: false,
          resultStatus: result.status,
          publishMode: result.publishMode,
          outcome: result.outcome,
          needsAttention: true,
          message: result.message,
        })
      );
    } else if (result.exitCode === 3) {
      console.log(
        JSON.stringify({
          channel: "puppeteerFile-done",
          status: false,
          resultStatus: "failed",
          loginRequired: result.loginRequired === true,
          realSessionProbe: result.realSessionProbe === true,
          supportsQrLogin: result.supportsQrLogin === true,
          message: result.message || "登录态异常或未登录",
        })
      );
      console.error(result.message || "登录态异常或未登录");
      if (v.platform === "抖音" || v.platform === "快手" || v.platform === "视频号" || v.platform === "头条") {
        const loginPlatform = { 抖音: "dy", 快手: "ks", 视频号: "sph", 头条: "tt" }[v.platform];
        console.error(
          `提示: 可先执行 cli login -p ${loginPlatform} --phone <账号> 在本机完成扫码登录。`
        );
      }
    } else if (result.message) {
      console.error(result.message);
    }
    return result.exitCode;
  }

  if (cmd === "accounts") {
    const parsed = parseAccountsArgs(sub.slice(1));
    if (!parsed.ok) {
      console.error(parsed.error);
      return 2;
    }
    if (parsed.value.help) {
      console.log(accountsHelpText());
      return 0;
    }
    try {
      return await runAccountsCli(parsed.value);
    } catch (e) {
      console.error(e);
      return 1;
    }
  }

  if (cmd === "--help" || cmd === "-h") {
    console.log(
      "可用子命令: publish | login | accounts"
    );
    console.log("各自 --help 查看详细参数。");
    return 0;
  }

  console.error("未知子命令:", cmd);
  console.error("支持: publish | login | accounts");
  return 2;
}
