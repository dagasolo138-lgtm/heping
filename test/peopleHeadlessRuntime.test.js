import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../src/core/events/eventBus.js';
import { createHeadlessEventBus } from '../src/core/events/headlessEventBus.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { createFounders } from '../src/modules/people/createFounders.js';
import { createPeopleSystem } from '../src/modules/people/peopleSystem.js';

function createPeople(eventBus) {
  const gameTime = createGameTime({ year: 1, day: 1, minute: 480 });
  const people = createPeopleSystem({ eventBus, gameTime });
  createFounders(people);
  return people;
}

test('headless 人物运行时视图按 revision 复用', () => {
  const people = createPeople(createHeadlessEventBus());
  const personId = people.list({ sortBy: 'birth' })[0].id;
  const first = people.getRuntime(personId);
  const second = people.getRuntime(personId);

  assert.strictEqual(second, first);
  const diagnostics = people.getRuntimeDiagnostics();
  assert.equal(diagnostics.mode, 'headless');
  assert.ok(diagnostics.hits >= 1);
});

test('headless 选择性更新不会回写旧运行时快照，并可在边界完整校验', () => {
  const people = createPeople(createHeadlessEventBus());
  const personId = people.list({ sortBy: 'birth' })[0].id;
  const before = people.getRuntime(personId);
  const hungerBefore = before.state.hunger;
  const identityBefore = before.identity;

  people.patchState(personId, { hunger: hungerBefore + 5 });
  people.addPersonalMemory(personId, { type: 'test', summary: '测试记忆' });
  const after = people.getRuntime(personId);
  const verification = people.verify();

  assert.notStrictEqual(after, before);
  assert.equal(before.state.hunger, hungerBefore);
  assert.equal(after.state.hunger, hungerBefore + 5);
  assert.strictEqual(after.identity, identityBefore);
  assert.equal(verification.ok, true);
  assert.equal(verification.count, 10);
  assert.ok(verification.deferredValidations >= 2);
});

test('headless 结构共享追加不会修改已导出的历史快照', () => {
  const people = createPeople(createHeadlessEventBus());
  const personId = people.list({ sortBy: 'birth' })[0].id;

  people.addPersonalMemory(personId, { type: 'first', summary: '第一条记忆' });
  const before = people.exportState();
  const beforePerson = before.people.find((person) => person.id === personId);
  const beforePersonal = structuredClone(beforePerson.memories.personal);
  const beforeRecent = [...beforePerson.memories.recent];

  people.addEncounterMemory(personId, { type: 'encounter', summary: '第二条记忆' });
  people.addLifeEvent(personId, { type: 'milestone', summary: '第一条生命事件' });
  const after = people.exportState();
  const afterPerson = after.people.find((person) => person.id === personId);

  assert.deepEqual(beforePerson.memories.personal, beforePersonal);
  assert.deepEqual(beforePerson.memories.recent, beforeRecent);
  assert.equal(beforePerson.memories.personal.length, 1);
  assert.equal(beforePerson.memories.lifeEvents.length, 0);
  assert.equal(afterPerson.memories.personal.length, 2);
  assert.equal(afterPerson.memories.lifeEvents.length, 1);
  assert.equal(afterPerson.memories.recent.length, 3);
  assert.ok(people.getRuntimeDiagnostics().structurallySharedMemoryAppends >= 3);
  assert.equal(people.verify().ok, true);
});

test('浏览器安全模式继续返回隔离副本与即时校验', () => {
  const people = createPeople(createEventBus());
  const personId = people.list({ sortBy: 'birth' })[0].id;
  const first = people.getRuntime(personId);
  const second = people.getRuntime(personId);

  assert.notStrictEqual(second, first);
  assert.equal(people.getRuntimeDiagnostics().mode, 'safe');
  assert.equal(people.getRuntimeDiagnostics().deferredValidations, 0);
  assert.equal(people.getRuntimeDiagnostics().structurallySharedMemoryAppends, 0);
  assert.equal(people.verify().ok, true);
});
