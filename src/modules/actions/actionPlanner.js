import { createId } from '../../core/ids/createId.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { availableCampStorage } from './storageGuard.js';
import { buildDesireModel } from './desireModel.js';
import { makeActionCandidate } from './actionCandidates.js';
import { scoreUtilityCandidates } from './utilityScorer.js';

const ITEM_TYPES = Object.freeze(['wood', 'berries', 'millet', 'water']);
const ACTION_CAPS = Object.freeze({
  [ACTION_TYPES.FETCH_WATER]: 3,
  [ACTION_TYPES.GATHER_BERRIES]: 3,
  [ACTION_TYPES.CHOP_TREE]: 2,
});

const ROLE_PRIORITY = Object.freeze({
  woodcutter: [ACTION_TYPES.CHOP_TREE, ACTION_TYPES.HAUL_TO_CAMP, ACTION_TYPES.FETCH_WATER],
  gatherer: [ACTION_TYPES.GATHER_BERRIES, ACTION_TYPES.FETCH_WATER, ACTION_TYPES.HAUL_TO_CAMP],
  fisher: [ACTION_TYPES.FETCH_WATER, ACTION_TYPES.GATHER_BERRIES, ACTION_TYPES.HAUL_TO_CAMP],
  cook: [ACTION_TYPES.GATHER_BERRIES, ACTION_TYPES.FETCH_WATER, ACTION_TYPES.HAUL_TO_CAMP],
  builder: [ACTION_TYPES.CHOP_TREE, ACTION_TYPES.HAUL_TO_CAMP, ACTION_TYPES.FETCH_WATER],
  stoneworker: [ACTION_TYPES.CHOP_TREE, ACTION_TYPES.HAUL_TO_CAMP],
  trader: [ACTION_TYPES.FETCH_WATER, ACTION_TYPES.GATHER_BERRIES, ACTION_TYPES.HAUL_TO_CAMP],
  unassigned: [ACTION_TYPES.FETCH_WATER, ACTION_TYPES.GATHER_BERRIES, ACTION_TYPES.CHOP_TREE],
});

function amount(items, itemId) {
  return Number(items?.[itemId] ?? 0);
}

function locationOf(person) {
  return { x: Math.round(person.location.tileX ?? 0), y: Math.round(person.location.tileY ?? 0) };
}

function workerFactor(person, skill) {
  return Math.max(0.52, 1 - Number(person.work.skills?.[skill] ?? 0) * 0.055);
}

function createTask(type, destination, data = {}, duration = ACTION_META[type].workDuration) {
  return {
    id: createId('task'),
    type,
    label: ACTION_META[type].label,
    phaseLabel: ACTION_META[type].phaseLabel,
    destination,
    workDuration: duration,
    data,
  };
}

function carriedItems(person) {
  return Object.fromEntries(ITEM_TYPES.map((itemId) => [itemId, amount(person.inventory.items, itemId)]).filter(([, value]) => value > 0));
}

function carriedAmount(items) {
  return Object.values(items).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
}

function utilitySummary({ score, reason, factors = {}, candidates = [], socialTargets = [] }) {
  return { planner: 'utility', score, reason, factors, candidates, socialTargets };
}

function makeHaulTask(person, camp, storage) {
  const carried = carriedItems(person);
  const available = availableCampStorage(camp, storage);
  const reservedCapacity = Math.min(carriedAmount(carried), available);
  if (!Object.keys(carried).length || reservedCapacity <= 0) return null;
  return createTask(ACTION_TYPES.HAUL_TO_CAMP, camp.anchor, {
    campId: camp.id,
    carried,
    reservedCapacity,
    utility: utilitySummary({
      score: 99,
      reason: '携带物资、营地有可用容量',
      factors: { cargo: 60, campStorage: 39 },
    }),
  }, 0.65);
}

function makeWaterTask(person, mapSystem) {
  const from = locationOf(person);
  const access = mapSystem.findNearestWaterAccess(from.x, from.y);
  if (!access) return null;
  return createTask(ACTION_TYPES.FETCH_WATER, access, { yield: 3 }, ACTION_META[ACTION_TYPES.FETCH_WATER].workDuration * workerFactor(person, 'fishing'));
}

