import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorldSaveSystem } from '../src/modules/persistence/worldSaveSystem.js';

function copy(value) { return structuredClone(value); }

function createStateSystem(initial, { failWhen = () => false, extra = {} } = {}) {
  let state = copy(initial);
  return {
    exportState: () => copy(state),
    importState(next) {
      if (failWhen(next)) throw new Error('模拟导入失败');
      state = copy(next);
      return copy(state);
    },
    read: () => copy(state),
    ...extra,
  };
}

function createFixture() {
  const events = [];
  const eventBus = { emit: (name, payload) => events.push({ name, payload }) };
  const gameTime = createStateSystem({ minute: 480 }, {
    extra: { stamp() { return { year: 1, day: 1, minute: gameTime.read().minute, label: `第 1 日 ${gameTime.read().minute}` }; } },
  });
  const peopleSystem = createStateSystem({ people: ['原人物'] });
  const mapSystem = createStateSystem({ regionId: 'starting-valley', seed: 7 }, {
    extra: { get: () => mapSystem.read() },
  });
  const campStore = createStateSystem({ label: '原营地', items: { wood: 3 } }, {
    extra: { get: () => campStore.read() },
  });
  const buildingSystem = createStateSystem({ sites: ['原工地'] }, {
    failWhen: (next) => next?.broken === true,
  });
  const fireSystem = createStateSystem({ fuel: 4 });
  const runtimeCalls = { stop: 0, start: 0, reset: 0, setMap: 0, redraw: 0 };
  let running = true;
  const runtime = {
    actionSystem: {
      isRunning: () => running,
      stop() { runtimeCalls.stop += 1; running = false; },
      start() { runtimeCalls.start += 1; running = true; },
      resetRuntimeAgents() { runtimeCalls.reset += 1; },
      getFoodDistributionSystem: () => null,
    },
    mapView: {
      setMap() { runtimeCalls.setMap += 1; },
      redraw() { runtimeCalls.redraw += 1; },
    },
  };
  const worldSave = createWorldSaveSystem({
    eventBus,
    gameTime,
    peopleSystem,
    mapSystem,
    campStore,
    buildingSystem,
    fireSystem,
    getRuntime: () => runtime,
  });
  return { events, runtimeCalls, worldSave, systems: { gameTime, peopleSystem, mapSystem, campStore, buildingSystem, fireSystem } };
}

test('损坏的子系统存档会回滚全部已导入状态并恢复模拟循环', () => {
  const fixture = createFixture();
  const before = fixture.worldSave.exportSnapshot();
  const damaged = copy(before);
  damaged.systems.gameTime = { minute: 900 };
  damaged.systems.people = { people: ['错误人物'] };
  damaged.systems.map = { regionId: 'wrong-valley', seed: 99 };
  damaged.systems.camp = { label: '错误营地', items: { wood: 999 } };
  damaged.systems.buildings = { broken: true };

  assert.throws(
    () => fixture.worldSave.importSnapshot(damaged),
    /已恢复读取前状态：模拟导入失败/,
  );

  assert.deepEqual(fixture.systems.gameTime.read(), before.systems.gameTime);
  assert.deepEqual(fixture.systems.peopleSystem.read(), before.systems.people);
  assert.deepEqual(fixture.systems.mapSystem.read(), before.systems.map);
  assert.deepEqual(fixture.systems.campStore.read(), before.systems.camp);
  assert.deepEqual(fixture.systems.buildingSystem.read(), before.systems.buildings);
  assert.equal(fixture.runtimeCalls.stop, 1);
  assert.equal(fixture.runtimeCalls.start, 1);
  assert.equal(fixture.runtimeCalls.reset, 1);
  assert.equal(fixture.events.at(-1).name, 'save:load-failed');
  assert.equal(fixture.events.at(-1).payload.rollbackSucceeded, true);
});

test('顶层格式无效时在停止模拟之前拒绝读取', () => {
  const fixture = createFixture();
  assert.throws(
    () => fixture.worldSave.importSnapshot({ schemaVersion: 1 }),
    /世界存档缺少系统状态/,
  );
  assert.equal(fixture.runtimeCalls.stop, 0);
  assert.equal(fixture.runtimeCalls.start, 0);
  assert.equal(fixture.events.length, 0);
});

test('缺少目标导入器时在停止模拟之前拒绝读取', () => {
  const fixture = createFixture();
  const snapshot = fixture.worldSave.exportSnapshot();
  snapshot.systems.ecology = { queue: [] };

  assert.throws(
    () => fixture.worldSave.importSnapshot(snapshot),
    /生态系统不支持读取存档/,
  );
  assert.equal(fixture.runtimeCalls.stop, 0);
  assert.equal(fixture.runtimeCalls.start, 0);
});

test('成功读取后只重建一次运行时并恢复原运行状态', () => {
  const fixture = createFixture();
  const snapshot = fixture.worldSave.exportSnapshot();
  snapshot.systems.people = { people: ['新人物'] };

  fixture.worldSave.importSnapshot(snapshot);

  assert.deepEqual(fixture.systems.peopleSystem.read(), { people: ['新人物'] });
  assert.equal(fixture.runtimeCalls.stop, 1);
  assert.equal(fixture.runtimeCalls.start, 1);
  assert.equal(fixture.runtimeCalls.reset, 1);
  assert.equal(fixture.runtimeCalls.setMap, 1);
  assert.equal(fixture.runtimeCalls.redraw, 1);
  assert.equal(fixture.events.at(-1).name, 'save:loaded');
});
