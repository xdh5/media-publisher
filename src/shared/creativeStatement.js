"use strict";

/** 创作声明统一 value（发布表单、历史记录、各平台上传脚本共用） */
export const CREATIVE_STATEMENT_VALUES = {
  NONE: "none",
  AI_GENERATED: "ai_generated",
  FICTION: "fiction",
  MARKETING: "marketing",
  PERSONAL_OPINION: "personal_opinion",
  REPOST: "repost",
  SELF_SHOT: "self_shot",
  SELF_MADE_NO_REPOST: "self_made_no_repost",
};

export const CREATIVE_STATEMENT_DEFAULT = CREATIVE_STATEMENT_VALUES.NONE;

/** 无标注在表单与历史记录中的展示文案 */
export const CREATIVE_STATEMENT_NONE_LABEL = "无标注";

/**
 * 创作声明选项（label 为统一短文案；platformLabels 为各平台页面原文案）
 * onlyPlatforms：仅在这些平台 key 的账号下展示（缺省表示已支持声明的平台均展示）
 * optionalAuth：哔哩哔哩「内容授权声明」分区
 */
export const CREATIVE_STATEMENT_OPTIONS = [
  {
    value: CREATIVE_STATEMENT_VALUES.NONE,
    label: CREATIVE_STATEMENT_NONE_LABEL,
    platformLabels: {blbl: "内容无需标注",
dy: "无需添加自主声明",
sph: "无需标注"},
  },
  {
    value: CREATIVE_STATEMENT_VALUES.AI_GENERATED,
    label: "AI生成",
    platformLabels: {blbl: "含AI生成内容",
dy: "内容由AI生成",
ks: "内容为AI生成",
tt: "AI生成",
sph: "含AI生成内容"},
  },
  {
    value: CREATIVE_STATEMENT_VALUES.FICTION,
    label: "虚构演绎",
    platformLabels: {blbl: "含虚构演绎内容",
dy: "虚构演绎，仅供娱乐",
ks: "演绎情节，仅供娱乐",
tt: "虚构演绎，故事经历",
sph: "内容为虚构剧情，仅供娱乐"},
  },
  {
    value: CREATIVE_STATEMENT_VALUES.MARKETING,
    label: "营销推广",
    platformLabels: {blbl: "内容含营销信息",
dy: "内容含营销推广信息",
sph: "内容包含营销广告"},
  },
  {
    value: CREATIVE_STATEMENT_VALUES.PERSONAL_OPINION,
    label: "个人观点",
    platformLabels: {blbl: "个人观点，仅供参考",
dy: "内容为个人观点或见解",
ks: "个人观点，仅供参考",
sph: "个人观点，仅供参考"},
  },
  {
    value: CREATIVE_STATEMENT_VALUES.REPOST,
    label: "转载",
    platformLabels: {blbl: "内容为转载",
dy: "内容为转载信息",
tt: "取自站外",
ks: "素材来源于网络",
sph: "内容为转载"},
  },
  {
    value: CREATIVE_STATEMENT_VALUES.SELF_SHOT,
    label: "自行拍摄",
    onlyPlatforms: ["sph"],
    platformLabels: {
      sph: "内容为自行拍摄",
    },
  },
  {
    value: CREATIVE_STATEMENT_VALUES.SELF_MADE_NO_REPOST,
    label: "自制禁转载",
    onlyPlatforms: ["blbl"],
    optionalAuth: true,
    platformLabels: {
      blbl: "内容为自制：未经作者允许，禁止转载",
    },
  },
];

const VALUE_TO_OPTION = new Map(
  CREATIVE_STATEMENT_OPTIONS.map((o) => [o.value, o])
);

const NONE_LABEL_ALIASES = new Set([
  CREATIVE_STATEMENT_NONE_LABEL,
  "内容无需标注",
  "无需添加自主声明",
  "无需标注",
]);

const LABEL_TO_VALUE = (() => {
  const map = new Map();
  for (const opt of CREATIVE_STATEMENT_OPTIONS) {
    map.set(opt.label, opt.value);
    if (opt.platformLabels) {
      for (const label of Object.values(opt.platformLabels)) {
        map.set(label, opt.value);
      }
    }
  }
  return map;
})();

export function isCreativeStatementNone(value) {
  return normalizeCreativeStatement(value) === CREATIVE_STATEMENT_VALUES.NONE;
}

export function normalizeCreativeStatement(value) {
  const v = String(value || "").trim();
  if (!v) return CREATIVE_STATEMENT_DEFAULT;
  if (VALUE_TO_OPTION.has(v)) return v;
  if (NONE_LABEL_ALIASES.has(v)) return CREATIVE_STATEMENT_VALUES.NONE;
  if (LABEL_TO_VALUE.has(v)) return LABEL_TO_VALUE.get(v);
  return CREATIVE_STATEMENT_DEFAULT;
}

export function getCreativeStatementOption(value) {
  return (
    VALUE_TO_OPTION.get(normalizeCreativeStatement(value)) ||
    CREATIVE_STATEMENT_OPTIONS[0]
  );
}

export function getCreativeStatementLabel(value, platform) {
  const opt = getCreativeStatementOption(value);
  if (platform && opt.platformLabels && opt.platformLabels[platform]) {
    return opt.platformLabels[platform];
  }
  return opt.label;
}

export function resolveBlblCreativeStatementLabel(value) {
  return getCreativeStatementLabel(value, "blbl");
}

export function resolveDyCreativeStatementLabel(value) {
  return getCreativeStatementLabel(value, "dy");
}

export function resolveKsCreativeStatementLabel(value) {
  return getCreativeStatementLabel(value, "ks");
}

export function resolveTtCreativeStatementLabel(value) {
  return getCreativeStatementLabel(value, "tt");
}

export function resolveSphCreativeStatementLabel(value) {
  return getCreativeStatementLabel(value, "sph");
}
