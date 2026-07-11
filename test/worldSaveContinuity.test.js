import test from 'node:test';
import assert from 'node:assert/strict';

import { createLongRunAuditWorld } from '../scripts/longRunAuditWorld.js';
import { createWorldSaveSystem } from '../src/modules/persistence/worldSaveSystem.js';

function clone(value) {
  return structuredClone(value);
}

function createStateSystem(initial, extra = {}) {
  let state = clone(initial);
  return {
    exportState: () => clone(state),
    importState(next) {
      state = clone(next);
      return clone(state);
    },
    read: () => clone(state),
    createCheckpoint: () => clone(state),
    restoreCheckpoint(next) {
      state = clone(next);
      return clone(state);
    },
    ...extra,
  };
}

function createPeopleSystem(initialPeople) {
  let people = clone(initialPeople);
  const getMutable = (id) => people.find((person) => person.id === id);
  return {
    getAlive: () => clone(people.filter((person) => person.identity?.alive !== false)),
    get: (id) => clone(getMutable(id) ?? null),
    setLocation(id, patch) {
      const person = getMutable(id);
      person.location = { ...person.location, ...clone(patch) };
      return clone(person);
    },
    setActivity(id, patch) {
      const person = getMutable(id);
      person.activity = { ...person.activity, ...clone(patch) };
      return clone(person);
    },
    removeStatusTag(id, tag) {
      const person = getMutable(id);
      person.state.statusTags = person.state.statusTags.filter((entry) => entry !== tag);
      return clone(person);
    },
    exportState: () => ({ schemaVersion: 1, people: clone(people) }),
    importState(snapshot) {
      people = clone(snapshot.people);
      return clone(people);
    },
  };
}

function createRollbackFixture() {
  const events = [];
  const eventBus = { emit: (name, payload) => events.push({ name, payload: clone(payload) }) };
  const gameTime = createStateSystem({ schemaVersion: 1, year: 1, day: 2, minute: 620, tick: 1580 }, {
    stamp() {
      const state = gameTime.read();
      return { ...state, label: `第 ${state.day} 日 ${state.minute}` };
    },
  });
  const originalPeople = [{
    id: 'person-1',
    identity: { alive: true, name: '甲' },
    location: { tileX: 18.25, tileY: 31.75 },
    activity: {
      status: 'moving',
      current: { id: 'task-1', type: 'deliverMaterials', label: '运送建材', phase: '送往工地' },
      completedCount: 3,
    },
    state: { statusTags: [] },
    inventory: { items: { wood: 4 } },
  }];
  const peopleSystem = createPeopleSystem(originalPeople);
  const mapSystem = createStateSystem({
    schemaVersion: 1,
    regionId: 'starting-valley',
    seed: 17,
    geometry: { width: 160, height: 120 },
  });
  mapSystem.get = () => mapSystem.read();
  const campStore = createStateSystem({ schemaVersion: 1, id: 'starting-camp', label: '起始营地', items: { wood: 3 } });
  campStore.get = () => campStore.read();
  const buildingSystem = createStateSystem({ schemaVersion: 1, buildings: [] });
  const fireSystem = createStateSystem({ schemaVersion: 1, fuel: 4 });

  const originalRuntime = {
    agents: [{
      personId: 'person-1',
      x: 18.25,
      y: 31.75,
      task: {
        id: 'task-1',
        type: 'deliverMaterials',
        label: '运送建材',
        phase: 'moving',
        destination: { x: 40, y: 35 },
        path: [{ x: 19, y: 32 }, { x: 20, y: 32 }],
        pathIndex: 1,
        progress: 0.375,
        data: { stage: 'deliver', carriedAmount: 4, runtimeReservationIds: ['task-1:slot'] },
      },
    }],
    reservations: {
      reservations: [{
        id: 'task-1:slot',
        type: 'task-slot',
        key: 'deliverMaterials',
        taskId: 'task-1',
        ownerId: 'person-1',
        amount: 1,
        metadata: {},
      }],
    },
    logs: [{ id: 'log-1', summary: '原运行时', time: gameTime.stamp() }],
    plannerTimer: 0.5,
    needsTimer: 2.5,
    phaseId: 'day',
    lastError: null,
    lastTickAt: 123456,
    lastGameTime: gameTime.stamp(),
  };
  let runtimeState = clone(originalRuntime);
  let running = true;
  let refreshCalls = 0;
  const calls = { stop: 0, start: 0, reset: 0, capture: 0, restore: 0, redraw: 0 };

  const actionSystem = {
    isRunning: () => running,
    stop() { running = false; calls.stop += 1; },
    start() { running = true; calls.start += 1; },
    getFoodDistributionSystem: () => null,
    getRenderPeople: () => peopleSystem.getAlive().map((person) => ({
      ...person,
      location: {
        ...person.location,
        tileX: runtimeState.agents.find((agent) => agent.personId === person.id)?.x ?? person.location.tileX,
        tileY: runtimeState.agents.find((agent) => agent.personId === person.id)?.y ?? person.location.tileY,
      },
    })),
    createRuntimeCheckpoint() {
      calls.capture += 1;
      return clone(runtimeState);
    },
    resetRuntimeAgents() {
      calls.reset += 1;
      runtimeState = { ...clone(runtimeState), agents: [], reservations: { reservations: [] }, logs: [] };
    },
    restoreRuntimeCheckpoint(snapshot) {
      calls.restore += 1;
      runtimeState = clone(snapshot);
      return clone(runtimeState);
    },
  };
  const runtime = {
    actionSystem,
    mapView: {
      setMap() {
        refreshCalls += 1;
        if (refreshCalls === 1) throw new Error('模拟地图刷新失败');
      },
      redraw() { calls.redraw += 1; },
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
    getRuntime: () => runtime,
  });

  return {
    saves,
    events,
    calls,
    originalPeople,
    originalRuntime,
    readRuntime: () => clone(runtimeState),
    readPeople: () => peopleSystem.getAlive(),
    isRunning: () => running,
  };
}

