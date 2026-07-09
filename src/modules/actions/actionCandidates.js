import { ACTION_TYPES } from './actionTypes.js';

function distance(first, second) {
  return Math.hypot(Number(first.x) - Number(second.x), Number(first.y) - Number(second.y));
}

function locationOf(person) {
  return { x: Math.round(person.location.tileX ?? 0), y: Math.round(person.location.tileY ?? 0) };
}

function estimateDistance(person, destination) {
  return distance(locationOf(person), destination);
}

export function makeActionCandidate({ task, person, source, target = {}, availability = { executable: true, reason: null } }) {
  if (!task) return null;
  return Object.freeze({
    type: task.type,
    label: task.label,
    destination: { ...task.destination },
    source,
    target: Object.freeze({ ...target }),
    availability: Object.freeze({ ...availability }),
    estimates: Object.freeze({
      distance: estimateDistance(person, task.destination),
      workDuration: Number(task.workDuration ?? 0),
      expectedYield: Number(task.data?.yield ?? 0),
      risk: 0,
    }),
    createTask: () => structuredClone(task),
  });
}

export function candidateResourceType(type) {
  if (type === ACTION_TYPES.FETCH_WATER) return 'water';
  if (type === ACTION_TYPES.GATHER_BERRIES) return 'food';
  if (type === ACTION_TYPES.CHOP_TREE) return 'wood';
  return null;
}
