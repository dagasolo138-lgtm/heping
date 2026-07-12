import { createId } from '../../core/ids/createId.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { availableCampStorage } from './storageGuard.js';
import { buildDesireModel } from './desireModel.js';
import { makeActionCandidate } from './actionCandidates.js';
import { buildDynamicStockTargets, stockResourceForAction } from './stockTargetModel.js';
import { scoreUtilityCandidates } from './utilityScorer.js';
import { planToolMaintenanceAction } from './toolMaintenancePlanner.js';

const ITEM_TYPES = Object.freeze(['milletSeed', 'wood', 'berries', 'millet', 'water']);
const MAINTENANCE_ACTIONS = new Set([ACTION_TYPES.REPAIR_TOOL, ACTION_TYPES.REPLACE_TOOL]);
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

function addAmount(target, itemId, value) {
  target[itemId] = Number(target[itemId] ?? 0) + Math.max(0, Number(value) || 0);
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
  return Object.fromEntries(ITEM_TYPES
    .map((itemId) => [itemId, amount(person.inventory.items, itemId)])
    .filter(([, value]) => value > 0));
}

function carriedAmount(items) {
  return Object.values(items).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
}

function aggregateCarried(people = []) {
  const carried = {};
  people.forEach((person) => {
    Object.entries(person.inventory?.items ?? {}).forEach(([itemId, value]) => addAmount(carried, itemId, value));
  });
  return carried;
}

function currentSeasonId() {
  return globalThis.shengling?.seasonSystem?.get?.().id ?? 'spring';
}

function berryYieldMultiplier() {
  return ({ spring: 1, summer: 1, autumn: 0.65, winter: 0.25 }[currentSeasonId()] ?? 1);
}

function estimateIncoming(actionCounts = {}) {
  return {
    water: Number(actionCounts[ACTION_TYPES.FETCH_WATER] ?? 0) * 3,
    food: Number(actionCounts[ACTION_TYPES.GATHER_BERRIES] ?? 0) * Math.max(1, Math.round(3 * berryYieldMultiplier())),
    wood: Number(actionCounts[ACTION_TYPES.CHOP_TREE] ?? 0) * 5,
  };
}

function buildingPipeline() {
  const buildingSystem = globalThis.shengling?.buildingSystem;
  const committed = {};
  const constructionNeed = {};
  if (!buildingSystem?.list) return { committed, constructionNeed };

  buildingSystem.list({ includeCompleted: false }).forEach((building) => {
    (building.materials?.reservations ?? []).forEach((reservation) => addAmount(committed, reservation.itemId, reservation.amount));
    const need = buildingSystem.getMaterialNeed?.(building.id) ?? {};
    Object.entries(need).forEach(([itemId, value]) => addAmount(constructionNeed, itemId, value));
  });
  return { committed, constructionNeed };
}

function maintenancePipeline() {
  const runtime = globalThis.shengling ?? {};
  const committed = {};
  const constructionNeed = {};
  const reservations = runtime.reservationLedger?.list?.() ?? [];
  (runtime.toolSystem?.listMaintenanceDemands?.() ?? []).forEach((demand) => {
    const active = reservations.some((entry) => entry.type === 'tool'
      && entry.key === demand.toolId
      && MAINTENANCE_ACTIONS.has(entry.metadata?.actionType));
    Object.entries(demand.materials ?? {}).forEach(([itemId, value]) => {
      addAmount(active ? committed : constructionNeed, itemId, value);
    });
  });
  return { committed, constructionNeed };
}

export function buildPlanningStockTargets(context = {}) {
  const runtime = globalThis.shengling ?? {};
  const pipeline = buildingPipeline();
  const maintenance = maintenancePipeline();
  Object.entries(maintenance.committed).forEach(([itemId, value]) => addAmount(pipeline.committed, itemId, value));
  Object.entries(maintenance.constructionNeed).forEach(([itemId, value]) => addAmount(pipeline.constructionNeed, itemId, value));
  addAmount(pipeline.committed, 'wood', Number(context.actionCounts?.[ACTION_TYPES.TEND_FIRE] ?? 0));
  return buildDynamicStockTargets({
    population: context.population ?? context.people?.length ?? 0,
    camp: context.camp,
    storage: context.storage,
    seasonId: currentSeasonId(),
    weather: runtime.weatherSystem?.get?.() ?? null,
    carried: aggregateCarried(context.people ?? []),
    incoming: estimateIncoming(context.actionCounts),
    committed: pipeline.committed,
    constructionNeed: pipeline.constructionNeed,
  });
}

