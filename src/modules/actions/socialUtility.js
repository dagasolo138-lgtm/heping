import { ACTION_TYPES } from './actionTypes.js';

function relationOf(person, otherId) {
  return person.relations?.[otherId] ?? null;
}

function isFamily(person, otherId) {
  return person.family?.spouseId === otherId
    || person.family?.siblingIds?.includes(otherId)
    || person.family?.parentIds?.includes(otherId)
    || person.family?.childIds?.includes(otherId)
    || relationOf(person, otherId)?.tags?.includes('family');
}

function closeness(person, otherId) {
  const relation = relationOf(person, otherId);
  const family = isFamily(person, otherId) ? 18 : 0;
  return family + Math.max(0, Number(relation?.trust ?? 0)) * 0.18 + Math.max(0, Number(relation?.affinity ?? 0)) * 0.12;
}

function distance(first, second) {
  return Math.hypot(Number(first.x) - Number(second.x), Number(first.y) - Number(second.y));
}

function needForAction(candidate, other) {
  if (candidate.type === ACTION_TYPES.FETCH_WATER) return Math.max(0, Number(other.state?.thirst ?? 0) - 58) * 0.18;
  if (candidate.type === ACTION_TYPES.GATHER_BERRIES) return Math.max(0, Number(other.state?.hunger ?? 0) - 58) * 0.18;
  if (candidate.type === ACTION_TYPES.CHOP_TREE) return 0;
  return 0;
}

function avoidancePenalty(person, candidate, allPeople) {
  return allPeople.reduce((total, other) => {
    if (other.id === person.id || other.location?.tileX === null) return total;
    const relation = relationOf(person, other.id);
    const affinity = Number(relation?.affinity ?? 0);
    const trust = Number(relation?.trust ?? 0);
    if (affinity > -20 && trust > -20) return total;
    const gap = distance(candidate.destination, { x: other.location.tileX, y: other.location.tileY });
    return gap <= 4 ? total - Math.min(12, Math.abs(affinity + trust) * 0.08) : total;
  }, 0);
}

export function scoreSocialUtility({ person, candidate, allPeople = [] } = {}) {
  let score = 0;
  const reasons = [];
  const targets = [];

  allPeople.forEach((other) => {
    if (!other || other.id === person.id || !other.identity?.alive) return;
    const helpNeed = needForAction(candidate, other);
    if (helpNeed <= 0) return;
    const close = closeness(person, other.id);
    if (close <= 0) return;
    const value = Math.min(18, helpNeed + close * 0.35);
    if (value >= 2) {
      score += value;
      const reason = isFamily(person, other.id) ? '亲属需要帮助' : '信任者需要帮助';
      reasons.push(reason);
      targets.push({ personId: other.id, reason, score: Math.round(value * 10) / 10 });
    }
  });

  const avoidance = avoidancePenalty(person, candidate, allPeople);
  if (avoidance < 0) reasons.push('避开关系紧张者');
  score += avoidance;

  return Object.freeze({ score, reasons: [...new Set(reasons)], targets });
}