function currentSeasonId() {
  return globalThis.shengling?.seasonSystem?.get?.().id ?? 'spring';
}

function berryYieldMultiplier() {
  return ({ spring: 1, summer: 1, autumn: 0.65, winter: 0.25 }[currentSeasonId()] ?? 1);
}

function makeBerryTask(person, mapSystem, reservedFeatureIds) {
  const from = locationOf(person);
  const bush = mapSystem.findNearestFeature({ x: from.x, y: from.y, kinds: ['berryBush'], excludeIds: [...reservedFeatureIds] });
  if (!bush) return null;
  const multiplier = berryYieldMultiplier();
  return createTask(ACTION_TYPES.GATHER_BERRIES, { x: bush.x, y: bush.y }, {
    featureId: bush.id,
    yield: Math.max(1, Math.round(Number(bush.resource?.berries ?? 3) * multiplier)),
    seasonYieldMultiplier: multiplier,
    seasonId: currentSeasonId(),
  }, ACTION_META[ACTION_TYPES.GATHER_BERRIES].workDuration * workerFactor(person, 'gathering'));
}

function makeChopTask(person, mapSystem, reservedFeatureIds) {
  const from = locationOf(person);
  const tree = mapSystem.findNearestFeature({ x: from.x, y: from.y, kinds: ['tree'], excludeIds: [...reservedFeatureIds] });
  if (!tree) return null;
  const standAt = mapSystem.findNearestWalkableNeighbor(tree.x, tree.y, from.x, from.y);
  if (!standAt) return null;
  return createTask(ACTION_TYPES.CHOP_TREE, standAt, {
    featureId: tree.id,
    treeAt: { x: tree.x, y: tree.y },
    yield: Math.max(1, Number(tree.resource?.wood ?? 4)),
  }, ACTION_META[ACTION_TYPES.CHOP_TREE].workDuration * workerFactor(person, 'woodcutting'));
}

function makeRestTask(camp) {
  return createTask(ACTION_TYPES.REST, camp.anchor, { energyGain: 28, stressLoss: 12 }, ACTION_META[ACTION_TYPES.REST].workDuration);
}

function compactCandidateScore(item) {
  return {
    type: item.candidate.type,
    label: item.candidate.label,
    score: item.score,
    reason: item.reason,
    factors: item.factors,
  };
}

function attachUtilityDebug(task, scoring, scored = []) {
  return {
    ...task,
    data: {
      ...task.data,
      utility: utilitySummary({
        score: scoring.score,
        reason: scoring.reason,
        factors: scoring.factors,
        candidates: scored.map(compactCandidateScore),
        socialTargets: scoring.socialTargets ?? [],
      }),
    },
  };
}

function createUtilityCandidates(context) {
  const { person, camp, mapSystem, reservedFeatureIds } = context;
  const candidates = [];
  const water = makeWaterTask(person, mapSystem);
  if (water) candidates.push(makeActionCandidate({ task: water, person, source: 'nearestWater', target: { itemId: 'water' } }));

  const berries = makeBerryTask(person, mapSystem, reservedFeatureIds);
  if (berries) candidates.push(makeActionCandidate({ task: berries, person, source: 'nearestBerryBush', target: { itemId: 'berries', featureId: berries.data.featureId } }));

  const wood = makeChopTask(person, mapSystem, reservedFeatureIds);
  if (wood) candidates.push(makeActionCandidate({ task: wood, person, source: 'nearestTree', target: { itemId: 'wood', featureId: wood.data.featureId } }));

  if (person.state.energy <= 60) {
    const rest = makeRestTask(camp);
    candidates.push(makeActionCandidate({ task: rest, person, source: 'campRest' }));
  }

  return candidates.filter(Boolean).filter((candidate) => canAssign(candidate.type, context, person));
}

function canAssign(type, context, person) {
  const cap = ACTION_CAPS[type];
  if (!cap) return true;
  if (type === ACTION_TYPES.FETCH_WATER && person.state.thirst >= 68) return true;
  if (type === ACTION_TYPES.GATHER_BERRIES && person.state.hunger >= 68) return true;
  return (context.actionCounts[type] ?? 0) < cap;
}

