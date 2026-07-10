import { ACTION_TYPES } from './actionTypes.js';
import { estimatePlannedLaborCost } from './laborCostModel.js';

function distance(first, second) {
  return Math.hypot(Number(first.x) - Number(second.x), Number(first.y) - Number(second.y));
}

function locationOf(person) {
  return { x: Math.round(person.location.tileX ?? 0), y: Math.round(person.location.tileY ?? 0) };
}

function estimateDistance(person, destination) {
  return distance(locationOf(person), destination);
}

export function makeActionCandidate({ task, person, source, target = {}, availability = { executable: true, reason: null }, laborContext = {} }) {
  if (!task) return null;
  const runtime = globalThis.shengling ?? {};
  const laborCost = estimatePlannedLaborCost({
    person,
    task,
    mapSystem: laborContext.mapSystem ?? runtime.mapSystem ?? null,
    roadSystem: laborContext.roadSystem ?? runtime.roadSystem ?? null,
    weather: laborContext.weather ?? runtime.weatherSystem?.get?.() ?? null,
  });
  return Object.freeze({
    type: task.type,
    label: task.label,
    destination: { ...task.destination },
    source,
    target: Object.freeze({ ...target }),
    availability: Object.freeze({ ...availability }),
    estimates: Object.freeze({
      distance: estimateDistance(person, task.destination),
      workDuration: Number(laborCost?.effectiveWorkDuration ?? task.workDuration ?? 0),
      expectedDuration: Number(laborCost?.expectedDuration ?? task.workDuration ?? 0),
      expectedEnergy: Number(laborCost?.expectedEnergy ?? 0),
      loadWeight: Number(laborCost?.loadWeight ?? 0),
      terrainFactor: Number(laborCost?.factors?.terrain ?? 1),
      roadFactor: Number(laborCost?.factors?.road ?? 1),
      expectedYield: Number(task.data?.yield ?? 0),
      risk: 0,
    }),
    laborCost,
    createTask: () => structuredClone(task),
  });
}

export function candidateResourceType(type) {
  if (type === ACTION_TYPES.FETCH_WATER) return 'water';
  if (type === ACTION_TYPES.GATHER_BERRIES) return 'food';
  if (type === ACTION_TYPES.CHOP_TREE) return 'wood';
  return null;
}
