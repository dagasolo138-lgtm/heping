import { ACTION_TYPES } from './actionTypes.js';
import { planCommitmentLaborPortfolio } from './commitmentLaborPlanner.js';
import { evaluateCommitmentPolicy } from './commitmentPolicy.js';
import { commitmentUsesLabor } from './commitmentResponses.js';
import { readActiveRuntimeCommitments, scoreCommitmentUtility } from './commitmentUtility.js';
import { campScarcity, scarcityForAction } from './scarcityUtility.js';
import { scoreSocialUtility } from './socialUtility.js';

const ACTION_SKILLS = Object.freeze({
  [ACTION_TYPES.FETCH_WATER]: 'fishing',
  [ACTION_TYPES.GATHER_BERRIES]: 'gathering',
  [ACTION_TYPES.CHOP_TREE]: 'woodcutting',
});

const ROLE_FIT = Object.freeze({
  woodcutter: { [ACTION_TYPES.CHOP_TREE]: 12, [ACTION_TYPES.HAUL_TO_CAMP]: 5 },
  gatherer: { [ACTION_TYPES.GATHER_BERRIES]: 12, [ACTION_TYPES.FETCH_WATER]: 4 },
  fisher: { [ACTION_TYPES.FETCH_WATER]: 12, [ACTION_TYPES.GATHER_BERRIES]: 4 },
  cook: { [ACTION_TYPES.GATHER_BERRIES]: 9, [ACTION_TYPES.FETCH_WATER]: 4 },
  builder: { [ACTION_TYPES.CHOP_TREE]: 8, [ACTION_TYPES.HAUL_TO_CAMP]: 7 },
  stoneworker: { [ACTION_TYPES.CHOP_TREE]: 6 },
  trader: { [ACTION_TYPES.FETCH_WATER]: 5, [ACTION_TYPES.GATHER_BERRIES]: 4 },
  unassigned: {},
});

function round(value) {
  return Math.round(Number(value || 0) * 10) / 10;
}

function needScore(type, desire) {
  if (type === ACTION_TYPES.FETCH_WATER) return desire.needs.thirst * 48;
  if (type === ACTION_TYPES.GATHER_BERRIES) return desire.needs.hunger * 48;
  if (type === ACTION_TYPES.REST) return desire.needs.fatigue * 58 + desire.needs.stress * 12;
  if (type === ACTION_TYPES.HAUL_TO_CAMP) return 24;
  return 0;
}

function skillScore(type, person) {
  const skill = ACTION_SKILLS[type];
  if (!skill) return 0;
  return Math.min(18, Number(person.work.skills?.[skill] ?? 0) * 2.1);
}

function traitScore(type, desire) {
  if (type === ACTION_TYPES.CHOP_TREE) return desire.traits.diligent * 5 + desire.traits.brave * 2 - desire.traits.cautious * 2;
  if (type === ACTION_TYPES.GATHER_BERRIES) return desire.traits.curious * 3 + desire.traits.patient * 2;
  if (type === ACTION_TYPES.FETCH_WATER) return desire.traits.frugal * 3 + desire.traits.diligent * 2;
  if (type === ACTION_TYPES.REST) return desire.traits.calm * 3 - desire.traits.stubborn * 2;
  return 0;
}

function capPenalty(type, actionCounts) {
  const active = Number(actionCounts?.[type] ?? 0);
  if (type === ACTION_TYPES.FETCH_WATER || type === ACTION_TYPES.GATHER_BERRIES) return active * -3;
  if (type === ACTION_TYPES.CHOP_TREE) return active * -4;
  return active * -2;
}

function laborPenalty(candidate) {
  const duration = Math.max(0, Number(candidate.estimates?.expectedDuration ?? candidate.estimates?.workDuration ?? 0));
  const energy = Math.max(0, Number(candidate.estimates?.expectedEnergy ?? 0));
  return -Math.min(30, duration * 0.18 + energy * 1.35);
}

function explain(factors) {
  return Object.entries(factors)
    .filter(([, value]) => Math.abs(Number(value)) >= 2)
    .sort(([, first], [, second]) => Math.abs(second) - Math.abs(first))
    .slice(0, 3)
    .map(([key]) => ({
      personalNeed: '个人需求',
      campScarcity: '动态库存缺口',
      communityCommitment: '共同承诺',
      communityPolicy: '共同承诺约束',
      skillFit: '技能适配',
      roleFit: '职业倾向',
      traitBias: '性格倾向',
      distance: '距离成本',
      laborCost: '劳动成本',
      crowding: '并发拥挤',
      social: '社会因素',
    }[key] ?? key))
    .join('、');
}

export function scoreUtilityCandidates({
  person,
  desire,
  candidates,
  camp,
  population,
  actionCounts,
  allPeople = [],
  stockTargets = null,
  commitments: providedCommitments = null,
  commitmentLaborPortfolio = null,
  commitmentCapacityByAction = {},
}) {
  const scarcity = campScarcity({ camp, population, stockTargets });
  const commitments = Array.isArray(providedCommitments) ? providedCommitments : readActiveRuntimeCommitments();
  const availableActions = [...new Set(candidates
    .filter((candidate) => candidate?.availability?.executable !== false)
    .map((candidate) => candidate.type)
    .filter(Boolean))];
  const laborPortfolio = commitmentLaborPortfolio ?? planCommitmentLaborPortfolio({
    commitments: commitments.filter((commitment) => commitmentUsesLabor(commitment?.type)),
    population,
    actionCounts,
    availableActions,
    capacityByAction: commitmentCapacityByAction,
  });

  return candidates.map((candidate) => {
    const social = scoreSocialUtility({ person, candidate, allPeople });
    const commitment = scoreCommitmentUtility({ candidate, commitments, laborPortfolio });
    const policy = evaluateCommitmentPolicy({ candidate, commitments });
    const factors = {
      personalNeed: needScore(candidate.type, desire),
      campScarcity: scarcityForAction(candidate.type, scarcity) * 42,
      communityCommitment: commitment.score,
      communityPolicy: policy.penalty,
      skillFit: skillScore(candidate.type, person),
      roleFit: Number(ROLE_FIT[person.work.occupation]?.[candidate.type] ?? ROLE_FIT.unassigned[candidate.type] ?? 0),
      traitBias: traitScore(candidate.type, desire),
      distance: -Math.min(12, Number(candidate.estimates.distance ?? 0) * 0.14),
      laborCost: laborPenalty(candidate),
      crowding: capPenalty(candidate.type, actionCounts),
      social: social.score,
    };
    const rawScore = round(Object.values(factors).reduce((total, value) => total + Number(value || 0), 0));
    const score = policy.blocked ? -10000 : rawScore;
    return Object.freeze({
      candidate,
      score,
      factors: Object.freeze(Object.fromEntries(Object.entries(factors).map(([key, value]) => [key, round(value)]))),
      reason: policy.blocked ? policy.reasons.join('、') : explain(factors) || '低优先级待命',
      socialTargets: social.targets ?? [],
      commitmentTargets: commitment.matches,
      commitmentBlocked: commitment.blocked,
      commitmentPolicy: policy,
    });
  }).sort((first, second) => {
    const blocked = Number(Boolean(first.commitmentPolicy?.blocked)) - Number(Boolean(second.commitmentPolicy?.blocked));
    if (blocked !== 0) return blocked;
    return second.score - first.score;
  });
}