function makeByType(type, context) {
  const { person, mapSystem, reservedFeatureIds } = context;
  if (type === ACTION_TYPES.FETCH_WATER) return makeWaterTask(person, mapSystem);
  if (type === ACTION_TYPES.GATHER_BERRIES) return makeBerryTask(person, mapSystem, reservedFeatureIds);
  if (type === ACTION_TYPES.CHOP_TREE) return makeChopTask(person, mapSystem, reservedFeatureIds);
  return null;
}

function legacyPlanNextAction(context) {
  const { person, camp, population, storage } = context;
  if (!person.identity.alive) return null;

  const carried = carriedItems(person);
  if (Object.keys(carried).length) return makeHaulTask(person, camp, storage);

  if (person.state.energy <= 28) return makeRestTask(camp);

  const waterGoal = Math.max(12, population * 3);
  const foodGoal = Math.max(10, population * 2);
  const woodGoal = Math.max(18, population * 2.5);
  const foodAmount = amount(camp.items, 'berries') + amount(camp.items, 'millet');
  const shortages = {
    water: amount(camp.items, 'water') < waterGoal,
    food: foodAmount < foodGoal,
    wood: amount(camp.items, 'wood') < woodGoal,
  };

  const urgentTypes = [];
  if (person.state.thirst >= 62) urgentTypes.push(ACTION_TYPES.FETCH_WATER);
  if (person.state.hunger >= 62) urgentTypes.push(ACTION_TYPES.GATHER_BERRIES);

  const rolePlan = ROLE_PRIORITY[person.work.occupation] ?? ROLE_PRIORITY.unassigned;
  const candidates = [...new Set([...urgentTypes, ...rolePlan, ACTION_TYPES.FETCH_WATER, ACTION_TYPES.GATHER_BERRIES, ACTION_TYPES.CHOP_TREE])];

  for (const type of candidates) {
    if (type === ACTION_TYPES.FETCH_WATER && !shortages.water && person.state.thirst < 62) continue;
    if (type === ACTION_TYPES.GATHER_BERRIES && !shortages.food && person.state.hunger < 62) continue;
    if (type === ACTION_TYPES.CHOP_TREE && !shortages.wood) continue;
    if (!canAssign(type, context, person)) continue;
    const task = makeByType(type, context);
    if (task) return task;
  }

  if (person.state.energy <= 48 && (person.location.tileX !== camp.anchor.x || person.location.tileY !== camp.anchor.y)) return makeRestTask(camp);
  return null;
}


export function planNextAction(context) {
  const { person, camp, population, storage } = context;
  if (!person.identity.alive) return null;

  const carried = carriedItems(person);
  if (Object.keys(carried).length) return makeHaulTask(person, camp, storage);

  if (person.state.energy <= 18) {
    const rest = makeRestTask(camp);
    return attachUtilityDebug(rest, { score: 100, reason: '精力过低，需要立即休息', factors: { emergency: 70, personalNeed: 30 } });
  }

  const emergencyTypes = [];
  if (person.state.thirst >= 86) emergencyTypes.push(ACTION_TYPES.FETCH_WATER);
  if (person.state.hunger >= 86) emergencyTypes.push(ACTION_TYPES.GATHER_BERRIES);
  for (const type of emergencyTypes) {
    const task = makeByType(type, context);
    if (task) return attachUtilityDebug(task, { score: 100, reason: '紧急生存需求', factors: { emergency: 100 } });
  }

  const candidates = createUtilityCandidates(context);
  if (candidates.length) {
    const desire = buildDesireModel({ person, camp });
    const scored = scoreUtilityCandidates({ person, desire, candidates, camp, population, actionCounts: context.actionCounts, allPeople: context.people ?? [] });
    const selected = scored[0];
    if (selected?.score >= 24) return attachUtilityDebug(selected.candidate.createTask(), selected, scored);
  }

  return legacyPlanNextAction(context);
}
