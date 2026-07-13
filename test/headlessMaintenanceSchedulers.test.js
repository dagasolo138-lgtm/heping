import test from 'node:test';
import assert from 'node:assert/strict';

import { createGameTime } from '../src/core/time/gameTime.js';
import { createResourceRenewalSystem } from '../src/modules/ecology/resourceRenewalSystem.js';
import { createFoodStorageSystem } from '../src/modules/storage/foodStorageSystem.js';

function createHeadlessBus() {
  const listeners = new Map();
  const events = [];
  return {
    on(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, []);
      listeners.get(eventName).push(listener);
      return () => {};
    },
    emit(eventName, payload) {
      events.push({ eventName, payload });
      (listeners.get(eventName) ?? []).forEach((listener) => listener(payload));
      return true;
    },
    getDiagnostics() {
      return { mode: 'headless' };
    },
    events,
  };
}

test('headless 食物腐败在30分钟边界前不构造摘要', () => {
  const eventBus = createHeadlessBus();
  const gameTime = createGameTime({ year: 1, day: 1, minute: 0, runtimeMode: 'headless' });
  const calls = { storage: 0, food: 0, age: 0 };
  const campStore = {
    getStorage() {
      calls.storage += 1;
      return { protection: 0, available: 20 };
    },
    getFoodSummary() {
      calls.food += 1;
      return { berries: 2, millet: 0 };
    },
    ageFood(_campId, input) {
      calls.age += 1;
      assert.equal(input.elapsedMinutes, 30);
      return { changed: false, spoiled: {} };
    },
  };
  const storage = createFoodStorageSystem({ eventBus, gameTime, campStore });
  const weather = Object.freeze({ id: 'clear' });

  for (let minute = 1; minute < 30; minute += 1) {
    gameTime.advanceMinutes(1);
    assert.equal(storage.sync(weather), null);
  }
  assert.deepEqual(calls, { storage: 0, food: 0, age: 0 });

  gameTime.advanceMinutes(1);
  const result = storage.sync(weather);
  assert.ok(result);
  assert.equal(calls.age, 1);
  assert.equal(storage.getDiagnostics().processedSyncs, 1);
  assert.equal(storage.getDiagnostics().skippedSyncs, 29);
});

test('headless 生态系统只在最近资源到期 tick 扫描', () => {
  const eventBus = createHeadlessBus();
  const gameTime = createGameTime({ year: 1, day: 1, minute: 0, runtimeMode: 'headless' });
  const calls = { occupied: 0, removed: 0, added: 0 };
  const mapSystem = {
    addFeature() {
      calls.added += 1;
    },
    removeFeature() {
      calls.removed += 1;
    },
    getFeaturesAt() {
      calls.occupied += 1;
      return [];
    },
  };
  const buildingSystem = { list: () => [] };
  const previousRuntime = globalThis.shengling;
  globalThis.shengling = { seasonSystem: { get: () => ({ id: 'spring' }) } };

  try {
    const ecology = createResourceRenewalSystem({ eventBus, gameTime, mapSystem, buildingSystem });
    ecology.registerDepletion({ id: 'berry-1', kind: 'berryBush', x: 3, y: 4, blocking: false });
    assert.equal(ecology.getDiagnostics().nextDueTick, 1440);

    for (let tick = 1; tick < 1440; tick += 1) {
      gameTime.advanceMinutes(1);
      assert.equal(ecology.sync(), null);
    }
    assert.equal(calls.occupied, 0);
    assert.equal(calls.removed, 0);

    gameTime.advanceMinutes(1);
    const result = ecology.sync();
    assert.deepEqual(result, { total: 0, byKind: { tree: 0, berryBush: 0 } });
    assert.equal(calls.occupied, 1);
    assert.equal(calls.removed, 1);
    assert.equal(ecology.getDiagnostics().processedSyncs, 1);
  } finally {
    globalThis.shengling = previousRuntime;
  }
});
