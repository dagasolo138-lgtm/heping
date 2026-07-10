import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_INTERRUPTION_POLICY } from '../src/modules/persistence/actionRuntimeSnapshot.js';
import { createWorldSaveSystem } from '../src/modules/persistence/worldSaveSystem.js';

function copy(value) { return structuredClone(value); }

function createStateSystem(initial, extra = {}) {
  let state = copy(initial);
  return {
    exportState: () => copy(state),
    importState(next) { state = copy(next); return copy(state); },
    read: () => copy(state),
    ...extra,
  };
}

test('越界运行时坐标在停止模拟和修改世界之前被拒绝', () => {
  const eventBus = { emit() {} };
  const gameTime = createStateSystem({ minute: 480 }, {
    stamp: () => ({ year: 1, day: 1, minute: 480, label: '第 1 日 08:00' }),
  });
  const peopleSystem = createStateSystem({ people: ['原人物'] });
  const mapSystem = createStateSystem({
    regionId: 'starting-valley',
    seed: 7,
    geometry: { width: 160, height: 120 },
  });
  mapSystem.get = () => mapSystem.read();
  const campStore = createStateSystem({ label: '原营地' });
  campStore.get = () => campStore.read();
  const buildingSystem = createStateSystem({ sites: [] });
  const fireSystem = createStateSystem({ fuel: 4 });
  const calls = { stop: 0, start: 0, reset: 0 };
  const runtime = {
    actionSystem: {
      isRunning: () => true,
      stop() { calls.stop += 1; },
      start() { calls.start += 1; },
      resetRuntimeAgents() { calls.reset += 1; },
      getFoodDistributionSystem: () => null,
    },
    mapView: { setMap() {}, redraw() {} },
  };
  const saves = createWorldSaveSystem({
    eventBus,
    gameTime,
    peopleSystem,
    mapSystem,
    campStore,
    buildingSystem,
    fireSystem,
    getRuntime: () => runtime,
  });

  const beforePeople = peopleSystem.read();
  const snapshot = saves.exportSnapshot();
  snapshot.systems.actionRuntime = {
    schemaVersion: 1,
    interruptionPolicy: ACTION_INTERRUPTION_POLICY,
    exportedAt: null,
    agents: [{ personId: 'person-1', x: 999, y: 12, interruptedTask: null }],
  };

  assert.throws(() => saves.importSnapshot(snapshot), /行动运行时坐标越界/);
  assert.deepEqual(peopleSystem.read(), beforePeople);
  assert.deepEqual(calls, { stop: 0, start: 0, reset: 0 });
});
