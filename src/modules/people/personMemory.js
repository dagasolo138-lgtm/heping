import { createId } from '../../core/ids/createId.js';

function makeMemory({ type, summary, time, relatedPersonIds = [], details = {}, visibility = 'world' }) {
  if (!summary?.trim()) throw new Error('人生事件必须有摘要。');
  return {
    id: createId('memory'),
    type: type ?? 'misc',
    summary: summary.trim(),
    time: structuredClone(time),
    relatedPersonIds: [...new Set(relatedPersonIds.filter(Boolean))],
    details: structuredClone(details),
    visibility,
  };
}

export function appendLifeEvent(person, input) {
  const event = makeMemory(input);
  person.memories.lifeEvents.push(event);
  person.memories.recent = [event.id, ...person.memories.recent.filter((id) => id !== event.id)].slice(0, 24);
  return event;
}

export function appendPlayerMemory(person, input) {
  const event = makeMemory({ ...input, visibility: 'player' });
  person.memories.player.push(event);
  return event;
}

export function findMemory(person, memoryId) {
  return [...person.memories.lifeEvents, ...person.memories.player].find((item) => item.id === memoryId) ?? null;
}
