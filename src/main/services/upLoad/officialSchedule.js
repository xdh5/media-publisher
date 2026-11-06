import { setDouyinSchedule } from "./officialSchedule/douyin.js";
import { setKuaishouSchedule } from "./officialSchedule/kuaishou.js";
import { setShipinhaoSchedule } from "./officialSchedule/shipinhao.js";
import { setDialogSchedule } from "./officialSchedule/dialog.js";

export { waitForOfficialScheduleAccepted } from "./officialSchedule/acceptance.js";
export { clickKuaishouScheduleConfirmation } from "./officialSchedule/kuaishou.js";

const OFFICIAL_SCHEDULE_PLATFORMS = new Set([
  "抖音",
  "快手",
  "视频号",
  "百家号",
  "头条",
]);

export function supportsOfficialSchedule(platform) {
  return OFFICIAL_SCHEDULE_PLATFORMS.has(String(platform || "").trim());
}

export function parseOfficialPublishAt(value, nowMs = Date.now()) {
  const text = String(value || "").trim();
  const matched = text.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (!matched) {
    return { ok: false, error: "官方定时发布时间格式应为 YYYY-MM-DD HH:mm:ss" };
  }
  const [year, month, day, hour, minute, second] = matched
    .slice(1)
    .map((item) => Number(item));
  const scheduled = new Date(year, month - 1, day, hour, minute, second, 0);
  const valid =
    scheduled.getFullYear() === year &&
    scheduled.getMonth() === month - 1 &&
    scheduled.getDate() === day &&
    scheduled.getHours() === hour &&
    scheduled.getMinutes() === minute &&
    scheduled.getSeconds() === second;
  if (!valid) {
    return { ok: false, error: "官方定时发布时间不是有效日期" };
  }
  if (scheduled.getTime() <= nowMs) {
    return { ok: false, error: "官方定时发布时间必须是未来时间" };
  }
  return { ok: true, value: scheduled.getTime(), text };
}

function normalizePublishAt(value) {
  const text = String(value || "").trim();
  const matched = text.match(
    /^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2}):(\d{2})$/
  );
  if (!matched) {
    throw new Error("官方定时发布时间格式应为 YYYY-MM-DD HH:mm:ss");
  }
  return {
    full: text,
    minute: `${matched[1]}-${matched[2]}-${matched[3]} ${matched[4]}:${matched[5]}`,
    year: matched[1],
    month: String(Number(matched[2])),
    day: String(Number(matched[3])),
    time: `${matched[4]}:${matched[5]}`,
    monthDay: `${matched[2]}月${matched[3]}日`,
    hour: String(Number(matched[4])),
    minuteValue: String(Number(matched[5])),
  };
}

export async function setOfficialSchedule(page, platform, publishAtText) {
  if (!supportsOfficialSchedule(platform)) {
    throw new Error(`${platform}不支持矩媒官方定时发布自动化`);
  }
  const publishAt = normalizePublishAt(publishAtText);
  if (platform === "抖音") {
    await setDouyinSchedule(page, publishAt);
    return;
  }
  if (platform === "快手") {
    await setKuaishouSchedule(page, publishAt);
    return;
  }
  if (platform === "视频号") {
    await setShipinhaoSchedule(page, publishAt);
    return;
  }
  await setDialogSchedule(page, platform, publishAt);
}