function utilitySummary({ score, reason, factors = {}, candidates = [], socialTargets = [] }) {
  return { planner: 'utility', score, reason, factors, candidates, socialTargets };
}

function stockTargetSummary(type, stockTargets) {
  const resource = stockResourceForAction(type);
  if (!resource || !stockTargets) return null;
  return {
    resource,
    goal: Number(stockTargets.goals?.[resource] ?? 0),
    rawGoal: Number(stockTargets.rawGoals?.[resource] ?? 0),
    effective: Number(stockTargets.amounts?.effective?.[resource] ?? 0),
    shortage: Number(stockTargets.shortageUnits?.[resource] ?? 0),
    capacityConstrained: Boolean(stockTargets.capacity?.constrained),
    horizonDays: Number(stockTargets.horizonDays ?? 0),
  };
}

function attachStockTarget(task, stockTargets) {
  const stockTarget = stockTargetSummary(task?.type, stockTargets);
  if (!task || !stockTarget) return task;
  return { ...task, data: { ...(task.data ?? {}), stockTarget } };
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
  return createTask(
    ACTION_TYPES.FETCH_WATER,
    access,
    { yield: 3 },
    ACTION_META[ACTION_TYPES.FETCH_WATER].workDuration * workerFactor(person, 'fishing'),
  );
}

