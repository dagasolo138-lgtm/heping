import { ACTION_TYPES } from './actionTypes.js';

const ACTIONS_BY_COMMITMENT = Object.freeze({
  'restore-food-reserve': Object.freeze([ACTION_TYPES.GATHER_BERRIES]),
  'emergency-food-supply': Object.freeze([ACTION_TYPES.GATHER_BERRIES]),
  'restore-water-reserve': Object.freeze([ACTION_TYPES.FETCH_WATER]),
  'emergency-water-supply': Object.freeze([ACTION_TYPES.FETCH_WATER]),
  'restore-wood-reserve': Object.freeze([ACTION_TYPES.CHOP_TREE]),
  'improve-storage': Object.freeze([ACTION_TYPES.CHOP_TREE]),
});

export function commitmentActions(type) {
  return [...(ACTIONS_BY_COMMITMENT[type] ?? [])];
}

export function commitmentSupportsAction(type, actionType) {
  return ACTIONS_BY_COMMITMENT[type]?.includes(actionType) ?? false;
}

export function listCommitmentResponseProfiles() {
  return Object.freeze(Object.entries(ACTIONS_BY_COMMITMENT)
    .map(([type, actions]) => Object.freeze({ type, actions: Object.freeze([...actions]) }))
    .sort((first, second) => first.type.localeCompare(second.type)));
}
