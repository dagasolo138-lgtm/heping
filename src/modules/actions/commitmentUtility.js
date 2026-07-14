import { describeCandidateEffects } from './candidateEffects.js';
import { planCommitmentLaborPortfolio } from './commitmentLaborPlanner.js';
import {
  commitmentActions,
  commitmentSupportsAction,
  matchCommitmentEffects,
} from './commitmentResponses.js';

export const MAX_COMMITMENT_SCORE = 18;

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function laborPlanFor(commitment, laborPortfolio) {
  const plans = laborPortfolio?.plans ?? [];
  if (commitment?.id) {
    const exact = plans.find((plan) => plan.commitmentId === commitment.id);
    if (exact) return exact;
  }
  return plans.find((plan) => plan.commitmentType === commitment?.type) ?? null;
}

function laborGap(plan) {
  if (!plan || plan.desiredWorkers <= 0) return 0;
  return clamp(Number(plan.remainingDemand) / Number(plan.desiredWorkers));
}

function contribution(plan) {
  return MAX_COMMITMENT_SCORE * clamp(plan?.demandStrength) * laborGap(plan);
}

function compactEffects(effectMatch) {
  return effectMatch.matches.map(({ effect }) => Object.freeze({
    id: effect.id,
    metric: effect.metric,
    subjectId: effect.subjectId,
    direction: effect.direction,
    amount: effect.amount,
    unit: effect.unit,
    horizon: effect.horizon,
  }));
}

function blockedEntry(commitment, reason, plan = null) {
  return Object.freeze({
    id: commitment?.id ?? null,
    type: commitment?.type ?? null,
    reason,
    status: plan?.status ?? null,
    stopReason: plan?.stopReason ?? null,
  });
}

export function readActiveRuntimeCommitments() {
  try {
    const result = globalThis.shengling?.worldDynamicsSystem?.listCommitments?.({ state: 'active' });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

export function scoreCommitmentUtility({
  candidate,
  commitments = null,
  laborPortfolio = null,
  population = 1,
  actionCounts = {},
  availableActions = null,
  capacityByAction = {},
} = {}) {
  const source = Array.isArray(commitments) ? commitments : readActiveRuntimeCommitments();
  if (!candidate?.type) {
    return Object.freeze({
      score: 0,
      matches: Object.freeze([]),
      blocked: Object.freeze([]),
      effects: Object.freeze([]),
    });
  }

  const effects = describeCandidateEffects({ candidate }).effects;
  const portfolio = laborPortfolio ?? planCommitmentLaborPortfolio({
    commitments: source,
    population,
    actionCounts,
    availableActions: availableActions ?? [candidate.type],
    capacityByAction,
  });
  const matches = [];
  const blocked = [];

  source
    .filter((commitment) => commitment?.state === 'active')
    .filter((commitment) => commitmentSupportsAction(commitment.type, candidate.type))
    .forEach((commitment) => {
      const plan = laborPlanFor(commitment, portfolio);
      const effectMatch = matchCommitmentEffects(commitment.type, effects);
      if (!effectMatch.matched) {
        blocked.push(blockedEntry(commitment, 'no-useful-effect', plan));
        return;
      }
      if (!plan) {
        blocked.push(blockedEntry(commitment, 'missing-labor-plan'));
        return;
      }
      if (!plan.attracting) {
        blocked.push(blockedEntry(commitment, plan.stopReason ?? plan.status, plan));
        return;
      }
      if (Number(plan.slotAllocation?.[candidate.type] ?? 0) <= 0) {
        blocked.push(blockedEntry(commitment, 'no-action-attraction-slot', plan));
        return;
      }
      const score = round(contribution(plan));
      if (score <= 0) {
        blocked.push(blockedEntry(commitment, 'zero-contribution', plan));
        return;
      }
      matches.push(Object.freeze({
        id: commitment.id ?? null,
        type: commitment.type,
        priority: Math.max(0, Math.min(100, Number(commitment.priority) || 0)),
        progress: clamp(commitment.progress),
        demandStrength: plan.demandStrength,
        desiredWorkers: plan.desiredWorkers,
        currentResponders: plan.currentResponders,
        remainingDemand: plan.remainingDemand,
        attractionSlots: plan.attractionSlots,
        saturation: plan.saturation,
        score,
        effects: Object.freeze(compactEffects(effectMatch)),
      }));
    });

  matches.sort((first, second) => second.score - first.score || String(first.id).localeCompare(String(second.id)));
  blocked.sort((first, second) => String(first.id).localeCompare(String(second.id)) || String(first.reason).localeCompare(String(second.reason)));
  const score = round(Math.min(MAX_COMMITMENT_SCORE, matches.reduce((total, entry) => total + entry.score, 0)));
  return Object.freeze({
    score,
    matches: Object.freeze(matches),
    blocked: Object.freeze(blocked),
    effects,
  });
}

export { commitmentActions };
