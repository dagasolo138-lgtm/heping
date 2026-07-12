import { TOOL_TYPES } from './toolCatalog.js';

export const TOOL_MAINTENANCE_SCHEMA_VERSION = 2;

export const TOOL_CONDITION_STATES = Object.freeze({
  HEALTHY: 'healthy',
  WORN: 'worn',
  CRITICAL: 'critical',
  BROKEN: 'broken',
});

export const TOOL_MAINTENANCE_STATES = Object.freeze({
  NONE: 'none',
  REQUESTED: 'requested',
  URGENT: 'urgent',
});

export const TOOL_MAINTENANCE_MODES = Object.freeze({
  REPAIR: 'repair',
  REPLACE: 'replace',
});

const POLICIES = Object.freeze({
  [TOOL_TYPES.STONE_AXE]: Object.freeze({
    preventiveThreshold: 0.35,
    criticalThreshold: 0.15,
    targetCondition: 0.86,
    materials: Object.freeze({ wood: 1 }),
    workMinutes: 90,
    skill: 'building',
    maxRepairsBeforeReplacement: 2,
    maxWearMultiplier: 2.5,
    replacementMaterials: Object.freeze({ wood: 3 }),
    replacementWorkMinutes: 180,
    replacementSkill: 'building',
  }),
  [TOOL_TYPES.CARRYING_BASKET]: Object.freeze({
    preventiveThreshold: 0.4,
    criticalThreshold: 0.18,
    targetCondition: 0.9,
    materials: Object.freeze({ wood: 1 }),
    workMinutes: 70,
    skill: 'gathering',
    maxRepairsBeforeReplacement: 2,
    maxWearMultiplier: 2.5,
    replacementMaterials: Object.freeze({ wood: 2 }),
    replacementWorkMinutes: 150,
    replacementSkill: 'gathering',
  }),
  [TOOL_TYPES.SIMPLE_FARM_TOOL]: Object.freeze({
    preventiveThreshold: 0.35,
    criticalThreshold: 0.15,
    targetCondition: 0.86,
    materials: Object.freeze({ wood: 1 }),
    workMinutes: 100,
    skill: 'building',
    maxRepairsBeforeReplacement: 2,
    maxWearMultiplier: 2.5,
    replacementMaterials: Object.freeze({ wood: 3 }),
    replacementWorkMinutes: 210,
    replacementSkill: 'building',
  }),
  [TOOL_TYPES.STONE_PICK]: Object.freeze({
    preventiveThreshold: 0.3,
    criticalThreshold: 0.12,
    targetCondition: 0.82,
    materials: Object.freeze({ wood: 1 }),
    workMinutes: 110,
    skill: 'building',
    maxRepairsBeforeReplacement: 2,
    maxWearMultiplier: 2.5,
    replacementMaterials: Object.freeze({ wood: 3 }),
    replacementWorkMinutes: 220,
    replacementSkill: 'building',
  }),
});

function clone(value) {
  return structuredClone(value);
}

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

export function maintenancePolicy(typeId) {
  const policy = POLICIES[typeId];
  return policy ? clone(policy) : null;
}

export function toolCondition(tool) {
  const maximum = Math.max(1, Number(tool?.maxDurability ?? 1));
  const durability = clamp(tool?.durability, 0, maximum);
  const ratio = durability / maximum;
  const policy = POLICIES[tool?.typeId];
  if (durability <= 0 || tool?.status === 'broken') return TOOL_CONDITION_STATES.BROKEN;
  if (!policy) return TOOL_CONDITION_STATES.HEALTHY;
  if (ratio <= policy.criticalThreshold) return TOOL_CONDITION_STATES.CRITICAL;
  if (ratio <= policy.preventiveThreshold) return TOOL_CONDITION_STATES.WORN;
  return TOOL_CONDITION_STATES.HEALTHY;
}

function emptyMaintenance() {
  return {
    schemaVersion: TOOL_MAINTENANCE_SCHEMA_VERSION,
    state: TOOL_MAINTENANCE_STATES.NONE,
    mode: null,
    demandId: null,
    requestedAt: null,
    reason: null,
    replacementReason: null,
    priority: null,
    targetDurability: null,
    materials: {},
    workMinutes: 0,
    skill: null,
  };
}

function replacementReasonFor(tool, policy) {
  const repairs = Math.max(0, Number(tool?.repairsSinceReplacement ?? 0));
  if (repairs >= Number(policy.maxRepairsBeforeReplacement ?? Infinity)) return 'repair-limit';
  const maximum = Math.max(1, Number(tool?.maxDurability ?? 1));
  const wear = Math.max(0, Number(tool?.wearSinceReplacement ?? 0));
  if (wear >= maximum * Number(policy.maxWearMultiplier ?? Infinity)) return 'wear-limit';
  return null;
}