function createIntegratedSave(world) {
  world.runtime.mapView = { setMap() {}, redraw() {} };
  return createWorldSaveSystem({
    eventBus: world.bus,
    gameTime: world.time,
    peopleSystem: world.people,
    mapSystem: world.map,
    campStore: world.camp,
    campRulesSystem: world.runtime.campRulesSystem,
    buildingSystem: world.buildings,
    fireSystem: world.fire,
    ecologySystem: world.ecology,
    roadSystem: world.roads,
    farmSystem: world.farms,
    foodStorageSystem: world.foodStorage,
    socialEventSystem: world.socialEvents,
    chronicleSystem: world.chronicles,
    getRuntime: () => world.runtime,
  });
}

function comparableSnapshot(snapshot) {
  const result = clone(snapshot);
  if (result.savedAt) delete result.savedAt.realTime;
  return result;
}

test('读档在运行时重建后失败，会恢复原任务路径、代理进度和统一预留', () => {
  const fixture = createRollbackFixture();
  const target = fixture.saves.exportSnapshot();
  target.systems.camp = { ...clone(target.systems.camp), items: { wood: 99 } };

  assert.throws(
    () => fixture.saves.importSnapshot(target),
    /已恢复读取前状态：模拟地图刷新失败/,
  );

  assert.deepEqual(fixture.readRuntime(), fixture.originalRuntime);
  assert.deepEqual(fixture.readPeople(), fixture.originalPeople);
  assert.equal(fixture.isRunning(), true);
  assert.deepEqual(fixture.calls, {
    stop: 1,
    start: 1,
    reset: 1,
    capture: 1,
    restore: 1,
    redraw: 1,
  });
  const failure = fixture.events.findLast((event) => event.name === 'save:load-failed');
  assert.equal(failure.payload.rollbackSucceeded, true);
});

test('行动运行时检查点可精确恢复任务、路径和预留账本', { timeout: 120_000 }, () => {
  const world = createLongRunAuditWorld('v0277-action-runtime-checkpoint');
  try {
    world.actions.advanceTicks(60);
    const before = world.actions.createRuntimeCheckpoint();
    assert.ok(before.agents.some((agent) => agent.task), '检查点应包含至少一个活动任务');
    assert.ok(before.reservations.reservations.length > 0, '检查点应包含活动预留');

    world.actions.resetRuntimeAgents({ clearActivities: false });
    assert.equal(world.reservationLedger.list().length, 0);
    assert.equal(world.actions.createRuntimeCheckpoint().agents.some((agent) => agent.task), false);

    world.actions.restoreRuntimeCheckpoint(before);
    const restored = world.actions.createRuntimeCheckpoint();
    assert.deepEqual(restored, before);
    assert.deepEqual(world.reservationLedger.list(), before.reservations.reservations);
  } finally {
    world.restoreGlobals();
  }
});

test('同一世界快照连续读取两次保持幂等且事实链校验通过', { timeout: 120_000 }, () => {
  const world = createLongRunAuditWorld('v0277-repeated-load');
  try {
    const saves = createIntegratedSave(world);
    world.actions.advanceTicks(180);
    const snapshot = saves.exportSnapshot();
    world.actions.advanceTicks(90);

    saves.importSnapshot(snapshot);
    const first = comparableSnapshot(saves.exportSnapshot());
    saves.importSnapshot(snapshot);
    const second = comparableSnapshot(saves.exportSnapshot());

    assert.deepEqual(second, first);
    assert.equal(world.taskLifecycle.verify().ok, true);
    assert.equal(world.resourceFlow.verify().ok, true);
    assert.equal(world.dailyEconomy.verify().ok, true);
    assert.equal(world.actions.getDiagnostics().lastSimulationError, null);
  } finally {
    world.restoreGlobals();
  }
});

test('旧存档缺少新增经济、工具和运行时字段时可安全读取并重新规划', { timeout: 120_000 }, () => {
  const world = createLongRunAuditWorld('v0277-legacy-save');
  try {
    const saves = createIntegratedSave(world);
    world.actions.advanceTicks(120);
    const legacy = saves.exportSnapshot();
    legacy.appVersion = '0.25.0';
    delete legacy.systems.tools;
    delete legacy.systems.resourceFlow;
    delete legacy.systems.dailyEconomy;
    delete legacy.systems.actionRuntime;

    assert.doesNotThrow(() => saves.importSnapshot(legacy));
    assert.equal(world.tools.list().length, 4);
    assert.equal(world.tools.getAssignments().length, 0);
    assert.equal(world.resourceFlow.getSummary().totalEntries, 0);
    assert.equal(world.people.getAlive().every((person) => person.activity?.current === null), true);
    assert.equal(world.actions.getDiagnostics().reservations.total, 0);
    assert.equal(world.taskLifecycle.verify().ok, true);
    assert.equal(world.resourceFlow.verify().ok, true);
    assert.equal(world.dailyEconomy.verify().ok, true);
  } finally {
    world.restoreGlobals();
  }
});
