import test from 'node:test';
import assert from 'node:assert/strict';

import {
  ACTION_INTERRUPTION_POLICY,
  exportActionRuntimeSnapshot,
  restoreActionRuntimeSnapshot,
  validateActionRuntimeSnapshot,
} from '../src/modules/persistence/actionRuntimeSnapshot.js';
import { createWorldSaveSystem } from '../src/modules/persistence/worldSaveSystem.js';

function copy(value) { return structuredClone(value); }

function createPeopleSystem(initialPeople) {
  let people = copy(initialPeople);
  return {
    getAlive: () => copy(people.filter((person) => person.identity.alive !== false)),
    get: (id) => copy(people.find((person) => person.id === id) ?? null),
    setLocation(id, patch) {
      const person = people.find((entry) => entry.id === id);
      person.location = { ...person.location, ...copy(patch) };
      return copy(person);
    },
    setActivity(id, patch) {
      const person = people.find((entry) => entry.id === id);
      person.activity = { ...person.activity, ...copy(patch) };
      return copy(person);
    },
    removeStatusTag(id, tag) {
      const person = people.find((entry) => entry.id === id);
      person.state.statusTags = person.state.statusTags.filter((entry) => entry !== tag);
      return copy(person);
    },
    exportState: () => ({ schemaVersion: 1, people: copy(people) }),
    importState(snapshot) { people = copy(snapshot.people); },
  };
}

function createStateSystem(initial, extra = {}) {
  let state = copy(initial);
  return {
    exportState: () => copy(state),
    importState(next) { state = copy(next); return copy(state); },
    read: () => copy(state),
    ...extra,
  };
}

function createPerson(overrides = {}) {
  return {
    id: 'person-1',
    identity: { alive: true, name: '甲' },
    location: { tileX: 10, tileY: 12 },
    activity: {
      status: 'moving',
      current: { id: 'task-1', type: 'deliverMaterials', label: '运送木材', phase: '前往目标' },
      lastCompleted: null,
      completedCount: 0,
    },
    inventory: { items: { wood: 3 } },
    state: { statusTags: ['sleeping', 'sheltered'] },
    ...copy(overrides),
  };
}

test('导出运行时快照使用人物的实时浮点坐标', () => {
  const peopleSystem = createPeopleSystem([createPerson()]);
  const actionSystem = {
    getRenderPeople: () => [{
      ...createPerson(),
      location: { tileX: 25.375, tileY: 47.625 },
    }],
  };

  const snapshot = exportActionRuntimeSnapshot({
    actionSystem,
    peopleSystem,
    exportedAt: { year: 1, day: 3, minute: 612 },
  });

  assert.equal(snapshot.interruptionPolicy, ACTION_INTERRUPTION_POLICY);
  assert.deepEqual(snapshot.agents[0], {
    personId: 'person-1',
    x: 25.375,
    y: 47.625,
    interruptedTask: { id: 'task-1', type: 'deliverMaterials', label: '运送木材', phase: '前往目标' },
  });
});

test('读档恢复精确坐标并取消任务，人物背包与长期标签保持', () => {
  const peopleSystem = createPeopleSystem([createPerson()]);
  const mapSystem = { get: () => ({ geometry: { width: 160, height: 120 } }) };
  const snapshot = {
    schemaVersion: 1,
    interruptionPolicy: ACTION_INTERRUPTION_POLICY,
    exportedAt: null,
    agents: [{
      personId: 'person-1',
      x: 25.375,
      y: 47.625,
      interruptedTask: { id: 'task-1', type: 'deliverMaterials', label: '运送木材', phase: '前往目标' },
    }],
  };

  const result = restoreActionRuntimeSnapshot({ snapshot, peopleSystem, mapSystem });
  const person = peopleSystem.get('person-1');

  assert.deepEqual(person.location, { tileX: 25.375, tileY: 47.625 });
  assert.equal(person.activity.status, 'idle');
  assert.equal(person.activity.current, null);
  assert.equal(person.inventory.items.wood, 3);
  assert.deepEqual(person.state.statusTags, ['sheltered']);
  assert.deepEqual(result, {
    interruptionPolicy: ACTION_INTERRUPTION_POLICY,
    restoredPositions: 1,
    interruptedTasks: 1,
    usedLegacyPositions: false,
  });
});

