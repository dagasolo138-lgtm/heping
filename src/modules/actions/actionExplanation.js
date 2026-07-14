import { ACTION_TYPES } from './actionTypes.js';

const PLANNER_LABELS = Object.freeze({
  utility: '综合效用',
  'tool-maintenance': '工具维护',
  'construction-planner': '聚落建设',
  'farm-planner': '农业调度',
  'fire-safety': '篝火安全',
  'weather-recovery': '环境恢复',
  'night-sleep': '夜间作息',
  'cargo-priority': '物资回运',
  'survival-priority': '生存优先',
  fallback: '规则调度',
});

const ACTION_SUMMARIES = Object.freeze({
  [ACTION_TYPES.FETCH_WATER]: '营地或本人存在饮水需求，前往最近的合法取水点。',
  [ACTION_TYPES.GATHER_BERRIES]: '营地或本人存在食物需求，前往最近的可采集浆果丛。',
  [ACTION_TYPES.CHOP_TREE]: '营地木材存在缺口，前往最近的可用树木。',
  [ACTION_TYPES.HAUL_TO_CAMP]: '人物正在携带物资，优先将物资送回营地。',
  [ACTION_TYPES.DELIVER_MATERIALS]: '现有工地仍缺材料，先完成已经启动的建设链。',
  [ACTION_TYPES.BUILD_SITE]: '工地材料已齐备，继续推进真实施工进度。',
  [ACTION_TYPES.CLEAR_FIELD]: '当前农业计划需要可用耕地，推进已有农田开垦。',
  [ACTION_TYPES.SOW_MILLET]: '存在合法播种田块、可用种子与播种窗口。',
  [ACTION_TYPES.HARVEST_MILLET]: '成熟作物具有最高农业处理优先级，立即安排收获。',
  [ACTION_TYPES.REPAIR_TOOL]: '公共工具耐久不足，安排维修以恢复生产能力。',
  [ACTION_TYPES.REPLACE_TOOL]: '工具已达到替换条件，制作下一代公共工具。',
  [ACTION_TYPES.TEND_FIRE]: '夜间或寒冷天气需要篝火，燃料已低于安全需求。',
  [ACTION_TYPES.WARM_BY_FIRE]: '人物湿冷程度达到恢复阈值，靠近篝火取暖烘干。',
  [ACTION_TYPES.REST]: '人物精力不足，返回安全位置恢复体力。',
  [ACTION_TYPES.SLEEP]: '夜间作息规则生效，人物前往住所或营地睡眠。',
});

const PLANNER_BY_ACTION = Object.freeze({
  [ACTION_TYPES.DELIVER_MATERIALS]: 'construction-planner',
  [ACTION_TYPES.BUILD_SITE]: 'construction-planner',
  [ACTION_TYPES.CLEAR_FIELD]: 'farm-planner',
  [ACTION_TYPES.SOW_MILLET]: 'farm-planner',
  [ACTION_TYPES.HARVEST_MILLET]: 'farm-planner',
  [ACTION_TYPES.REPAIR_TOOL]: 'tool-maintenance',
  [ACTION_TYPES.REPLACE_TOOL]: 'tool-maintenance',
  [ACTION_TYPES.TEND_FIRE]: 'fire-safety',
  [ACTION_TYPES.WARM_BY_FIRE]: 'weather-recovery',
  [ACTION_TYPES.SLEEP]: 'night-sleep',
  [ACTION_TYPES.HAUL_TO_CAMP]: 'cargo-priority',
});

function round(value) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return null;
  return Math.round(numeric * 10) / 10;
}

function clone(value) {
  return value == null ? value : structuredClone(value);
}

function freezeList(values) {
  return Object.freeze(values.map((value) => Object.freeze(value)));
}

