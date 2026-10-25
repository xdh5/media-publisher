"use strict";

import path from "path";
import fs from "fs";
import { app } from "electron";
import { writeCliJson, writeCliStdout } from "./cliStdout";
import { runOfficialPython } from "../services/officialPython";
import { accountGroupFromArgv } from "../services/matrixDataPaths";
import { probeAccountSessions } from "../services/accountSessionProbe.js";

const ACCOUNT_PLATFORMS = new Set(["抖音", "百家号", "头条", "视频号", "哔哩哔哩", "快手"]);

function getAccountsDir() {
  const documents = app.getPath("documents");
  return path.join(documents, "media-publisher", "data", "account");
}

function readAccounts() {
  const dir = getAccountsDir();
  const files = fs.existsSync(dir)
    ? fs.readdirSync(dir).filter(f => f.endsWith(".json"))
    : [];
  const seen = new Map();
  for (const f of files) {
    let list;
    try {
      list = JSON.parse(fs.readFileSync(path.join(dir, f), "utf-8"));
    } catch {
      continue;
    }
    if (!Array.isArray(list)) continue;
    for (const item of list) {
      if (!item || !item.phone || !item.pt) continue;
      const key = `${item.phone}__${item.pt}`;
      const prev = seen.get(key);
      if (!prev || (item.createTime || 0) > (prev.createTime || 0)) {
        seen.set(key, item);
      }
    }
  }
  // 命令行登录只保存会话分区；直接发现当前账号组的分区，无需账号树记录。
  const group = accountGroupFromArgv();
  const partitionsDir = path.join(app.getPath("sessionData"), "Partitions");
  if (group && fs.existsSync(partitionsDir)) {
    for (const entry of fs.readdirSync(partitionsDir, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      let partitionName;
      try {
        partitionName = decodeURIComponent(entry.name);
      } catch {
        continue;
      }
      if (!partitionName.startsWith(group)) continue;
      const pt = partitionName.slice(group.length);
      if (!ACCOUNT_PLATFORMS.has(pt)) continue;
      const key = `${group}__${pt}`;
      if (!seen.has(key)) {
        seen.set(key, { phone: group, pt, partition: `persist:${partitionName}` });
      }
    }
  }
  return Array.from(seen.values()).sort((a, b) => {
    if (a.phone !== b.phone) return String(a.phone).localeCompare(String(b.phone));
    return String(a.pt).localeCompare(String(b.pt));
  });
}

export async function runAccountsCli(options) {
  if (options.official) {
    if (!options.phone) {
      console.error("官方账号查询需要 --phone 指定账号组");
      return 2;
    }
    const rows = runOfficialPython(["accounts", "--group", String(options.phone)]);
    const list = Array.isArray(rows) ? rows : [];
    const filtered = options.platform
      ? list.filter((item) => String(item.platform) === String(options.platform).toLowerCase())
      : list;
    writeCliJson(filtered);
    return 0;
  }
  const accounts = readAccounts();
  const platforms = options.platforms || (options.platform ? [options.platform] : null);
  if (options.phone && platforms) {
    for (const pt of platforms) {
      if (!accounts.some((account) => account.phone === options.phone && account.pt === pt)) {
        accounts.push({ phone: options.phone, pt, partition: `persist:${options.phone}${pt}` });
      }
    }
  }
  const filtered = accounts.filter(a => {
    if (platforms && !platforms.includes(a.pt)) return false;
    if (options.phone && String(a.phone) !== String(options.phone)) return false;
    return true;
  });

  const rows = [];
  const probes = await probeAccountSessions(filtered);
  for (let index = 0; index < filtered.length; index += 1) {
    const a = filtered[index];
    const probe = probes[index];
    if (options.onlyLoggedIn && !probe.loggedIn) continue;
    if (options.onlyLoggedOut && probe.loggedIn !== false) continue;
    rows.push({
      phone: a.phone,
      pt: a.pt,
      partition: a.partition || `persist:${a.phone}${a.pt}`,
      ...probe,
      createdAt: a.createTime || null,
    });
  }

  if (options.json) {
    writeCliJson(rows);
    return 0;
  }

  if (rows.length === 0) {
    writeCliStdout("（无匹配账号）数据目录：" + getAccountsDir());
    return 0;
  }

  const header = ["账号", "平台", "登录态", "检查时间", "说明"];
  const lines = rows.map(r => [
    String(r.phone),
    r.pt,
    r.loggedIn === true ? "已验证" : r.loginRequired ? "需要登录" : "检测失败",
    r.checkedAt || "-",
    r.reason || "-",
  ]);
  const widths = header.map((h, i) =>
    Math.max(displayWidth(h), ...lines.map(row => displayWidth(row[i])))
  );
  const pad = (s, w) => s + " ".repeat(Math.max(0, w - displayWidth(s)));
  const render = row => row.map((c, i) => pad(c, widths[i])).join("  ");
  writeCliStdout(render(header));
  writeCliStdout(widths.map(w => "-".repeat(w)).join("  "));
  lines.forEach(r => writeCliStdout(render(r)));
  const ok = rows.filter(r => r.loggedIn === true).length;
  writeCliStdout(`\n共 ${rows.length} 个账号，已验证 ${ok}，其余 ${rows.length - ok}`);
  return 0;
}

function displayWidth(s) {
  let w = 0;
  for (const ch of String(s)) {
    w += /[\u4e00-\u9fff\u3000-\u303f\uff00-\uffef]/.test(ch) ? 2 : 1;
  }
  return w;
}
