import { patchPersonState } from './personMutations.js';

export function applyNeedDelta(person, delta = {}) {
  const target = {};
  for (const [key, amount] of Object.entries(delta)) {
    if (Number.isFinite(person.state[key]) && Number.isFinite(amount)) target[key] = person.state[key] + amount;
  }
  patchPersonState(person, target);
}

export function isInCriticalCondition(person) {
  return person.state.hunger >= 90 || person.state.thirst >= 90 || person.state.health <= 10;
}

export function getNeedSummary(person) {
  return {
    hunger: person.state.hunger,
    thirst: person.state.thirst,
    energy: person.state.energy,
    health: person.state.health,
    stress: person.state.stress,
  };
}
