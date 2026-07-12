import { TOOL_TYPES } from './toolCatalog.js';

export const TOOL_MAINTENANCE_SCHEMA_VERSION = 1;

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

const POLICIES = Object.freeze({
  [TOOL_TYPES.STONE_AXE]: Object.freeze({
    preventiveThreshold: 0.35,
    criticalThreshold: 0.15,
    targetCondition: 0.86,
    materials: Object.freeze({ wood: 1 }),
    workMinutes: 90,
    skill: 'building',
  }),
  [TOOL_TYPES.CARRYING_BASKET]: Object.freeze({
    preventiveThreshold: 0.4,
    criticalThreshold: 0.18,
    targetCondition: 0.9,
    materials: Object.freeze({ wood: 1 }),
    workMinutes: 70,
    skill: 'gathering',
  }),
  [TOOL_TYPES.SIMPLE_FARM_TOOL]: Object.freeze({
    preventiveThreshold: 0.35,
    criticalThreshold: 0.15,
    targetCondition: 0.86,
    materials: Object.freeze({ wood: 1 }),
    workMinutes: 100,
    skill: 'building',
  }),
  [TOOL_TYPES.STONE_PICK]: Object.freeze({
    preventiveThreshold: 0.3,
    criticalThreshold: 0.12,
    targetCondition: 0.82,
    materials: Object.freeze({ wood: 1 }),
    workMinutes: 110,
    skill: 'building',
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
    demandId: null,
    requestedAt: null,
    reason: null,
    priority: null,
    targetDurability: null,
    materials: {},
    workMinutes: 0,
    skill: null,
  };
}

export function synchronizeMaintenance(tool, previous = null, time = null) {
  const policy = POLICIES[tool?.typeId];
  const condition = toolCondition(tool);
  if (!policy || condition === TOOL_CONDITION_STATES.HEALTHY) {
    return { condition, maintenance: emptyMaintenance() };
  }

  const urgent = condition === TOOL_CONDITION_STATES.BROKEN || condition === TOOL_CONDITION_STATES.CRITICAL;
  const previousDemand = previous?.demandId ? previous : null;
  const targetDurability = Math.min(
    Math.max(1, Number(tool?.maxDurability ?? 1)),
    Math.ceil(Math.max(1, Number(tool?.maxDurability ?? 1)) * policy.targetCondition),
  );
  return {
    condition,
    maintenance: {
      schemaVersion: TOOL_MAINTENANCE_SCHEMA_VERSION,
      state: urgent ? TOOL_MAINTENANCE_STATES.URGENT : TOOL_MAINTENANCE_STATES.REQUESTED,
      demandId: previousDemand?.demandId ?? `tool-maintenance:${tool.id}`,
      requestedAt: previousDemand?.requestedAt ?? clone(time),
      reason: condition === TOOL_CONDITION_STATES.BROKEN ? 'broken' : 'low-durability',
      priority: urgent ? 'high' : 'normal',
      targetDurability,
      materials: clone(policy.materials),
      workMinutes: policy.workMinutes,
      skill: policy.skill,
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
    condition: tool.condition,
    state: tool.maintenance.state,
    requestedAt: clone(tool.maintenance.requestedAt),
    reason: tool.maintenance.reason,
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
    const demand = maintenanceDemandView(tool);
    if (!demand) {
      if (expected.maintenance.state !== TOOL_MAINTENANCE_STATES.NONE) errors.push(`${tool.id}:missing-demand`);
      return;
    }
    if (demandIds.has(demand.id)) errors.push(`${tool.id}:duplicate-demand-id`);
    demandIds.add(demand.id);
    if (expected.maintenance.state === TOOL_MAINTENANCE_STATES.NONE) errors.push(`${tool.id}:stale-demand`);
    if (demand.targetDurability <= demand.currentDurability) errors.push(`${tool.id}:invalid-target`);
    if (!Object.values(demand.materials).some((amount) => Number(amount) > 0)) errors.push(`${tool.id}:missing-materials`);
    if (!(demand.workMinutes > 0)) errors.push(`${tool.id}:invalid-work-minutes`);
  });
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors), demandCount: demandIds.size });
}
