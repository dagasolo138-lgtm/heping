import { ACTION_TYPES } from './actionTypes.js';

function responseProfile({ actions, effects }) {
  return Object.freeze({
    actions: Object.freeze([...actions]),
    effects: Object.freeze(effects.map((effect) => Object.freeze({ ...effect }))),
  });
}

const RESPONSES_BY_COMMITMENT = Object.freeze({
  'restore-food-reserve': responseProfile({
    actions: [ACTION_TYPES.GATHER_BERRIES],
    effects: [{ metric: 'effective-stock', subjectId: 'food', direction: 'increase' }],
  }),
  'emergency-food-supply': responseProfile({
    actions: [ACTION_TYPES.GATHER_BERRIES],
    effects: [{ metric: 'effective-stock', subjectId: 'food', direction: 'increase', horizon: 'immediate' }],
  }),
  'restore-water-reserve': responseProfile({
    actions: [ACTION_TYPES.FETCH_WATER],
    effects: [{ metric: 'effective-stock', subjectId: 'water', direction: 'increase' }],
  }),
  'emergency-water-supply': responseProfile({
    actions: [ACTION_TYPES.FETCH_WATER],
    effects: [{ metric: 'effective-stock', subjectId: 'water', direction: 'increase', horizon: 'immediate' }],
  }),
  'restore-wood-reserve': responseProfile({
    actions: [ACTION_TYPES.CHOP_TREE],
    effects: [{ metric: 'effective-stock', subjectId: 'wood', direction: 'increase' }],
  }),
  'improve-storage': responseProfile({
    actions: [ACTION_TYPES.CHOP_TREE],
    effects: [{ metric: 'effective-stock', subjectId: 'wood', direction: 'increase' }],
  }),
});

function effectMatches(requirement, effect) {
  if (!effect || Number(effect.amount) <= 0) return false;
  if (requirement.metric && effect.metric !== requirement.metric) return false;
  if (requirement.subjectId && effect.subjectId !== requirement.subjectId) return false;
  if (requirement.direction && effect.direction !== requirement.direction) return false;
  if (requirement.horizon && effect.horizon !== requirement.horizon) return false;
  return true;
}

export function commitmentResponseProfile(type) {
  const profile = RESPONSES_BY_COMMITMENT[type];
  if (!profile) return Object.freeze({ type, actions: Object.freeze([]), effects: Object.freeze([]) });
  return Object.freeze({ type, actions: profile.actions, effects: profile.effects });
}

export function commitmentActions(type) {
  return [...(RESPONSES_BY_COMMITMENT[type]?.actions ?? [])];
}

export function commitmentSupportsAction(type, actionType) {
  return RESPONSES_BY_COMMITMENT[type]?.actions.includes(actionType) ?? false;
}

export function matchCommitmentEffects(type, effects = []) {
  const requirements = RESPONSES_BY_COMMITMENT[type]?.effects ?? [];
  const source = Array.isArray(effects) ? effects : [];
  const matches = requirements.flatMap((requirement) => {
    const matched = source.find((effect) => effectMatches(requirement, effect));
    return matched ? [Object.freeze({ requirement, effect: matched })] : [];
  });
  return Object.freeze({
    matched: requirements.length > 0 && matches.length > 0,
    requirements,
    matches: Object.freeze(matches),
  });
}

export function listCommitmentResponseProfiles() {
  return Object.freeze(Object.keys(RESPONSES_BY_COMMITMENT)
    .map((type) => commitmentResponseProfile(type))
    .sort((first, second) => first.type.localeCompare(second.type)));
}