function makeBerryTask(person, mapSystem, reservedFeatureIds) {
  const from = locationOf(person);
  const bush = mapSystem.findNearestFeature({
    x: from.x,
    y: from.y,
    kinds: ['berryBush'],
    excludeIds: [...reservedFeatureIds],
  });
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
  const tree = mapSystem.findNearestFeature({
    x: from.x,
    y: from.y,
    kinds: ['tree'],
    excludeIds: [...reservedFeatureIds],
  });
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
  return createTask(ACTION_TYPES.REST, camp.anchor, {
    energyGain: 28,
    stressLoss: 12,
  }, ACTION_META[ACTION_TYPES.REST].workDuration);
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

function needsResource(type, context, person) {
  const resource = stockResourceForAction(type);
  if (!resource) return true;
  const shortage = Number(context.stockTargets?.shortageUnits?.[resource] ?? 0);
  if (shortage > 0) return true;
  if (type === ACTION_TYPES.FETCH_WATER) return person.state.thirst >= 68;
  if (type === ACTION_TYPES.GATHER_BERRIES) return person.state.hunger >= 68;
  return false;
}

function createUtilityCandidates(context) {
  const { person, camp, mapSystem, reservedFeatureIds } = context;
  const candidates = [];

  if (needsResource(ACTION_TYPES.FETCH_WATER, context, person)) {
    const water = attachStockTarget(makeWaterTask(person, mapSystem), context.stockTargets);
    if (water) candidates.push(makeActionCandidate({
      task: water,
      person,
      source: 'nearestWater',
      target: { itemId: 'water' },
    }));
  }

  if (needsResource(ACTION_TYPES.GATHER_BERRIES, context, person)) {
    const berries = attachStockTarget(makeBerryTask(person, mapSystem, reservedFeatureIds), context.stockTargets);
    if (berries) candidates.push(makeActionCandidate({
      task: berries,
      person,
      source: 'nearestBerryBush',
      target: { itemId: 'berries', featureId: berries.data.featureId },
    }));
  }

  if (needsResource(ACTION_TYPES.CHOP_TREE, context, person)) {
    const wood = attachStockTarget(makeChopTask(person, mapSystem, reservedFeatureIds), context.stockTargets);
    if (wood) candidates.push(makeActionCandidate({
      task: wood,
      person,
      source: 'nearestTree',
      target: { itemId: 'wood', featureId: wood.data.featureId },
    }));
  }

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
  let task = null;
  if (type === ACTION_TYPES.FETCH_WATER) task = makeWaterTask(person, mapSystem);
  if (type === ACTION_TYPES.GATHER_BERRIES) task = makeBerryTask(person, mapSystem, reservedFeatureIds);
  if (type === ACTION_TYPES.CHOP_TREE) task = makeChopTask(person, mapSystem, reservedFeatureIds);
  return attachStockTarget(task, context.stockTargets);
}

function legacyPlanNextAction(context) {
  const { person, camp, storage } = context;
  if (!person.identity.alive) return null;

  const carried = carriedItems(person);
  if (Object.keys(carried).length) return makeHaulTask(person, camp, storage);

  if (person.state.energy <= 28) return makeRestTask(camp);

  const shortages = {
    water: Number(context.stockTargets?.shortageUnits?.water ?? 0) > 0,
    food: Number(context.stockTargets?.shortageUnits?.food ?? 0) > 0,
    wood: Number(context.stockTargets?.shortageUnits?.wood ?? 0) > 0,
  };

  const urgentTypes = [];
  if (person.state.thirst >= 62) urgentTypes.push(ACTION_TYPES.FETCH_WATER);
  if (person.state.hunger >= 62) urgentTypes.push(ACTION_TYPES.GATHER_BERRIES);

  const rolePlan = ROLE_PRIORITY[person.work.occupation] ?? ROLE_PRIORITY.unassigned;
  const candidates = [...new Set([
    ...urgentTypes,
    ...rolePlan,
    ACTION_TYPES.FETCH_WATER,
    ACTION_TYPES.GATHER_BERRIES,
    ACTION_TYPES.CHOP_TREE,
  ])];

  for (const type of candidates) {
    if (type === ACTION_TYPES.FETCH_WATER && !shortages.water && person.state.thirst < 62) continue;
    if (type === ACTION_TYPES.GATHER_BERRIES && !shortages.food && person.state.hunger < 62) continue;
    if (type === ACTION_TYPES.CHOP_TREE && !shortages.wood) continue;
    if (!canAssign(type, context, person)) continue;
    const task = makeByType(type, context);
    if (task) return task;
  }

  if (person.state.energy <= 48
    && (person.location.tileX !== camp.anchor.x || person.location.tileY !== camp.anchor.y)) {
    return makeRestTask(camp);
  }
  return null;
}

export function planNextAction(inputContext) {
  const { person, camp, population, storage } = inputContext;
  if (!person.identity.alive) return null;
  const stockTargets = inputContext.stockTargets ?? buildPlanningStockTargets(inputContext);
  const context = { ...inputContext, stockTargets };

  const carried = carriedItems(person);
  if (Object.keys(carried).length) return makeHaulTask(person, camp, storage);

  if (person.state.energy <= 18) {
    const rest = makeRestTask(camp);
    return attachUtilityDebug(rest, {
      score: 100,
      reason: '精力过低，需要立即休息',
      factors: { emergency: 70, personalNeed: 30 },
    });
  }

  const emergencyTypes = [];
  if (person.state.thirst >= 86) emergencyTypes.push(ACTION_TYPES.FETCH_WATER);
  if (person.state.hunger >= 86) emergencyTypes.push(ACTION_TYPES.GATHER_BERRIES);
  for (const type of emergencyTypes) {
    const task = makeByType(type, context);
    if (task) return attachUtilityDebug(task, {
      score: 100,
      reason: '紧急生存需求',
      factors: { emergency: 100 },
    });
  }

  const maintenance = planToolMaintenanceAction({
    person,
    camp,
    actionCounts: context.actionCounts,
  });
  if (maintenance) return maintenance;

  const candidates = createUtilityCandidates(context);
  if (candidates.length) {
    const desire = buildDesireModel({ person, camp });
    const scored = scoreUtilityCandidates({
      person,
      desire,
      candidates,
      camp,
      population,
      actionCounts: context.actionCounts,
      allPeople: context.people ?? [],
      stockTargets,
    });
    const selected = scored[0];
    if (selected?.score >= 24) return attachUtilityDebug(selected.candidate.createTask(), selected, scored);
  }

  return legacyPlanNextAction(context);
}
