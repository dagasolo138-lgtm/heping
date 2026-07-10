import test from 'node:test';
import assert from 'node:assert/strict';

import { createBuildingSystem } from '../src/modules/buildings/buildingSystem.js';
import { ACTION_INTERRUPTION_POLICY, restoreActionRuntimeSnapshot } from '../src/modules/persistence/actionRuntimeSnapshot.js';
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

function createPeopleSystem(initialPeople) {
  let people = copy(initialPeople);
  return {
    getAlive: () => copy(people.filter((person) => person.identity.alive !== false)),
    get: (id) => copy(people.find((person) => person.id === id) ?? null),
    setLocation(id, patch) {
      const person = people.find((entry) => entry.id === id);
      person.location = { ...person.location, ...copy(patch) };
    },
    setActivity(id, patch) {
      const person = people.find((entry) => entry.id === id);
      person.activity = { ...person.activity, ...copy(patch) };
    },
    removeStatusTag(id, tag) {
      const person = people.find((entry) => entry.id === id);
      person.state.statusTags = person.state.statusTags.filter((entry) => entry !== tag);
    },
    exportState: () => ({ schemaVersion: 1, people: copy(people) }),
    importState(snapshot) { people = copy(snapshot.people); },
  };
}

test('取消被中断睡眠时清理 sleeping、sheltered 与 exposed 临时标签', () => {
  const peopleSystem = createPeopleSystem([{
    id: 'sleeper',
    identity: { alive: true, name: '甲' },
    location: { tileX: 4, tileY: 4 },
    activity: { status: 'resting', current: { type: 'sleep' } },
    state: { statusTags: ['sleeping', 'sheltered', 'exposed', 'chilled'] },
  }]);

  restoreActionRuntimeSnapshot({
    snapshot: {
      schemaVersion: 1,
      interruptionPolicy: ACTION_INTERRUPTION_POLICY,
      agents: [{
        personId: 'sleeper',
        x: 5.25,
        y: 5.75,
        interruptedTask: { id: 'sleep-1', type: 'sleep', label: '睡眠', phase: '前往住所' },
      }],
    },
    peopleSystem,
    mapSystem: { get: () => ({ geometry: { width: 20, height: 20 } }) },
  });

  const person = peopleSystem.get('sleeper');
  assert.deepEqual(person.location, { tileX: 5.25, tileY: 5.75 });
  assert.equal(person.activity.status, 'idle');
  assert.equal(person.activity.current, null);
  assert.deepEqual(person.state.statusTags, ['chilled']);
});

test('读取后段失败时不重建行动代理，并恢复工地瞬时预留', () => {
  const events = [];
  const eventBus = { emit: (name, payload) => events.push({ name, payload }) };
  const gameTime = createStateSystem({ schemaVersion: 1, minute: 480 }, {
    stamp: () => ({ year: 1, day: 1, minute: 480, label: '第 1 日 08:00' }),
  });
  const peopleSystem = createPeopleSystem([]);
  const mapSystem = createStateSystem({
    schemaVersion: 1,
    regionId: 'starting-valley',
    seed: 7,
    geometry: { width: 20, height: 20 },
  }, { get() { return this.read(); } });
  const campStore = createStateSystem({ schemaVersion: 1, id: 'starting-camp', label: '起始营地' }, {
    get() { return this.read(); },
  });
  const buildingSystem = createBuildingSystem({ eventBus, gameTime });
  const site = buildingSystem.startConstruction({ typeId: 'communalShelter', anchor: { x: 4, y: 4 } });
  const reservation = buildingSystem.reserveMaterial(site.id, 'wood', 3);
  buildingSystem.beginDelivery(site.id, reservation.id);
  const fireSystem = createStateSystem({ schemaVersion: 1, fuel: 4 });
  let chronicle = { schemaVersion: 1, marker: 'original' };
  const chronicleSystem = {
    exportState: () => copy(chronicle),
    importState(snapshot) {
      if (snapshot?.fail) throw new Error('史书模拟导入失败');
      chronicle = copy(snapshot);
    },
  };
  const runtimeCalls = { stop: 0, start: 0, reset: 0, setMap: 0, redraw: 0 };
  let running = true;
  const runtime = {
    actionSystem: {
      isRunning: () => running,
      stop() { running = false; runtimeCalls.stop += 1; },
      start() { running = true; runtimeCalls.start += 1; },
      resetRuntimeAgents() { runtimeCalls.reset += 1; },
      getFoodDistributionSystem: () => null,
    },
    mapView: {
      setMap() { runtimeCalls.setMap += 1; },
      redraw() { runtimeCalls.redraw += 1; },
    },
  };
  const saves = createWorldSaveSystem({
    eventBus,
    gameTime,
    peopleSystem,
    mapSystem,
    campStore,
    buildingSystem,
    fireSystem,
    chronicleSystem,
    getRuntime: () => runtime,
  });
  const target = saves.exportSnapshot();
  target.systems.chronicles = { fail: true };

  assert.throws(() => saves.importSnapshot(target), /已恢复读取前状态：史书模拟导入失败/);

  const restored = buildingSystem.get(site.id).materials.reservations;
  assert.equal(restored.length, 1);
  assert.equal(restored[0].id, reservation.id);
  assert.equal(restored[0].state, 'carried');
  assert.equal(runtimeCalls.reset, 0);
  assert.equal(runtimeCalls.stop, 1);
  assert.equal(runtimeCalls.start, 1);
  assert.ok(runtimeCalls.setMap >= 1);
  assert.ok(runtimeCalls.redraw >= 1);
  assert.equal(events.at(-1).name, 'save:load-failed');
  assert.equal(events.at(-1).payload.rollbackSucceeded, true);
});