export function synchronizeMaintenance(tool, previous = null, time = null) {
  const policy = POLICIES[tool?.typeId];
  const condition = toolCondition(tool);
  if (!policy || condition === TOOL_CONDITION_STATES.HEALTHY) {
    return { condition, maintenance: emptyMaintenance() };
  }

  const replacementReason = replacementReasonFor(tool, policy);
  const mode = replacementReason ? TOOL_MAINTENANCE_MODES.REPLACE : TOOL_MAINTENANCE_MODES.REPAIR;
  const urgent = mode === TOOL_MAINTENANCE_MODES.REPLACE
    || condition === TOOL_CONDITION_STATES.BROKEN
    || condition === TOOL_CONDITION_STATES.CRITICAL;
  const previousMode = previous?.mode ?? (previous?.demandId ? TOOL_MAINTENANCE_MODES.REPAIR : null);
  const previousDemand = previous?.demandId && previousMode === mode ? previous : null;
  const maximum = Math.max(1, Number(tool?.maxDurability ?? 1));
  const targetDurability = mode === TOOL_MAINTENANCE_MODES.REPLACE
    ? maximum
    : Math.min(maximum, Math.ceil(maximum * policy.targetCondition));
  const materials = mode === TOOL_MAINTENANCE_MODES.REPLACE ? policy.replacementMaterials : policy.materials;
  const workMinutes = mode === TOOL_MAINTENANCE_MODES.REPLACE ? policy.replacementWorkMinutes : policy.workMinutes;
  const skill = mode === TOOL_MAINTENANCE_MODES.REPLACE ? policy.replacementSkill : policy.skill;

  return {
    condition,
    maintenance: {
      schemaVersion: TOOL_MAINTENANCE_SCHEMA_VERSION,
      state: urgent ? TOOL_MAINTENANCE_STATES.URGENT : TOOL_MAINTENANCE_STATES.REQUESTED,
      mode,
      demandId: previousDemand?.demandId
        ?? (mode === TOOL_MAINTENANCE_MODES.REPLACE ? `tool-replacement:${tool.id}` : `tool-maintenance:${tool.id}`),
      requestedAt: previousDemand?.requestedAt ?? clone(time),
      reason: mode === TOOL_MAINTENANCE_MODES.REPLACE
        ? 'replacement-required'
        : condition === TOOL_CONDITION_STATES.BROKEN ? 'broken' : 'low-durability',
      replacementReason,
      priority: urgent ? 'high' : 'normal',
      targetDurability,
      materials: clone(materials),
      workMinutes,
      skill,
    },
  };
}

export function maintenanceDemandView(tool) {
  if (!tool?.maintenance?.demandId || tool.maintenance.state === TOOL_MAINTENANCE_STATES.NONE) return null;
  return Object.freeze({
    schemaVersion: TOOL_MAINTENANCE_SCHEMA_VERSION,
    id: tool.maintenance.demandId,
    toolId: tool.id,
    typeId: tool.typeId,
    label: tool.label,
    generation: Math.max(1, Number(tool.generation ?? 1)),
    condition: tool.condition,
    state: tool.maintenance.state,
    mode: tool.maintenance.mode ?? TOOL_MAINTENANCE_MODES.REPAIR,
    requestedAt: clone(tool.maintenance.requestedAt),
    reason: tool.maintenance.reason,
    replacementReason: tool.maintenance.replacementReason ?? null,
    priority: tool.maintenance.priority,
    currentDurability: Number(tool.durability),
    targetDurability: Number(tool.maintenance.targetDurability),
    materials: clone(tool.maintenance.materials),
    workMinutes: Number(tool.maintenance.workMinutes),
    skill: tool.maintenance.skill,
  });
}

export function verifyToolMaintenance(tools = []) {
  const errors = [];
  const demandIds = new Set();
  tools.forEach((tool) => {
    const expected = synchronizeMaintenance(tool, tool.maintenance, tool.maintenance?.requestedAt);
    if (tool.condition !== expected.condition) errors.push(`${tool.id}:condition-mismatch`);
    if (!(Number(tool.generation) >= 1)) errors.push(`${tool.id}:invalid-generation`);
    if (Number(tool.repairsSinceReplacement) < 0) errors.push(`${tool.id}:invalid-generation-repairs`);
    if (Number(tool.wearSinceReplacement) < 0) errors.push(`${tool.id}:invalid-generation-wear`);
    const demand = maintenanceDemandView(tool);
    if (!demand) {
      if (expected.maintenance.state !== TOOL_MAINTENANCE_STATES.NONE) errors.push(`${tool.id}:missing-demand`);
      return;
    }
    if (demandIds.has(demand.id)) errors.push(`${tool.id}:duplicate-demand-id`);
    demandIds.add(demand.id);
    if (expected.maintenance.state === TOOL_MAINTENANCE_STATES.NONE) errors.push(`${tool.id}:stale-demand`);
    if (![TOOL_MAINTENANCE_MODES.REPAIR, TOOL_MAINTENANCE_MODES.REPLACE].includes(demand.mode)) errors.push(`${tool.id}:invalid-mode`);
    if (demand.mode !== expected.maintenance.mode) errors.push(`${tool.id}:mode-mismatch`);
    if (demand.targetDurability <= demand.currentDurability) errors.push(`${tool.id}:invalid-target`);
    if (!Object.values(demand.materials).some((amount) => Number(amount) > 0)) errors.push(`${tool.id}:missing-materials`);
    if (!(demand.workMinutes > 0)) errors.push(`${tool.id}:invalid-work-minutes`);
  });
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), demandCount: demandIds.size });
}
