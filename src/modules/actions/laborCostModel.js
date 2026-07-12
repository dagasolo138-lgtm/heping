import { TERRAIN } from '../../data/constants/terrain.js';
import { ACTION_TYPES } from './actionTypes.js';

const LABOR_ACTIONS = new Set([
  ACTION_TYPES.FETCH_WATER,
  ACTION_TYPES.GATHER_BERRIES,
  ACTION_TYPES.CHOP_TREE,
  ACTION_TYPES.HAUL_TO_CAMP,
  ACTION_TYPES.DELIVER_MATERIALS,
  ACTION_TYPES.BUILD_SITE,
  ACTION_TYPES.CLEAR_FIELD,
  ACTION_TYPES.SOW_MILLET,
  ACTION_TYPES.HARVEST_MILLET,
  ACTION_TYPES.REPAIR_TOOL,
  ACTION_TYPES.REPLACE_TOOL,
  ACTION_TYPES.TEND_FIRE,
]);

const ACTION_SKILL = Object.freeze({
  [ACTION_TYPES.FETCH_WATER]: 'fishing',
  [ACTION_TYPES.GATHER_BERRIES]: 'gathering',
  [ACTION_TYPES.CHOP_TREE]: 'woodcutting',
  [ACTION_TYPES.HAUL_TO_CAMP]: 'gathering',
  [ACTION_TYPES.DELIVER_MATERIALS]: 'building',
  [ACTION_TYPES.BUILD_SITE]: 'building',
  [ACTION_TYPES.CLEAR_FIELD]: 'gathering',
  [ACTION_TYPES.SOW_MILLET]: 'gathering',
  [ACTION_TYPES.HARVEST_MILLET]: 'gathering',
  [ACTION_TYPES.REPAIR_TOOL]: 'building',
  [ACTION_TYPES.REPLACE_TOOL]: 'building',
  [ACTION_TYPES.TEND_FIRE]: 'gathering',
});

const ACTION_INTENSITY = Object.freeze({
  [ACTION_TYPES.FETCH_WATER]: 1,
  [ACTION_TYPES.GATHER_BERRIES]: 1.08,
  [ACTION_TYPES.CHOP_TREE]: 1.55,
  [ACTION_TYPES.HAUL_TO_CAMP]: 1.3,
  [ACTION_TYPES.DELIVER_MATERIALS]: 1.35,
  [ACTION_TYPES.BUILD_SITE]: 1.5,
  [ACTION_TYPES.CLEAR_FIELD]: 1.45,
  [ACTION_TYPES.SOW_MILLET]: 0.9,
  [ACTION_TYPES.HARVEST_MILLET]: 1.25,
  [ACTION_TYPES.REPAIR_TOOL]: 1.18,
  [ACTION_TYPES.REPLACE_TOOL]: 1.35,
  [ACTION_TYPES.TEND_FIRE]: 1,
});

const TERRAIN_SPEED = Object.freeze({
  [TERRAIN.GRASS]: 1,
  [TERRAIN.TALL_GRASS]: 0.84,
  [TERRAIN.FOREST_FLOOR]: 0.86,
  [TERRAIN.DIRT]: 1.03,
  [TERRAIN.SAND]: 0.87,
  [TERRAIN.STONE_GROUND]: 0.89,
  [TERRAIN.FARMLAND]: 0.92,
});

const ITEM_WEIGHT = Object.freeze({ water: 1.1, wood: 1.4, berries: 0.35, millet: 0.45 });

