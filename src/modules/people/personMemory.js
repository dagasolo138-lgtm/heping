import { createId } from '../../core/ids/createId.js';

function makeMemory({ type, summary, time, relatedPersonIds = [], relatedEntityIds = [], details = {}, scope }) {
  if (!summary?.trim()) throw new Error('人物记忆必须有摘要。');
  return {
    id: createId('memory'),
    type: type ?? 'misc',
    summary: summary.trim(),
    time: structuredClone(time),
    relatedPersonIds: [...new Set(relatedPersonIds.filter(Boolean))],
    relatedEntityIds: [...new Set(relatedEntityIds.filter(Boolean))],
    details: structuredClone(details),
    scope,
  };
}

function markRecent(person, memoryId) {
  person.memories.recent = [memoryId, ...person.memories.recent.filter((id) => id !== memoryId)].slice(0, 24);
}

export function appendLifeEvent(person, input) {
  const event = makeMemory({ ...input, scope: 'worldFact' });
  person.memories.lifeEvents.push(event);
  markRecent(person, event.id);
  return event;
}

export function appendPersonalMemory(person, input) {
  const memory = makeMemory({ ...input, scope: 'personal' });
  person.memories.personal.push(memory);
  markRecent(person, memory.id);
  return memory;
}

export function appendEncounterMemory(person, input) {
  return appendPersonalMemory(person, {
    ...input,
    type: input.type ?? 'encounter',
  });
}

export function findMemory(person, memoryId) {
  return [...person.memories.lifeEvents, ...person.memories.personal].find((item) => item.id === memoryId) ?? null;
}
