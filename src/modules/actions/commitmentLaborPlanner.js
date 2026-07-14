import { commitmentActions } from './commitmentResponses.js';

export const COMMITMENT_LABOR_PLAN_SCHEMA_VERSION = 1;
export const MAX_COMMITMENT_LABOR_SHARE = 0.3;
export const MAX_COMMITMENT_WORKERS = 4;

const PLAN_STATES = new Set(['inactive', 'blocked', 'constrained', 'saturated', 'attracting']);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function integer(value) {
  return Math.max(0, Math.floor(Number(value) || 0));
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

function own(source, key) {
  return source && Object.prototype.hasOwnProperty.call(source, key);
}

function normalizeCountMap(source = {}) {
  return Object.fromEntries(Object.entries(source)
    .map(([key, value]) => [key, integer(value)])
    .filter(([, value]) => value > 0));
}

function normalizeAvailableActions(value) {
  if (value === null || value === undefined) return null;
  if (value instanceof Set) return new Set([...value].map(String));
  if (Array.isArray(value)) return new Set(value.map(String));
  return new Set(Object.entries(value)
    .filter(([, enabled]) => Boolean(enabled))
    .map(([actionType]) => String(actionType)));
}

function actionCapacity(actionType, population, capacityByAction) {
  if (!own(capacityByAction, actionType)) return population;
  return Math.min(population, integer(capacityByAction[actionType]));
}

export function estimateCommitmentDemandStrength(commitment) {
  if (commitment?.state !== 'active') return 0;
  const priority = clamp(Number(commitment.priority) / 100);
  const remaining = 1 - clamp(commitment.progress);
  return round(priority * remaining);
}

function desiredWorkerCount(commitment, population) {
  const strength = estimateCommitmentDemandStrength(commitment);
  if (population <= 0 || strength <= 0) return 0;
  return Math.min(
    population,
    MAX_COMMITMENT_WORKERS,
    Math.max(1, Math.ceil(population * MAX_COMMITMENT_LABOR_SHARE * strength)),
  );
}

function commitmentOrder(first, second) {
  const priority = Number(second?.priority ?? 0) - Number(first?.priority ?? 0);
  if (priority !== 0) return priority;
  const created = Number(first?.createdAt?.tick ?? 0) - Number(second?.createdAt?.tick ?? 0);
  if (created !== 0) return created;
  return String(first?.id ?? first?.type ?? '').localeCompare(String(second?.id ?? second?.type ?? ''));
}

function takeWorkers(source, actionTypes, requested) {
  let remaining = integer(requested);
  const allocation = {};
  actionTypes.forEach((actionType) => {
    if (remaining <= 0) return;
    const available = integer(source[actionType]);
    const amount = Math.min(available, remaining);
    if (amount <= 0) return;
    allocation[actionType] = amount;
    source[actionType] = available - amount;
    remaining -= amount;
  });
  return allocation;
}

function allocationTotal(allocation) {
  return Object.values(allocation).reduce((total, value) => total + integer(value), 0);
}

function stopState({ commitment, population, responseActions, legalActions, desiredWorkers, currentResponders, attractionSlots }) {
  if (commitment?.state !== 'active') return { status: 'inactive', stopReason: 'inactive-commitment', blockers: ['inactive-commitment'] };
  if (clamp(commitment?.progress) >= 1 || desiredWorkers <= 0) return { status: 'inactive', stopReason: 'goal-satisfied', blockers: ['goal-satisfied'] };
  if (population <= 0) return { status: 'blocked', stopReason: 'no-population', blockers: ['no-population'] };
  if (!responseActions.length) return { status: 'blocked', stopReason: 'no-response-action', blockers: ['no-response-action'] };
  if (!legalActions.length) return { status: 'blocked', stopReason: 'no-legal-response', blockers: ['no-legal-response'] };
  if (currentResponders >= desiredWorkers) return { status: 'saturated', stopReason: 'labor-target-met', blockers: [] };
  if (attractionSlots <= 0) return { status: 'constrained', stopReason: 'response-capacity-exhausted', blockers: ['response-capacity-exhausted'] };
  return { status: 'attracting', stopReason: null, blockers: [] };
}

function planOne({
  commitment,
  population,
  availableActionSet,
  remainingResponders,
  remainingCapacity,
}) {
  const responseActions = commitmentActions(commitment?.type);
  const legalActions = availableActionSet === null
    ? [...responseActions]
    : responseActions.filter((actionType) => availableActionSet.has(actionType));
  const demandStrength = estimateCommitmentDemandStrength(commitment);
  const desiredWorkers = desiredWorkerCount(commitment, population);
  const responderAllocation = takeWorkers(remainingResponders, responseActions, desiredWorkers);
  const currentResponders = allocationTotal(responderAllocation);
  const remainingDemand = Math.max(0, desiredWorkers - currentResponders);
  const slotAllocation = takeWorkers(remainingCapacity, legalActions, remainingDemand);
  const attractionSlots = allocationTotal(slotAllocation);
  const targetWorkers = currentResponders + attractionSlots;
  const unmetWorkers = Math.max(0, desiredWorkers - targetWorkers);
  const saturation = desiredWorkers > 0 ? round(currentResponders / desiredWorkers) : 1;
  const capacitySaturation = targetWorkers > 0 ? round(currentResponders / targetWorkers) : 1;
  const state = stopState({
    commitment,
    population,
    responseActions,
    legalActions,
    desiredWorkers,
    currentResponders,
    attractionSlots,
  });

  return deepFreeze({
    schemaVersion: COMMITMENT_LABOR_PLAN_SCHEMA_VERSION,
    commitmentId: commitment?.id ?? null,
    commitmentType: commitment?.type ?? null,
    commitmentState: commitment?.state ?? null,
    priority: Math.max(0, Math.min(100, Number(commitment?.priority) || 0)),
    progress: clamp(commitment?.progress),
    demandStrength,
    desiredWorkers,
    targetWorkers,
    currentResponders,
    remainingDemand,
    attractionSlots,
    unmetWorkers,
    saturation,
    capacitySaturation,
    attracting: state.status === 'attracting',
    capacityConstrained: unmetWorkers > 0,
    status: state.status,
    stopReason: state.stopReason,
    blockers: [...state.blockers],
    responseActions,
    legalActions,
    responderAllocation,
    slotAllocation,
  });
}

export function planCommitmentLaborPortfolio({
  commitments = [],
  population = 0,
  actionCounts = {},
  availableActions = null,
  capacityByAction = {},
} = {}) {
  const normalizedPopulation = integer(population);
  const sourceActionCounts = normalizeCountMap(actionCounts);
  const availableActionSet = normalizeAvailableActions(availableActions);
  const ordered = [...(Array.isArray(commitments) ? commitments : [])].sort(commitmentOrder);
  const trackedActions = [...new Set(ordered.flatMap((commitment) => commitmentActions(commitment?.type)))].sort();
  const remainingResponders = Object.fromEntries(trackedActions
    .map((actionType) => [actionType, integer(sourceActionCounts[actionType])])) ;
  const sourceCapacity = Object.fromEntries(trackedActions.map((actionType) => [
    actionType,
    actionCapacity(actionType, normalizedPopulation, capacityByAction),
  ]));
  const remainingCapacity = Object.fromEntries(trackedActions.map((actionType) => [
    actionType,
    Math.max(0, sourceCapacity[actionType] - integer(sourceActionCounts[actionType])),
  ]));

  const plans = ordered.map((commitment) => planOne({
    commitment,
    population: normalizedPopulation,
    availableActionSet,
    remainingResponders,
    remainingCapacity,
  }));

  const totals = plans.reduce((summary, plan) => {
    summary.desiredWorkers += plan.desiredWorkers;
    summary.targetWorkers += plan.targetWorkers;
    summary.currentResponders += plan.currentResponders;
    summary.attractionSlots += plan.attractionSlots;
    summary.unmetWorkers += plan.unmetWorkers;
    if (plan.attracting) summary.attractingCommitments += 1;
    if (plan.status === 'blocked' || plan.status === 'constrained') summary.blockedCommitments += 1;
    if (plan.status === 'saturated') summary.saturatedCommitments += 1;
    if (plan.commitmentState === 'active') summary.activeCommitments += 1;
    return summary;
  }, {
    commitments: plans.length,
    activeCommitments: 0,
    attractingCommitments: 0,
    blockedCommitments: 0,
    saturatedCommitments: 0,
    desiredWorkers: 0,
    targetWorkers: 0,
    currentResponders: 0,
    attractionSlots: 0,
    unmetWorkers: 0,
  });
  totals.saturation = totals.desiredWorkers > 0 ? round(totals.currentResponders / totals.desiredWorkers) : 1;

  return deepFreeze({
    schemaVersion: COMMITMENT_LABOR_PLAN_SCHEMA_VERSION,
    population: normalizedPopulation,
    sourceActionCounts,
    sourceCapacity,
    plans,
    summary: totals,
    unallocatedResponders: Object.fromEntries(Object.entries(remainingResponders).filter(([, value]) => value > 0)),
    remainingCapacity: Object.fromEntries(Object.entries(remainingCapacity).filter(([, value]) => value > 0)),
  });
}

export function planCommitmentLabor({ commitment, ...context } = {}) {
  return planCommitmentLaborPortfolio({ ...context, commitments: commitment ? [commitment] : [] }).plans[0] ?? null;
}

export function verifyCommitmentLaborPortfolio(portfolio) {
  const issues = [];
  if (portfolio?.schemaVersion !== COMMITMENT_LABOR_PLAN_SCHEMA_VERSION) {
    issues.push({ type: 'invalid-schema-version', value: portfolio?.schemaVersion ?? null });
  }
  if (!Array.isArray(portfolio?.plans)) issues.push({ type: 'missing-plans' });
  const ids = new Set();
  const allocatedByAction = {};
  (portfolio?.plans ?? []).forEach((plan) => {
    if (plan.commitmentId && ids.has(plan.commitmentId)) issues.push({ type: 'duplicate-commitment-plan', commitmentId: plan.commitmentId });
    if (plan.commitmentId) ids.add(plan.commitmentId);
    if (!PLAN_STATES.has(plan.status)) issues.push({ type: 'invalid-plan-status', commitmentId: plan.commitmentId, status: plan.status });
    ['desiredWorkers', 'targetWorkers', 'currentResponders', 'remainingDemand', 'attractionSlots', 'unmetWorkers']
      .forEach((key) => {
        if (!Number.isInteger(plan[key]) || plan[key] < 0) issues.push({ type: 'invalid-worker-count', commitmentId: plan.commitmentId, key, value: plan[key] });
      });
    if (plan.currentResponders > plan.targetWorkers || plan.targetWorkers > plan.desiredWorkers) {
      issues.push({ type: 'invalid-worker-order', commitmentId: plan.commitmentId });
    }
    if (plan.attractionSlots !== plan.targetWorkers - plan.currentResponders) {
      issues.push({ type: 'invalid-attraction-slots', commitmentId: plan.commitmentId });
    }
    if (plan.unmetWorkers !== plan.desiredWorkers - plan.targetWorkers) {
      issues.push({ type: 'invalid-unmet-workers', commitmentId: plan.commitmentId });
    }
    if (plan.attracting !== (plan.status === 'attracting')) {
      issues.push({ type: 'invalid-attracting-state', commitmentId: plan.commitmentId });
    }
    Object.entries(plan.responderAllocation ?? {}).forEach(([actionType, value]) => {
      allocatedByAction[actionType] = (allocatedByAction[actionType] ?? 0) + integer(value);
    });
  });
  Object.entries(allocatedByAction).forEach(([actionType, value]) => {
    if (value > integer(portfolio?.sourceActionCounts?.[actionType])) {
      issues.push({ type: 'responder-overallocation', actionType, allocated: value, available: integer(portfolio?.sourceActionCounts?.[actionType]) });
    }
  });
  const summary = portfolio?.summary ?? {};
  const sum = (key) => (portfolio?.plans ?? []).reduce((total, plan) => total + integer(plan[key]), 0);
  ['desiredWorkers', 'targetWorkers', 'currentResponders', 'attractionSlots', 'unmetWorkers'].forEach((key) => {
    if (integer(summary[key]) !== sum(key)) issues.push({ type: 'invalid-summary-total', key, value: summary[key], expected: sum(key) });
  });
  return deepFreeze({
    ok: issues.length === 0,
    plans: portfolio?.plans?.length ?? 0,
    issues,
  });
}