function clamp(value, minimum, maximum) {
  return Math.min(maximum, Math.max(minimum, Number(value) || 0));
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function pointDistance(first, second) {
  return Math.hypot(Number(second?.x ?? 0) - Number(first?.x ?? 0), Number(second?.y ?? 0) - Number(first?.y ?? 0));
}

function routePoints(position, route = []) {
  return [{ x: Number(position?.x ?? 0), y: Number(position?.y ?? 0) }, ...route.map((point) => ({ x: Number(point.x), y: Number(point.y) }))];
}

function routeDistance(position, route = []) {
  const points = routePoints(position, route);
  return points.slice(1).reduce((total, point, index) => total + pointDistance(points[index], point), 0);
}

function carriedWeight(person) {
  return Object.entries(person?.inventory?.items ?? {}).reduce((total, [itemId, amount]) => {
    return total + Math.max(0, Number(amount) || 0) * Number(ITEM_WEIGHT[itemId] ?? 0.75);
  }, 0);
}

function actionSkill(task) {
  if ([ACTION_TYPES.REPAIR_TOOL, ACTION_TYPES.REPLACE_TOOL].includes(task?.type) && task?.data?.skill) return task.data.skill;
  return ACTION_SKILL[task?.type] ?? null;
}

function skillLevel(person, task) {
  const skill = actionSkill(task);
  return skill ? Math.max(0, Number(person?.work?.skills?.[skill] ?? 0)) : 0;
}

function terrainSpeedAt(mapSystem, x, y) {
  const tileX = Math.round(x);
  const tileY = Math.round(y);
  const terrain = mapSystem?.getTerrainAt?.(tileX, tileY) ?? mapSystem?.getTile?.(tileX, tileY)?.terrain;
  return clamp(TERRAIN_SPEED[terrain] ?? 1, 0.5, 1.15);
}

function roadSpeedAt(roadSystem, x, y) {
  return clamp(roadSystem?.getMovementMultiplierAt?.(x, y) ?? 1, 1, 1.25);
}

function averageAlongRoute(position, route, read) {
  const points = routePoints(position, route);
  if (!points.length) return 1;
  return points.reduce((total, point) => total + read(point), 0) / points.length;
}

function weatherMovement(weather) {
  return clamp(weather?.movementMultiplier ?? 1, 0.45, 1.15);
}

function weatherWork(weather) {
  return clamp(weather?.workMultiplier ?? 1, 0.45, 1.15);
}

function loadSpeedMultiplier(weight) {
  return clamp(1 / (1 + Math.max(0, weight) * 0.055), 0.55, 1);
}

function loadEnergyMultiplier(weight) {
  return 1 + Math.max(0, weight) * 0.075;
}

function fatigueSpeedMultiplier(person) {
  const energy = clamp(person?.state?.energy ?? 100, 0, 100);
  return clamp(0.55 + energy / 180, 0.55, 1.11);
}

function fatigueWorkMultiplier(person) {
  const energy = clamp(person?.state?.energy ?? 100, 0, 100);
  return round(1 + Math.max(0, 60 - energy) * 0.008, 4);
}

function fatigueEnergyMultiplier(person) {
  const energy = clamp(person?.state?.energy ?? 100, 0, 100);
  return 1 + Math.max(0, 50 - energy) * 0.012;
}

function skillEnergyMultiplier(person, task) {
  return clamp(1 - skillLevel(person, task) * 0.035, 0.65, 1);
}

function resolveTool(task) {
  if ([ACTION_TYPES.REPAIR_TOOL, ACTION_TYPES.REPLACE_TOOL].includes(task?.type)) return null;
  const system = globalThis.shengling?.toolSystem;
  const explicit = task?.data?.tool ?? task?.data?.laborCost?.tool ?? null;
  if (explicit?.id) {
    const live = system?.get?.(explicit.id);
    if (live?.status === 'usable') return { ...explicit, durability: live.durability, maxDurability: live.maxDurability };
    if (!system) return explicit;
  }
  return system?.previewForAction?.(task?.type) ?? null;
}

function toolEffects(tool) {
  return {
    work: clamp(tool?.effects?.workDurationMultiplier ?? 1, 0.4, 1.2),
    energy: clamp(tool?.effects?.energyMultiplier ?? 1, 0.45, 1.2),
    load: clamp(tool?.effects?.loadWeightMultiplier ?? 1, 0.35, 1.2),
  };
}

function extraEnergyRate({ intensity, loadEnergy, terrainEnergy, roadEnergy, weatherEnergy, fatigueEnergy, skillEnergy, toolEnergy }) {
  const combined = intensity * loadEnergy * terrainEnergy * roadEnergy * weatherEnergy * fatigueEnergy * skillEnergy * toolEnergy;
  return Math.max(0, combined * 0.035 - 0.02);
}

export function isLaborAction(type) {
  return LABOR_ACTIONS.has(type);
}

export function movementLaborMultiplier({ person, task, agent, mapSystem, roadSystem } = {}) {
  if (!isLaborAction(task?.type)) return 1;
  const profile = task?.data?.laborCost;
  const effectiveWeight = Number(profile?.effectiveLoadWeight ?? profile?.loadWeight ?? carriedWeight(person));
  return round(
    terrainSpeedAt(mapSystem, agent?.x ?? 0, agent?.y ?? 0)
      * roadSpeedAt(roadSystem, agent?.x ?? 0, agent?.y ?? 0)
      * loadSpeedMultiplier(effectiveWeight),
    5,
  );
}

export function buildLaborCostProfile({ person, task, position, route = [], mapSystem, roadSystem, weather } = {}) {
  if (!isLaborAction(task?.type)) return null;
  const distance = routeDistance(position, route);
  const tool = resolveTool(task);
  const toolFactor = toolEffects(tool);
  const weight = carriedWeight(person);
  const effectiveLoadWeight = weight * toolFactor.load;
  const terrainFactor = averageAlongRoute(position, route, (point) => terrainSpeedAt(mapSystem, point.x, point.y));
  const roadFactor = averageAlongRoute(position, route, (point) => roadSpeedAt(roadSystem, point.x, point.y));
  const loadFactor = loadSpeedMultiplier(effectiveLoadWeight);
  const weatherMove = weatherMovement(weather);
  const energySpeed = fatigueSpeedMultiplier(person);
  const movementFactor = terrainFactor * roadFactor * loadFactor * weatherMove * energySpeed;
  const travelSeconds = distance / Math.max(0.25, 1.34 * movementFactor);
  const fatigueWork = fatigueWorkMultiplier(person);
  const workDurationMultiplier = fatigueWork * toolFactor.work;
  const baseWorkDuration = Math.max(0, Number(task?.workDuration ?? 0));
  const effectiveWorkDuration = baseWorkDuration * workDurationMultiplier;
  const intensity = Number(ACTION_INTENSITY[task.type] ?? 1);
  const terrainEnergy = 1 / Math.max(0.55, terrainFactor);
  const roadEnergy = 1 / Math.max(1, roadFactor);
  const loadEnergy = loadEnergyMultiplier(effectiveLoadWeight);
  const fatigueEnergy = fatigueEnergyMultiplier(person);
  const skillEnergy = skillEnergyMultiplier(person, task);
  const movementExtraEnergyRate = extraEnergyRate({
    intensity,
    loadEnergy,
    terrainEnergy,
    roadEnergy,
    weatherEnergy: 1 / weatherMove,
    fatigueEnergy,
    skillEnergy,
    toolEnergy: toolFactor.energy,
  });
  const workExtraEnergyRate = extraEnergyRate({
    intensity,
    loadEnergy: task.type === ACTION_TYPES.HAUL_TO_CAMP || task.type === ACTION_TYPES.DELIVER_MATERIALS ? loadEnergy : 1,
    terrainEnergy: 1,
    roadEnergy: 1,
    weatherEnergy: 1 / weatherWork(weather),
    fatigueEnergy,
    skillEnergy,
    toolEnergy: toolFactor.energy,
  });
  const expectedEnergy = travelSeconds * (0.12 + movementExtraEnergyRate)
    + effectiveWorkDuration * (0.12 + workExtraEnergyRate);
  const skill = actionSkill(task);

  return Object.freeze({
    schemaVersion: 2,
    actionType: task.type,
    skill,
    skillLevel: round(skillLevel(person, task)),
    intensity: round(intensity),
    distance: round(distance),
    loadWeight: round(weight),
    effectiveLoadWeight: round(effectiveLoadWeight),
    tool: tool ? Object.freeze({
      id: tool.id,
      typeId: tool.typeId,
      label: tool.label,
      durability: round(tool.durability),
      maxDurability: round(tool.maxDurability),
      effects: Object.freeze({ ...toolFactor }),
      wear: round(tool.wear ?? 0),
    }) : null,
    factors: Object.freeze({
      terrain: round(terrainFactor),
      road: round(roadFactor),
      load: round(loadFactor),
      weatherMovement: round(weatherMove),
      weatherWork: round(weatherWork(weather)),
      fatigueSpeed: round(energySpeed),
      fatigueWork: round(fatigueWork),
      skillEnergy: round(skillEnergy),
      toolWork: round(toolFactor.work),
      toolEnergy: round(toolFactor.energy),
      toolLoad: round(toolFactor.load),
    }),
    baseWorkDuration: round(baseWorkDuration),
    workDurationMultiplier: round(workDurationMultiplier),
    effectiveWorkDuration: round(effectiveWorkDuration),
    travelSeconds: round(travelSeconds),
    expectedDuration: round(travelSeconds + effectiveWorkDuration),
    movementExtraEnergyRate: round(movementExtraEnergyRate, 5),
    workExtraEnergyRate: round(workExtraEnergyRate, 5),
    expectedEnergy: round(expectedEnergy),
  });
}

export function estimatePlannedLaborCost({ person, task, mapSystem, roadSystem, weather } = {}) {
  if (!isLaborAction(task?.type)) return null;
  const position = { x: Number(person?.location?.tileX ?? 0), y: Number(person?.location?.tileY ?? 0) };
  const destination = task?.destination ?? position;
  return buildLaborCostProfile({ person, task, position, route: [destination], mapSystem, roadSystem, weather });
}
