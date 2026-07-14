import { ACTION_TYPES } from './actionTypes.js';

export const CANDIDATE_EFFECT_SCHEMA_VERSION = 1;

const VALID_DIRECTIONS = new Set(['increase', 'decrease', 'advance', 'restore']);
const VALID_HORIZONS = new Set(['immediate', 'future']);

function effect({
  id,
  metric,
  subjectId = null,
  subjectKey = null,
  direction,
  unit,
  estimateKey,
  defaultAmount = 1,
  horizon = 'immediate',
}) {
  return Object.freeze({
    id,
    metric,
    subjectId,
    subjectKey,
    direction,
    unit,
    estimateKey,
    defaultAmount,
    horizon,
  });
}

const EFFECTS_BY_ACTION = Object.freeze({
  [ACTION_TYPES.FETCH_WATER]: Object.freeze([
    effect({ id: 'water-stock', metric: 'effective-stock', subjectId: 'water', direction: 'increase', unit: 'item', estimateKey: 'waterAmount', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.GATHER_BERRIES]: Object.freeze([
    effect({ id: 'food-stock', metric: 'effective-stock', subjectId: 'food', direction: 'increase', unit: 'item', estimateKey: 'foodAmount', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.CHOP_TREE]: Object.freeze([
    effect({ id: 'wood-stock', metric: 'effective-stock', subjectId: 'wood', direction: 'increase', unit: 'item', estimateKey: 'woodAmount', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.HAUL_TO_CAMP]: Object.freeze([
    effect({ id: 'camp-delivery', metric: 'effective-stock', subjectId: 'carried-resource', subjectKey: 'itemId', direction: 'increase', unit: 'item', estimateKey: 'deliveredAmount', defaultAmount: 1 }),
    effect({ id: 'cargo-cleared', metric: 'carried-stock', subjectId: 'carried-resource', subjectKey: 'itemId', direction: 'decrease', unit: 'item', estimateKey: 'deliveredAmount', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.DELIVER_MATERIALS]: Object.freeze([
    effect({ id: 'building-materials', metric: 'building-material-readiness', subjectId: 'building', subjectKey: 'buildingId', direction: 'increase', unit: 'item', estimateKey: 'materialAmount', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.BUILD_SITE]: Object.freeze([
    effect({ id: 'building-progress', metric: 'building-progress', subjectId: 'building', subjectKey: 'buildingId', direction: 'advance', unit: 'work', estimateKey: 'workAmount', defaultAmount: 1 }),
    effect({ id: 'storage-protection', metric: 'storage-protection', subjectId: 'building', subjectKey: 'buildingId', direction: 'increase', unit: 'capacity', estimateKey: 'storageProtection', defaultAmount: 0, horizon: 'future' }),
  ]),
  [ACTION_TYPES.CLEAR_FIELD]: Object.freeze([
    effect({ id: 'sowable-fields', metric: 'sowable-fields', subjectId: 'farmland', subjectKey: 'fieldId', direction: 'increase', unit: 'field', estimateKey: 'sowableFields', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.SOW_MILLET]: Object.freeze([
    effect({ id: 'seed-consumption', metric: 'seed-stock', subjectId: 'milletSeed', direction: 'decrease', unit: 'item', estimateKey: 'seedAmount', defaultAmount: 1 }),
    effect({ id: 'planted-fields', metric: 'planted-fields', subjectId: 'farmland', subjectKey: 'fieldId', direction: 'increase', unit: 'field', estimateKey: 'plantedFields', defaultAmount: 1 }),
    effect({ id: 'future-food-capacity', metric: 'future-food-capacity', subjectId: 'millet', direction: 'increase', unit: 'yield', estimateKey: 'expectedYield', defaultAmount: 1, horizon: 'future' }),
  ]),
  [ACTION_TYPES.HARVEST_MILLET]: Object.freeze([
    effect({ id: 'harvest-food', metric: 'effective-stock', subjectId: 'food', direction: 'increase', unit: 'item', estimateKey: 'foodAmount', defaultAmount: 6 }),
    effect({ id: 'harvest-seeds', metric: 'seed-stock', subjectId: 'milletSeed', direction: 'increase', unit: 'item', estimateKey: 'seedReturn', defaultAmount: 2 }),
    effect({ id: 'mature-fields', metric: 'mature-fields', subjectId: 'farmland', subjectKey: 'fieldId', direction: 'decrease', unit: 'field', estimateKey: 'matureFields', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.REPAIR_TOOL]: Object.freeze([
    effect({ id: 'tool-capacity-repair', metric: 'production-capacity', subjectId: 'tool', subjectKey: 'toolId', direction: 'restore', unit: 'capacity', estimateKey: 'restoredCapacity', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.REPLACE_TOOL]: Object.freeze([
    effect({ id: 'tool-capacity-replacement', metric: 'production-capacity', subjectId: 'tool', subjectKey: 'toolId', direction: 'restore', unit: 'capacity', estimateKey: 'restoredCapacity', defaultAmount: 1 }),
    effect({ id: 'tool-generation', metric: 'tool-generation', subjectId: 'tool', subjectKey: 'toolId', direction: 'increase', unit: 'generation', estimateKey: 'generationIncrease', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.TEND_FIRE]: Object.freeze([
    effect({ id: 'fire-reserve', metric: 'fire-heat-buffer', subjectId: 'campfire', direction: 'increase', unit: 'heat', estimateKey: 'heatAmount', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.WARM_BY_FIRE]: Object.freeze([
    effect({ id: 'cold-risk', metric: 'cold-risk', subjectId: 'person', subjectKey: 'personId', direction: 'decrease', unit: 'risk', estimateKey: 'coldRiskReduction', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.REST]: Object.freeze([
    effect({ id: 'rest-fatigue', metric: 'fatigue', subjectId: 'person', subjectKey: 'personId', direction: 'decrease', unit: 'state', estimateKey: 'fatigueReduction', defaultAmount: 1 }),
    effect({ id: 'rest-energy', metric: 'energy', subjectId: 'person', subjectKey: 'personId', direction: 'increase', unit: 'state', estimateKey: 'energyRecovery', defaultAmount: 1 }),
  ]),
  [ACTION_TYPES.SLEEP]: Object.freeze([
    effect({ id: 'sleep-fatigue', metric: 'fatigue', subjectId: 'person', subjectKey: 'personId', direction: 'decrease', unit: 'state', estimateKey: 'fatigueReduction', defaultAmount: 2 }),
    effect({ id: 'sleep-energy', metric: 'energy', subjectId: 'person', subjectKey: 'personId', direction: 'increase', unit: 'state', estimateKey: 'energyRecovery', defaultAmount: 2 }),
  ]),
});

function own(source, key) {
  return source && Object.prototype.hasOwnProperty.call(source, key);
}

function amountFor(template, candidate, estimates) {
  const candidateEstimates = candidate?.effectEstimates ?? {};
  const raw = own(estimates, template.estimateKey)
    ? estimates[template.estimateKey]
    : own(candidateEstimates, template.estimateKey)
      ? candidateEstimates[template.estimateKey]
      : template.defaultAmount;
  const numeric = Number(raw);
  return Number.isFinite(numeric) && numeric >= 0 ? numeric : 0;
}

function subjectFor(template, candidate, subjects) {
  if (!template.subjectKey) return template.subjectId;
  const value = subjects?.[template.subjectKey]
    ?? candidate?.[template.subjectKey]
    ?? candidate?.data?.[template.subjectKey]
    ?? template.subjectId;
  return value === null || value === undefined ? null : String(value);
}

export function candidateEffectProfile(actionType) {
  return Object.freeze([...(EFFECTS_BY_ACTION[actionType] ?? [])]);
}

export function listCandidateEffectProfiles() {
  return Object.freeze(Object.values(ACTION_TYPES).map((actionType) => Object.freeze({
    actionType,
    effects: candidateEffectProfile(actionType),
  })));
}

export function describeCandidateEffects({ candidate, estimates = {}, subjects = {} } = {}) {
  const actionType = candidate?.type ?? null;
  const effects = candidateEffectProfile(actionType).map((template) => Object.freeze({
    id: template.id,
    metric: template.metric,
    subjectId: subjectFor(template, candidate, subjects),
    direction: template.direction,
    amount: amountFor(template, candidate, estimates),
    unit: template.unit,
    horizon: template.horizon,
    estimateKey: template.estimateKey,
  }));
  return Object.freeze({
    schemaVersion: CANDIDATE_EFFECT_SCHEMA_VERSION,
    actionType,
    effects: Object.freeze(effects),
  });
}

export function verifyCandidateEffectCatalog() {
  const issues = [];
  const knownTypes = new Set(Object.values(ACTION_TYPES));
  knownTypes.forEach((actionType) => {
    const profile = EFFECTS_BY_ACTION[actionType];
    if (!Array.isArray(profile) || profile.length === 0) {
      issues.push({ type: 'missing-action-profile', actionType });
      return;
    }
    const ids = new Set();
    profile.forEach((entry) => {
      if (!entry.id || ids.has(entry.id)) issues.push({ type: 'invalid-or-duplicate-effect-id', actionType, id: entry.id ?? null });
      ids.add(entry.id);
      if (!entry.metric) issues.push({ type: 'missing-effect-metric', actionType, id: entry.id });
      if (!VALID_DIRECTIONS.has(entry.direction)) issues.push({ type: 'invalid-effect-direction', actionType, id: entry.id, direction: entry.direction });
      if (!VALID_HORIZONS.has(entry.horizon)) issues.push({ type: 'invalid-effect-horizon', actionType, id: entry.id, horizon: entry.horizon });
      if (!entry.unit) issues.push({ type: 'missing-effect-unit', actionType, id: entry.id });
      if (!entry.estimateKey) issues.push({ type: 'missing-estimate-key', actionType, id: entry.id });
      if (!Number.isFinite(Number(entry.defaultAmount)) || Number(entry.defaultAmount) < 0) {
        issues.push({ type: 'invalid-default-amount', actionType, id: entry.id, amount: entry.defaultAmount });
      }
    });
  });
  Object.keys(EFFECTS_BY_ACTION)
    .filter((actionType) => !knownTypes.has(actionType))
    .forEach((actionType) => issues.push({ type: 'unknown-action-profile', actionType }));
  return Object.freeze({
    ok: issues.length === 0,
    actionTypes: knownTypes.size,
    profiles: Object.keys(EFFECTS_BY_ACTION).length,
    effects: Object.values(EFFECTS_BY_ACTION).reduce((total, entries) => total + entries.length, 0),
    issues: Object.freeze(issues.map((entry) => Object.freeze(entry))),
  });
}
