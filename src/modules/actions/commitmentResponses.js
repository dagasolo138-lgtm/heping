import { ACTION_TYPES } from './actionTypes.js';

function responseProfile({ mode = 'reward', actions = [], effects = [], policyActions = [] }) {
  return Object.freeze({
    mode,
    actions: Object.freeze([...actions]),
    effects: Object.freeze(effects.map((effect) => Object.freeze({ ...effect }))),
    policyActions: Object.freeze([...policyActions]),
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
    actions: [ACTION_TYPES.DELIVER_MATERIALS, ACTION_TYPES.BUILD_SITE],
    effects: [
      { metric: 'building-material-readiness', direction: 'increase' },
      { metric: 'building-progress', direction: 'advance' },
    ],
  }),
  'restore-seed-reserve': responseProfile({
    actions: [ACTION_TYPES.HARVEST_MILLET],
    effects: [{ metric: 'seed-stock', subjectId: 'milletSeed', direction: 'increase' }],
  }),
  'sow-millet-window': responseProfile({
    actions: [ACTION_TYPES.SOW_MILLET],
    effects: [
      { metric: 'planted-fields', direction: 'increase' },
      { metric: 'future-food-capacity', subjectId: 'millet', direction: 'increase', horizon: 'future' },
    ],
  }),
  'harvest-millet-window': responseProfile({
    actions: [ACTION_TYPES.HARVEST_MILLET],
    effects: [
      { metric: 'effective-stock', subjectId: 'food', direction: 'increase' },
      { metric: 'seed-stock', subjectId: 'milletSeed', direction: 'increase' },
    ],
  }),
  'restore-soil-fertility': responseProfile({
    mode: 'policy',
    policyActions: [ACTION_TYPES.SOW_MILLET],
  }),
  'reduce-labor-backlog': responseProfile({
    mode: 'policy',
    policyActions: [
      ACTION_TYPES.CLEAR_FIELD,
      ACTION_TYPES.FETCH_WATER,
      ACTION_TYPES.GATHER_BERRIES,
      ACTION_TYPES.CHOP_TREE,
    ],
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
  if (!profile) {
    return Object.freeze({
      type,
      mode: 'unknown',
      actions: Object.freeze([]),
      effects: Object.freeze([]),
      policyActions: Object.freeze([]),
    });
  }
  return Object.freeze({
    type,
    mode: profile.mode,
    actions: profile.actions,
    effects: profile.effects,
    policyActions: profile.policyActions,
  });
}

export function commitmentActions(type) {
  return [...(RESPONSES_BY_COMMITMENT[type]?.actions ?? [])];
}

export function commitmentPolicyActions(type) {
  return [...(RESPONSES_BY_COMMITMENT[type]?.policyActions ?? [])];
}

export function commitmentResponseMode(type) {
  return RESPONSES_BY_COMMITMENT[type]?.mode ?? 'unknown';
}

export function commitmentUsesLabor(type) {
  const profile = RESPONSES_BY_COMMITMENT[type];
  return profile?.mode === 'reward' && profile.actions.length > 0;
}

export function commitmentSupportsAction(type, actionType) {
  return RESPONSES_BY_COMMITMENT[type]?.actions.includes(actionType) ?? false;
}

export function commitmentAffectsAction(type, actionType) {
  const profile = RESPONSES_BY_COMMITMENT[type];
  return Boolean(profile?.actions.includes(actionType) || profile?.policyActions.includes(actionType));
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
