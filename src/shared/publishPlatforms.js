"use strict";

/** 平台别名 → 中文 canonical 名（与登录分区一致） */
export const PLATFORM_ALIASES = {dy: "抖音",
douyin: "抖音",
抖音: "抖音",
sph: "视频号",
视频号: "视频号",
blbl: "哔哩哔哩",
bilibili: "哔哩哔哩",
哔哩哔哩: "哔哩哔哩",
tt: "头条",
toutiao: "头条",
头条: "头条",
ks: "快手",
kuaishou: "快手",
快手: "快手"};

/** CLI 视频发布支持的全部平台（canonical 中文名） */
export const VIDEO_PUBLISH_CANONICAL = ["抖音", "视频号", "哔哩哔哩", "头条", "快手"];

/**
 * @param {string} raw platform 字段原始值
 * @returns {string} canonical 中文平台名
 */
export function resolvePublishPlatform(raw) {
  const trimmed = String(raw || "").trim();
  if (!trimmed) return "";
  const lower = trimmed.toLowerCase();
  return PLATFORM_ALIASES[trimmed] || PLATFORM_ALIASES[lower] || trimmed;
}
