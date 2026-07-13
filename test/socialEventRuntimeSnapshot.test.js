import test from 'node:test';
import assert from 'node:assert/strict';

import { createSocialEventSystem } from '../src/modules/social/socialEventSystem.js';

function createBus() {
  const listeners = new Map();
  return {
    on(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, []);
      listeners.get(eventName).push(listener);
      return () => {
        const group = listeners.get(eventName) ?? [];
        const index = group.indexOf(listener);
        if (index >= 0) group.splice(index, 1);
      };
    },
    emit(eventName, payload) {
      (listeners.get(eventName) ?? []).forEach((listener) => listener(payload));
    },
  };
}

function runtimePerson(id, name, x, y) {
  return {
    id,
    identity: { name, alive: true },
    location: { tileX: x, tileY: y },
    work: { skills: { social: 0 } },
    relations: {},
  };
}

test('单个社会事件只读取一次移动快照，并按人物缓存记忆事件 ID', () => {
  const bus = createBus();
  const people = [
    runtimePerson('p1', '阿一', 0, 0),
    runtimePerson('p2', '阿二', 1, 0),
    runtimePerson('p3', '阿三', 20, 0),
  ];
  const memories = new Map(people.map((person) => [person.id, []]));
  let movementReads = 0;
  let fullPersonReads = 0;
  let memoryWrites = 0;

  const peopleSystem = {
    getAliveRuntime: () => people,
    getRuntime: (id) => people.find((person) => person.id === id) ?? null,
    get(id) {
      fullPersonReads += 1;
      const person = people.find((entry) => entry.id === id);
      return person ? { ...person, memories: { personal: structuredClone(memories.get(id) ?? []) } } : null;
    },
    addPersonalMemory(id, memory) {
      memoryWrites += 1;
      const entry = { ...structuredClone(memory), id: `memory-${memoryWrites}` };
      memories.get(id).push(entry);
      return structuredClone(entry);
    },
    adjustRelation() {},
  };
  const gameTime = {
    now: () => ({ tick: 10 }),
    stamp: () => ({ tick: 10, year: 1, day: 1, minute: 10, label: '测试时间' }),
  };
  const social = createSocialEventSystem({
    eventBus: bus,
    peopleSystem,
    gameTime,
    getMovementPeople() {
      movementReads += 1;
      return people;
    },
  });

  const first = social.ingest({
    id: 'event-1',
    kind: 'resourceDistributed',
    actorId: 'p1',
    item: 'berries',
    ruleId: 'equal',
    ruleLabel: '均分',
    severity: 2,
  });

  assert.deepEqual(first.witnesses, ['p2']);
  assert.deepEqual(first.heardBy, []);
  assert.equal(movementReads, 1);
  assert.equal(fullPersonReads, 1);
  assert.equal(memoryWrites, 1);
  assert.equal(memories.get('p2')[0].details.eventId, 'event-1');

  social.ingest({
    id: 'event-1',
    kind: 'resourceDistributed',
    actorId: 'p1',
    item: 'berries',
    ruleId: 'equal',
    ruleLabel: '均分',
    severity: 2,
  });

  assert.equal(movementReads, 2);
  assert.equal(fullPersonReads, 1);
  assert.equal(memoryWrites, 1);
  assert.equal(social.getDiagnostics().memoryCacheSeeds, 1);
  social.stop();
});

test('人物存档加载后清空事件 ID 缓存并从真实记忆重新建立', () => {
  const bus = createBus();
  const people = [runtimePerson('p1', '阿一', 0, 0), runtimePerson('p2', '阿二', 1, 0)];
  const existing = [{ id: 'm1', details: { eventId: 'event-loaded' } }];
  let reads = 0;
  let writes = 0;
  const peopleSystem = {
    getAliveRuntime: () => people,
    getRuntime: (id) => people.find((person) => person.id === id) ?? null,
    get(id) {
      reads += 1;
      const person = people.find((entry) => entry.id === id);
      return person ? { ...person, memories: { personal: structuredClone(existing) } } : null;
    },
    addPersonalMemory() {
      writes += 1;
      return null;
    },
    adjustRelation() {},
  };
  const gameTime = {
    now: () => ({ tick: 20 }),
    stamp: () => ({ tick: 20, year: 1, day: 1, minute: 20, label: '测试时间' }),
  };
  const social = createSocialEventSystem({ eventBus: bus, peopleSystem, gameTime, getMovementPeople: () => people });

  social.ingest({ id: 'event-loaded', kind: 'resourceDistributed', actorId: 'p1', severity: 2 });
  assert.equal(reads, 1);
  assert.equal(writes, 0);

  bus.emit('people:hydrated', { count: 2 });
  social.ingest({ id: 'event-loaded', kind: 'resourceDistributed', actorId: 'p1', severity: 2 });
  assert.equal(reads, 2);
  assert.equal(writes, 0);
  social.stop();
});
