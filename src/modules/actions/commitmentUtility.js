import { ACTION_TYPES } from './actionTypes.js';

const MAX_COMMITMENT_SCORE = 18;

const ACTIONS_BY_COMMITMENT = Object.freeze({
  'restore-food-reserve': Object.freeze([ACTION_TYPES.GATHER_BERRIES]),
  'emergency-food-supply': Object.freeze([ACTION_TYPES.GATHER_BERRIES]),
  'restore-water-reserve': Object.freeze([ACTION_TYPES.FETCH_WATER]),
  'emergency-water-supply': Object.freeze([ACTION_TYPES.FETCH_WATER]),
  'restore-wood-reserve': Object.freeze([ACTION_TYPES.CHOP_TREE]),
  'improve-storage': Object.freeze([ACTION_TYPES.CHOP_TREE]),
});

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function round(value) {
  return Math.round((Number(value) || 0) * 10) / 10;
}

function contribution(commitment) {
  const priority = clamp(Number(commitment?.priority) / 100);
  const remaining = 1 - clamp(commitment?.progress);
  return MAX_COMMITMENT_SCORE * priority * remaining;
}

export function readActiveRuntimeCommitments() {
  try {
    const result = globalThis.shengling?.worldDynamicsSystem?.listCommitments?.({ state: 'active' });
    return Array.isArray(result) ? result : [];
  } catch {
    return [];
  }
}

export function scoreCommitmentUtility({ candidate, commitments = null } = {}) {
  const source = Array.isArray(commitments) ? commitments : readActiveRuntimeCommitments();
  if (!candidate?.type) return Object.freeze({ score: 0, matches: Object.freeze([]) });
  const matches = source
    .filter((commitment) => commitment?.state === 'active')
    .filter((commitment) => ACTIONS_BY_COMMITMENT[commitment.type]?.includes(candidate.type))
    .map((commitment) => Object.freeze({
      id: commitment.id ?? null,
      type: commitment.type,
      priority: Math.max(0, Math.min(100, Number(commitment.priority) || 0)),
      progress: clamp(commitment.progress),
      score: round(contribution(commitment)),
    }))
    .filter((entry) => entry.score > 0)
    .sort((first, second) => second.score - first.score || String(first.id).localeCompare(String(second.id)));
  const score = round(Math.min(MAX_COMMITMENT_SCORE, matches.reduce((total, entry) => total + entry.score, 0)));
  return Object.freeze({ score, matches: Object.freeze(matches) });
}

export function commitmentActions(type) {
  return [...(ACTIONS_BY_COMMITMENT[type] ?? [])];
}