test('旧存档缺少运行时快照时沿用持久坐标并安全清空旧活动', () => {
  const peopleSystem = createPeopleSystem([createPerson()]);
  const result = restoreActionRuntimeSnapshot({ snapshot: null, peopleSystem, mapSystem: null });
  const person = peopleSystem.get('person-1');

  assert.deepEqual(person.location, { tileX: 10, tileY: 12 });
  assert.equal(person.activity.status, 'idle');
  assert.equal(person.activity.current, null);
  assert.deepEqual(person.state.statusTags, ['sheltered']);
  assert.equal(result.usedLegacyPositions, true);
  assert.equal(result.interruptedTasks, 1);
});

test('重复人物和越界坐标会拒绝读取', () => {
  assert.throws(() => validateActionRuntimeSnapshot({
    schemaVersion: 1,
    interruptionPolicy: ACTION_INTERRUPTION_POLICY,
    agents: [
      { personId: 'person-1', x: 1, y: 1, interruptedTask: null },
      { personId: 'person-1', x: 2, y: 2, interruptedTask: null },
    ],
  }), /行动运行时人物重复/);

  const peopleSystem = createPeopleSystem([createPerson()]);
  assert.throws(() => restoreActionRuntimeSnapshot({
    snapshot: {
      schemaVersion: 1,
      interruptionPolicy: ACTION_INTERRUPTION_POLICY,
      agents: [{ personId: 'person-1', x: 999, y: 2, interruptedTask: null }],
    },
    peopleSystem,
    mapSystem: { get: () => ({ geometry: { width: 160, height: 120 } }) },
  }), /行动运行时坐标越界/);
  assert.deepEqual(peopleSystem.get('person-1').location, { tileX: 10, tileY: 12 });
});

test('世界存档读入后以精确坐标重建无任务代理', () => {
  const events = [];
  const eventBus = { emit: (name, payload) => events.push({ name, payload }) };
  const gameTime = createStateSystem({ minute: 480 }, {
    stamp: () => ({ year: 1, day: 1, minute: 480, label: '第 1 日 08:00' }),
  });
  const peopleSystem = createPeopleSystem([createPerson()]);
  const mapSystem = createStateSystem({
    regionId: 'starting-valley',
    seed: 7,
    geometry: { width: 160, height: 120 },
  }, { get() { return this.read(); } });
  const campStore = createStateSystem({ id: 'starting-camp', label: '起始营地' }, {
    get() { return this.read(); },
  });
  const buildingSystem = createStateSystem({ buildings: [] });
  const fireSystem = createStateSystem({ fuel: 4 });
  const runtimeCalls = { stop: 0, start: 0, reset: [] };
  let running = true;
  const runtime = {
    actionSystem: {
      isRunning: () => running,
      stop() { running = false; runtimeCalls.stop += 1; },
      start() { running = true; runtimeCalls.start += 1; },
      resetRuntimeAgents(options) { runtimeCalls.reset.push(copy(options)); },
      getRenderPeople: () => [{
        ...peopleSystem.get('person-1'),
        location: { tileX: 25.375, tileY: 47.625 },
      }],
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

  const snapshot = saves.exportSnapshot();
  assert.equal(snapshot.systems.actionRuntime.agents[0].x, 25.375);
  snapshot.systems.people.people[0].inventory.items.wood = 5;
  saves.importSnapshot(snapshot);

  const person = peopleSystem.get('person-1');
  assert.deepEqual(person.location, { tileX: 25.375, tileY: 47.625 });
  assert.equal(person.inventory.items.wood, 5);
  assert.equal(person.activity.status, 'idle');
  assert.equal(person.activity.current, null);
  assert.deepEqual(runtimeCalls.reset, [{ clearActivities: false }]);
  assert.equal(runtimeCalls.stop, 1);
  assert.equal(runtimeCalls.start, 1);
  const loaded = events.findLast((event) => event.name === 'save:loaded');
  assert.equal(loaded.payload.actionRuntime.restoredPositions, 1);
  assert.equal(loaded.payload.actionRuntime.interruptedTasks, 1);
});
