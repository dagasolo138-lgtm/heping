import { createId } from '../../core/ids/createId.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { availableCampStorage } from './storageGuard.js';

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

function makeHaulTask(person, camp, storage) {
  const carried = carriedItems(person);
  if (!Object.keys(carried).length || availableCampStorage(camp, storage) <= 0) return null;
  return createTask(ACTION_TYPES.HAUL_TO_CAMP, camp.anchor, { campId: camp.id, carried }, 0.65);
}

function makeWaterTask(person, mapSystem) {
  const from = locationOf(person);
  const access = mapSystem.findNearestWaterAccess(from.x, from.y);
  if (!access) return null;
  return createTask(ACTION_TYPES.FETCH_WATER, access, { yield: 3 }, ACTION_META[ACTION_TYPES.FETCH_WATER].workDuration * workerFactor(person, 'fishing'));
}

function makeBerryTask(person, mapSystem, reservedFeatureIds) {
  const from = locationOf(person);
  const bush = mapSystem.findNearestFeature({ x: from.x, y: from.y, kinds: ['berryBush'], excludeIds: [...reservedFeatureIds] });
  if (!bush) return null;
  return createTask(ACTION_TYPES.GATHER_BERRIES, { x: bush.x, y: bush.y }, {
    featureId: bush.id,
    yield: Math.max(1, Number(bush.resource?.berries ?? 3)),
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

export function planNextAction(context) {
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
