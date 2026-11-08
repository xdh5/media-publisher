"use strict";

export const XHS_PLATFORM_STAGGER_MIN_MS = 15000;
export const XHS_PLATFORM_STAGGER_MAX_MS = 30000;

export function isXhsPlatform(pt) {
  return String(pt || "").includes("小红书");
}

export function applyXhsConservativePublishOptions(payload) {
  if (!isXhsPlatform(payload && payload.pt)) return payload;
  return {
    ...payload,
    show: true,
    closeWindowAfterPublish: false,
  };
}

export function getPublishAttemptLimit(data, defaultLimit = 5) {
  return isXhsPlatform(data && data.pt) ? 1 : defaultLimit;
}

export function getRandomDelayMs(min, max, random = Math.random) {
  const safeMin = Number(min) || 0;
  const safeMax = Math.max(safeMin, Number(max) || safeMin);
  return Math.round(safeMin + (safeMax - safeMin) * random());
}

export function getXhsPlatformStaggerDelayMs(random = Math.random) {
  return getRandomDelayMs(
    XHS_PLATFORM_STAGGER_MIN_MS,
    XHS_PLATFORM_STAGGER_MAX_MS,
    random
  );
}
