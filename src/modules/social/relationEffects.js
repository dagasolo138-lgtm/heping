import { ACTION_TYPES, actionLabel } from '../actions/actionTypes.js';

const CO_WORK_ACTIONS = new Set([
  ACTION_TYPES.FETCH_WATER,
  ACTION_TYPES.GATHER_BERRIES,
  ACTION_TYPES.CHOP_TREE,
  ACTION_TYPES.HAUL_TO_CAMP,
  ACTION_TYPES.DELIVER_MATERIALS,
  ACTION_TYPES.CLEAR_FIELD,
  ACTION_TYPES.SOW_MILLET,
  ACTION_TYPES.HARVEST_MILLET,
  ACTION_TYPES.BUILD_SITE,
]);

function distance(first, second) {
  return Math.hypot(Number(first.x) - Number(second.x), Number(first.y) - Number(second.y));
}

function relationOf(person, otherId) {
  return person.relations?.[otherId] ?? null;
}

function sameDay(first, second) {
  return first?.year === second?.year && first?.day === second?.day;
}

function hasDailyMemory(person, type, otherId, action, time) {
  return [...(person.memories?.personal ?? []), ...(person.memories?.lifeEvents ?? [])].some((memory) => memory.type === type
    && memory.relatedPersonIds?.includes(otherId)
    && memory.details?.action === action
    && sameDay(memory.time, time));
}

function memorySummary(person, other, action) {
  return `${person.identity.name}与${other.identity.name}一起${actionLabel(action)}，彼此更熟悉了一些。`;
}

function emitRelationEvent({ eventBus, type, actorId, targetId, action, delta, time, source }) {
  eventBus?.emit?.('social:relation-changed', {
    type,
    actorId,
    targetId,
    action,
    delta: { ...delta },
    source,
    time: structuredClone(time),
  });
}

function recordCoWorkMemory({ person, other, action, peopleSystem, time }) {
  if (hasDailyMemory(person, 'social:coWork', other.id, action, time)) return null;
  return peopleSystem.addPersonalMemory(person.id, {
    type: 'social:coWork',
    summary: memorySummary(person, other, action),
    relatedPersonIds: [other.id],
    details: {
      action,
      source: 'direct',
      relationDelta: { familiarity: 0.4, affinity: 0.2, trust: 0.15 },
    },
    time,
  });
}


function recordHelpfulIntent({ person, target, task, peopleSystem, time }) {
  if (hasDailyMemory(person, 'social:helpIntent', target.id, task.type, time)) return null;
  return peopleSystem.addPersonalMemory(person.id, {
    type: 'social:helpIntent',
    summary: `${person.identity.name}因为想到${target.identity.name}的需要，选择去${actionLabel(task.type)}。`,
    relatedPersonIds: [target.id],
    details: {
      action: task.type,
      source: 'planner:socialUtility',
      relationDelta: { familiarity: 0.1, affinity: 0.1 },
    },
    time,
  });
}

export function applyHelpfulIntentRelation({ personId, task, peopleSystem, eventBus, gameTime }) {
  const targets = task.data?.utility?.socialTargets ?? [];
  if (!targets.length) return [];
  const person = peopleSystem.get(personId);
  if (!person) return [];
  const time = gameTime.stamp();
  const changed = [];
  targets.forEach((targetInfo) => {
    const target = peopleSystem.get(targetInfo.personId);
    if (!target) return;
    const delta = { familiarity: 0.1, affinity: 0.1 };
    peopleSystem.adjustRelation(person.id, target.id, delta);
    recordHelpfulIntent({ person, target, task, peopleSystem, time });
    emitRelationEvent({ eventBus, type: 'relation:helpIntent', actorId: person.id, targetId: target.id, action: task.type, delta, time, source: targetInfo.reason ?? 'socialUtility' });
    changed.push({ firstId: person.id, secondId: target.id, action: task.type, delta });
  });
  return changed;
}

export function isFamilyOrClose(person, otherId) {
  const relation = relationOf(person, otherId);
  return Boolean(relation?.tags?.some((tag) => ['family', 'spouse', 'sibling', 'parent', 'child', 'friend'].includes(tag))
    || Number(relation?.trust ?? 0) >= 25
    || Number(relation?.affinity ?? 0) >= 25);
}

export function applyCoWorkRelation({ personId, task, agent, agents, peopleSystem, eventBus, gameTime }) {
  if (!CO_WORK_ACTIONS.has(task.type)) return [];
  const person = peopleSystem.get(personId);
  if (!person) return [];
  const time = gameTime.stamp();
  const changed = [];

  agents.forEach((otherAgent) => {
    if (otherAgent.personId === personId || otherAgent.task?.type !== task.type) return;
    if (distance(agent, otherAgent) > 5) return;
    const other = peopleSystem.get(otherAgent.personId);
    if (!other || (!isFamilyOrClose(person, other.id) && !isFamilyOrClose(other, person.id))) return;
    const delta = { familiarity: 0.4, affinity: 0.2, trust: 0.15 };
    peopleSystem.adjustRelation(person.id, other.id, delta);
    peopleSystem.adjustRelation(other.id, person.id, delta);
    recordCoWorkMemory({ person, other, action: task.type, peopleSystem, time });
    recordCoWorkMemory({ person: other, other: person, action: task.type, peopleSystem, time });
    emitRelationEvent({ eventBus, type: 'relation:coWork', actorId: person.id, targetId: other.id, action: task.type, delta, time, source: 'direct' });
    changed.push({ firstId: person.id, secondId: other.id, action: task.type, delta });
  });

  return changed;
}
