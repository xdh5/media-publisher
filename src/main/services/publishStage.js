"use strict";

const progressKey = Symbol("发布阶段");

export function initializePublishProgress(page, context) {
  page[progressKey] = { ...context, stage: "初始化发布页面", stageStartedAt: Date.now() };
  console.log("[发布阶段开始]", JSON.stringify(page[progressKey]));
}

export function setPublishStage(page, stage) {
  const progress = page[progressKey];
  if (progress.stage === stage) return;
  console.log("[发布阶段结束]", JSON.stringify({ ...progress,
    elapsedSeconds: Math.round((Date.now() - progress.stageStartedAt) / 1000) }));
  progress.stage = stage;
  progress.stageStartedAt = Date.now();
  console.log("[发布阶段开始]", JSON.stringify(progress));
}

export function getPublishProgress(page) {
  return page[progressKey];
}
