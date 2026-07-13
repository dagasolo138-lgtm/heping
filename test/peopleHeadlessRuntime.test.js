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

test('浏览器安全模式继续返回隔离副本与即时校验', () => {
  const people = createPeople(createEventBus());
  const personId = people.list({ sortBy: 'birth' })[0].id;
  const first = people.getRuntime(personId);
  const second = people.getRuntime(personId);

  assert.notStrictEqual(second, first);
  assert.equal(people.getRuntimeDiagnostics().mode, 'safe');
  assert.equal(people.getRuntimeDiagnostics().deferredValidations, 0);
  assert.equal(people.verify().ok, true);
});