function uniqueEntries(entries, keyOf) {
  const seen = new Set();
  return entries.filter(Boolean).filter((entry) => {
    const key = keyOf(entry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function compactEffect(effect = {}) {
  return {
    metric: effect.metric ?? null,
    subjectId: effect.subjectId ?? null,
    direction: effect.direction ?? null,
    amount: round(effect.amount ?? effect.estimate ?? effect.value),
    horizon: effect.horizon ?? null,
  };
}

function compactCommitment(entry = {}) {
  return {
    id: entry.id ?? null,
    type: entry.type ?? null,
    sourceKind: entry.sourceKind ?? 'pressure',
    score: round(entry.score),
    priority: round(entry.priority),
    progress: round(entry.progress),
    demandStrength: round(entry.demandStrength),
    desiredWorkers: round(entry.desiredWorkers),
    currentResponders: round(entry.currentResponders),
    remainingDemand: round(entry.remainingDemand),
    status: entry.status ?? null,
    stopReason: entry.stopReason ?? null,
    effects: freezeList((entry.effects ?? []).map(compactEffect)),
  };
}

function compactBlockedCommitment(entry = {}) {
  return {
    id: entry.id ?? null,
    type: entry.type ?? null,
    reason: entry.reason ?? entry.stopReason ?? 'blocked',
    status: entry.status ?? null,
    stopReason: entry.stopReason ?? null,
    desiredWorkers: round(entry.desiredWorkers),
    currentResponders: round(entry.currentResponders),
    remainingDemand: round(entry.remainingDemand),
  };
}

function compactPolicy(entry = {}) {
  return {
    id: entry.id ?? null,
    type: entry.type ?? null,
    reason: entry.reason ?? 'policy-constraint',
    blocked: Boolean(entry.blocked),
    penalty: round(entry.penalty) ?? 0,
    details: Object.freeze(clone(entry.details ?? {})),
  };
}

function compactCandidate(entry = {}) {
  return {
    type: entry.type ?? entry.candidate?.type ?? null,
    label: entry.label ?? entry.candidate?.label ?? entry.type ?? null,
    score: round(entry.score),
    reason: entry.reason ?? '',
    blocked: Boolean(entry.blocked ?? entry.commitmentPolicy?.blocked),
    blockReasons: Object.freeze([
      ...(entry.blockReasons ?? []),
      ...(entry.commitmentPolicy?.reasons ?? []),
    ]),
    factors: Object.freeze(clone(entry.factors ?? {})),
  };
}

function inferPlanner(task) {
  return task?.data?.explanationContext?.planner
    ?? task?.data?.utility?.planner
    ?? PLANNER_BY_ACTION[task?.type]
    ?? (task?.data?.utility ? 'utility' : 'fallback');
}

function inferSummary(task) {
  const utilityReason = task?.data?.utility?.reason;
  if (utilityReason) return utilityReason;
  if (task?.type === ACTION_TYPES.SOW_MILLET && Number(task?.data?.seedTarget ?? 0) > 0) {
    return `种子缓冲满足目标 ${Number(task.data.seedTarget)}，当前田块可以安全播种。`;
  }
  if ([ACTION_TYPES.REPAIR_TOOL, ACTION_TYPES.REPLACE_TOOL].includes(task?.type) && task?.data?.toolLabel) {
    return `${task.data.toolLabel}${task.type === ACTION_TYPES.REPLACE_TOOL ? '需要替换' : '需要维修'}，以维持公共生产能力。`;
  }
  return ACTION_SUMMARIES[task?.type] ?? '当前行动由世界规则与可执行条件共同决定。';
}

function inferHardRules(task) {
  const rules = [];
  const data = task?.data ?? {};
  if (task?.type === ACTION_TYPES.HAUL_TO_CAMP) rules.push('携带物资优先回运');
  if (task?.type === ACTION_TYPES.SLEEP) {
    rules.push('夜间作息优先');
    rules.push(data.sheltered ? '优先使用已分配住所' : '无住所时返回营地露宿点');
  }
  if (task?.type === ACTION_TYPES.TEND_FIRE) rules.push('篝火任务单人并发上限');
  if (task?.type === ACTION_TYPES.WARM_BY_FIRE) rules.push('湿冷达到恢复阈值');
  if ([ACTION_TYPES.REPAIR_TOOL, ACTION_TYPES.REPLACE_TOOL].includes(task?.type)) {
    rules.push('工具维护合计单任务并发');
    if (data.guaranteeGap) rules.push('最低公共工具保障优先');
  }
  if ([ACTION_TYPES.HARVEST_MILLET, ACTION_TYPES.SOW_MILLET, ACTION_TYPES.CLEAR_FIELD].includes(task?.type)) {
    rules.push('农业顺序：成熟收获 → 播种 → 开垦');
  }
  if (task?.type === ACTION_TYPES.SOW_MILLET) rules.push('播种后必须保留种子安全缓冲');
  if ([ACTION_TYPES.DELIVER_MATERIALS, ACTION_TYPES.BUILD_SITE].includes(task?.type)) {
    rules.push('已有工地优先收尾');
    rules.push('建材预留与施工并发不可绕过');
  }
  if (task?.data?.utility?.factors?.emergency > 0) rules.push('紧急生存需求覆盖普通效用排序');
  return [...new Set(rules)];
}

function collectSkipped(context = {}) {
  const skipped = Array.isArray(context.skipped) ? context.skipped : [];
  return skipped.flatMap((entry) => {
    const policyMatches = entry?.policy?.matches ?? entry?.response?.policy?.matches ?? [];
    return policyMatches.map((policy) => ({
      ...policy,
      details: {
        ...(policy.details ?? {}),
        fieldId: entry.fieldId ?? policy.details?.fieldId ?? null,
        actionType: entry.actionType ?? null,
      },
    }));
  });
}

export function buildActionExplanation(task) {
  if (!task?.type) return null;
  const data = task.data ?? {};
  const utility = data.utility ?? null;
  const context = data.explanationContext ?? {};
  const response = data.commitmentResponse ?? null;
  const factorEntries = Object.entries(utility?.factors ?? {})
    .map(([key, value]) => ({ key, value: round(value) ?? 0 }))
    .filter((entry) => entry.value !== 0)
    .sort((first, second) => Math.abs(second.value) - Math.abs(first.value) || first.key.localeCompare(second.key));
  const commitmentEntries = uniqueEntries([
    ...(response?.matches ?? []),
    ...(context.commitmentTargets ?? []),
  ], (entry) => `${entry.id ?? ''}:${entry.type ?? ''}`)
    .map(compactCommitment);
  const blockedEntries = uniqueEntries([
    ...(response?.blocked ?? []),
    ...(context.commitmentBlocked ?? []),
  ], (entry) => `${entry.id ?? ''}:${entry.type ?? ''}:${entry.reason ?? entry.stopReason ?? ''}`)
    .map(compactBlockedCommitment);
  const policyEntries = uniqueEntries([
    ...(response?.policy?.matches ?? []),
    ...(context.commitmentPolicy?.matches ?? []),
    ...collectSkipped(context),
  ], (entry) => `${entry.id ?? ''}:${entry.type ?? ''}:${entry.reason ?? ''}:${entry.details?.fieldId ?? ''}`)
    .map(compactPolicy);
  const candidates = (context.candidates ?? utility?.candidates ?? []).map(compactCandidate);
  const planner = inferPlanner(task);
  const score = round(utility?.score ?? response?.score);
  const effects = uniqueEntries(
    commitmentEntries.flatMap((entry) => entry.effects),
    (entry) => `${entry.metric ?? ''}:${entry.subjectId ?? ''}:${entry.direction ?? ''}:${entry.horizon ?? ''}`,
  );

  return Object.freeze({
    version: 1,
    actionType: task.type,
    actionLabel: task.label ?? task.type,
    planner,
    plannerLabel: PLANNER_LABELS[planner] ?? planner,
    score,
    summary: inferSummary(task),
    factors: freezeList(factorEntries),
    commitments: freezeList(commitmentEntries),
    blockedCommitments: freezeList(blockedEntries),
    policies: freezeList(policyEntries),
    hardRules: Object.freeze(inferHardRules(task)),
    alternatives: freezeList(candidates),
    effects: freezeList(effects),
  });
}

export function plannerLabel(planner) {
  return PLANNER_LABELS[planner] ?? planner ?? '规则调度';
}
