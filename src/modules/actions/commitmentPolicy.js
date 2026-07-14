import { ACTION_TYPES } from './actionTypes.js';
import { commitmentAffectsAction } from './commitmentResponses.js';

export const SOIL_FALLOW_FERTILITY_THRESHOLD = 55;
export const BACKLOG_LONG_TASK_MIN_DURATION = 6;
export const MAX_BACKLOG_POLICY_PENALTY = 12;

const BACKLOG_PENALTY_ACTIONS = new Set([
  ACTION_TYPES.FETCH_WATER,
  ACTION_TYPES.GATHER_BERRIES,
  ACTION_TYPES.CHOP_TREE,
]);

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function finite(value) {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric : null;
}

function demandStrength(commitment) {
  return clamp(Number(commitment?.priority) / 100) * (1 - clamp(commitment?.progress));
}

function fieldFertility(candidate) {
  return finite(candidate?.target?.fieldFertility
    ?? candidate?.fieldFertility
    ?? candidate?.data?.fieldFertility);
}

function soilPolicy(commitment, candidate) {
  if (candidate?.type !== ACTION_TYPES.SOW_MILLET) return null;
  const fertility = fieldFertility(candidate);
  if (fertility === null || fertility >= SOIL_FALLOW_FERTILITY_THRESHOLD) return null;
  return Object.freeze({
    id: commitment.id ?? null,
    type: commitment.type,
    blocked: true,
    penalty: 0,
    reason: 'soil-fallow-required',
    details: Object.freeze({
      fieldId: candidate?.target?.fieldId ?? candidate?.data?.fieldId ?? null,
      fertility,
      threshold: SOIL_FALLOW_FERTILITY_THRESHOLD,
    }),
  });
}

function seedReservePolicy(commitment, candidate) {
  if (candidate?.type !== ACTION_TYPES.SOW_MILLET) return null;
  const available = finite(candidate?.target?.seedAvailableAtCamp
    ?? candidate?.seedAvailableAtCamp
    ?? candidate?.data?.seedAvailableAtCamp);
  const seedAmount = Math.max(0, finite(candidate?.target?.seedAmount
    ?? candidate?.seedAmount
    ?? candidate?.data?.seedAmount) ?? 0);
  const target = Math.max(0, finite(candidate?.target?.seedTarget
    ?? candidate?.seedTarget
    ?? candidate?.data?.seedTarget
    ?? commitment?.goal?.target) ?? 0);
  if (available === null || seedAmount <= 0 || target <= 0) return null;
  const afterSowing = available - seedAmount;
  if (afterSowing >= target) return null;
  return Object.freeze({
    id: commitment.id ?? null,
    type: commitment.type,
    blocked: true,
    penalty: 0,
    reason: 'preserve-seed-buffer',
    details: Object.freeze({
      available: round(available),
      seedAmount: round(seedAmount),
      afterSowing: round(afterSowing),
      target: round(target),
      shortageAfterSowing: round(Math.max(0, target - afterSowing)),
    }),
  });
}

function backlogPolicy(commitment, candidate) {
  const strength = demandStrength(commitment);
  if (strength <= 0) return null;
  if (candidate?.type === ACTION_TYPES.CLEAR_FIELD) {
    return Object.freeze({
      id: commitment.id ?? null,
      type: commitment.type,
      blocked: true,
      penalty: 0,
      reason: 'defer-field-expansion',
      details: Object.freeze({ strength: round(strength) }),
    });
  }
  if (!BACKLOG_PENALTY_ACTIONS.has(candidate?.type)) return null;
  const duration = Math.max(0, Number(candidate?.estimates?.expectedDuration ?? candidate?.estimates?.workDuration ?? 0));
  if (duration <= BACKLOG_LONG_TASK_MIN_DURATION) return null;
  const penalty = -Math.min(
    MAX_BACKLOG_POLICY_PENALTY,
    (duration / BACKLOG_LONG_TASK_MIN_DURATION) * 4 * strength,
  );
  return Object.freeze({
    id: commitment.id ?? null,
    type: commitment.type,
    blocked: false,
    penalty: round(penalty),
    reason: 'long-discretionary-work-penalty',
    details: Object.freeze({
      duration: round(duration),
      threshold: BACKLOG_LONG_TASK_MIN_DURATION,
      strength: round(strength),
    }),
  });
}

function evaluateOne(commitment, candidate) {
  if (commitment?.type === 'restore-seed-reserve') return seedReservePolicy(commitment, candidate);
  if (commitment?.type === 'restore-soil-fertility') return soilPolicy(commitment, candidate);
  if (commitment?.type === 'reduce-labor-backlog') return backlogPolicy(commitment, candidate);
  return null;
}

export function evaluateCommitmentPolicy({ candidate, commitments = [] } = {}) {
  if (!candidate?.type) {
    return Object.freeze({
      blocked: false,
      penalty: 0,
      reasons: Object.freeze([]),
      matches: Object.freeze([]),
    });
  }
  const matches = (Array.isArray(commitments) ? commitments : [])
    .filter((commitment) => commitment?.state === 'active')
    .filter((commitment) => commitmentAffectsAction(commitment.type, candidate.type))
    .map((commitment) => evaluateOne(commitment, candidate))
    .filter(Boolean)
    .sort((first, second) => String(first.id).localeCompare(String(second.id)) || first.reason.localeCompare(second.reason));
  const blocked = matches.some((entry) => entry.blocked);
  const penalty = round(Math.max(
    -MAX_BACKLOG_POLICY_PENALTY,
    matches.reduce((total, entry) => total + Number(entry.penalty || 0), 0),
  ));
  return Object.freeze({
    blocked,
    penalty,
    reasons: Object.freeze(matches.map((entry) => entry.reason)),
    matches: Object.freeze(matches),
  });
}
