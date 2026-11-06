import path from "path";
import fs from "fs";
import xlsx from "xlsx";

export function parseXlsxRows(xlsxPath) {
  const workbook = xlsx.readFile(xlsxPath);
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  const rows = xlsx.utils.sheet_to_json(sheet, { defval: "" });
  const cleanCell = (val) =>
    String(val || "")
      .replace(/[﻿​‌‍ ]/g, "")
      .replace(/[\n\t]/g, "")
      .trim();
  return rows
    .map((row) => {
      const map = {};
      Object.keys(row).forEach((k) => {
        map[cleanCell(k).toLowerCase()] = row[k];
      });
      return {
        fileName: cleanCell(
          map["文件名"] != null
            ? map["文件名"]
            : map["filename"] != null
            ? map["filename"]
            : map["file"] || ""
        ),
        title: cleanCell(
          map["标题"] != null ? map["标题"] : map["title"] || ""
        ),
        tags: cleanCell(map["标签"] != null ? map["标签"] : map["tags"] || ""),
        creativeStatement: cleanCell(
          map["创作声明"] != null
            ? map["创作声明"]
            : map["creativestatement"] != null
            ? map["creativestatement"]
            : map["cs"] || ""
        ),
      };
    })
    .filter((r) => r.fileName);
}

/**
 * 忽略大小写，先按完整文件名匹配，再按不带扩展名的文件名匹配。
 */
export function resolveFileInDir(dirPath, fileName) {
  const norm = (s) =>
    String(s || "")
      .replace(/[﻿​‌‍ ]/g, "")
      .replace(/[\n\t]/g, "")
      .trim()
      .toLowerCase();
  let entries;
  try {
    entries = fs.readdirSync(dirPath);
  } catch {
    return null;
  }
  const indexByName = new Map();
  const indexByStem = new Map();
  entries.forEach((entry) => {
    indexByName.set(norm(entry), entry);
    const stem = entry.replace(/\.[^/.]+$/, "");
    if (!indexByStem.has(norm(stem))) indexByStem.set(norm(stem), entry);
  });
  const normName = norm(fileName);
  if (indexByName.has(normName))
    return path.join(dirPath, indexByName.get(normName));
  if (indexByStem.has(normName))
    return path.join(dirPath, indexByStem.get(normName));
  const stem = norm(String(fileName).replace(/\.[^/.]+$/, ""));
  if (indexByStem.has(stem)) return path.join(dirPath, indexByStem.get(stem));
  return null;
}
