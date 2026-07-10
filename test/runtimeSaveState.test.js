import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorldSaveSystem } from '../src/modules/persistence/worldSaveSystem.js';

function copy(value) {
  return structuredClone(value);
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

function createPeopleSystem(initialPeople) {
  let people = copy(initialPeople);
  function indexOf(id) { return people.findIndex((person) => person.id === id); }
  function mutate(id, mutator) {
    const index = indexOf(id);
    if (index === -1) throw new Error(`找不到人物：${id}`);
    const next = copy(people[index]);
    mutator(next);
    people[index] = next;
    return copy(next);
  }
  return {
    exportState: () => ({ schemaVersion: 3, exportedAt: { day: 1 }, people: copy(people) }),
    importState(snapshot) { people = copy(snapshot.people); },
    getAlive: () => copy(people.filter((person) => person.identity.alive)),
    get: (id) => copy(people.find((person) => person.id === id) ?? null),
    setLocation: (id, patch) => mutate(id, (person) => { person.location = { ...person.location, ...patch }; }),
    setActivity: (id, patch) => mutate(id, (person) => { person.activity = { ...person.activity, ...copy(patch) }; }),
    removeStatusTag: (id, tag) => mutate(id, (person) => {
      person.state.statusTags = person.state.statusTags.filter((item) => item !== tag);
    }),
    read: () => copy(people),
  };
}

function createBuildingSystem() {
  let state = {
    schemaVersion: 1,
    buildings: [{
      id: 'site-1',
      status: 'planned',
      materials: {
        required: { wood: 12 },
        delivered: { wood: 0 },
        reservations: [{ id: 'reservation-live', itemId: 'wood', amount: 3, state: 'carried' }],
      },
    }],
  };
  return {
    exportState() {
      const snapshot = copy(state);
      snapshot.buildings.forEach((building) => { building.materials.reservations = []; });
      return snapshot;
    },
    importState(snapshot) { state = copy(snapshot); },
    createCheckpoint: () => copy(state),
    restoreCheckpoint(snapshot) { state = copy(snapshot); },
    read: () => copy(state),
  };
}

function person(id, location, { inventory = {}, tags = [], activity = null } = {}) {
  return {
    id,
    identity: { name: id, alive: true },
    location: { tileX: location.x, tileY: location.y },
    inventory: { items: { wood: 0, berries: 0, millet: 0, water: 0, ...inventory } },
    state: { statusTags: [...tags] },
    activity: {
      status: activity ? 'moving' : 'idle',
      current: activity,
      lastCompleted: null,
      completedCount: 0,
    },
  };
}

function createFixture() {
  const events = [];
  const eventBus = { emit: (name, payload) => events.push({ name, payload: copy(payload) }) };
  const gameTime = createStateSystem({ schemaVersion: 1, year: 1, day: 1, minute: 480 }, {
    stamp() {
      const current = gameTime.read();
      return { year: current.year, day: current.day, minute: current.minute, label: `第 ${current.day} 日` };
    },
  });
  const peopleSystem = createPeopleSystem([
    person('carrier', { x: 2, y: 3 }, {
      inventory: { wood: 3 },
      activity: { id: 'deliver-1', type: 'deliverMaterials', label: '运送建材', phase: '前往工地', destination: { x: 9, y: 9 } },
    }),
    person('sleeper', { x: 4, y: 4 }, {
      tags: ['sleeping', 'sheltered'],
      activity: { id: 'sleep-1', type: 'sleep', label: '睡眠', phase: '前往住所', destination: { x: 6, y: 6 } },
    }),
  ]);
  const mapState = {
    schemaVersion: 1,
    regionId: 'starting-valley',
    seed: 7,
    geometry: { width: 20, height: 20 },
  };
  const mapSystem = createStateSystem(mapState, {
    get: () => mapSystem.read(),
    getSpawnPoint: () => ({ x: 1, y: 1 }),
    isWalkable: (x, y) => Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < 20 && y < 20,
  });
  const campStore = createStateSystem({ schemaVersion: 1, camps: [{ id: 'starting-camp', label: '起始营地' }] }, {
    get: () => ({ id: 'starting-camp', label: '起始营地' }),
  });
  const buildingSystem = createBuildingSystem();
  const fireSystem = createStateSystem({ schemaVersion: 1, fuel: 4 });
  let chronicleState = { schemaVersion: 1, marker: 'current' };
  const chronicleSystem = {
    exportState: () => copy(chronicleState),
    importState(snapshot) {
      if (snapshot?.fail) throw new Error('史书模拟导入失败');
      chronicleState = copy(snapshot);
    },
  };

  const runtimeCalls = { stop: 0, start: 0, reset: 0, setMap: 0, redraw: 0 };
  let running = true;
  let livePeople = [
    person('carrier', { x: 7.375, y: 8.625 }, {
      inventory: { wood: 3 },
      activity: { id: 'deliver-1', type: 'deliverMaterials', label: '运送建材', phase: '送往工地', destination: { x: 9, y: 9 } },
    }),
    person('sleeper', { x: 5.25, y: 5.75 }, {
      tags: ['sleeping', 'sheltered'],
      activity: { id: 'sleep-1', type: 'sleep', label: '睡眠', phase: '前往住所', destination: { x: 6, y: 6 } },
    }),
  ];
  const runtime = {
    actionSystem: {
      getRenderPeople: () => copy(livePeople),
      getFoodDistributionSystem: () => null,
      isRunning: () => running,
      stop() { runtimeCalls.stop += 1; running = false; },
      start() { runtimeCalls.start += 1; running = true; },
      resetRuntimeAgents() {
        runtimeCalls.reset += 1;
        livePeople = peopleSystem.read();
      },
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
    chronicleSystem,
    getRuntime: () => runtime,
  });

  return {
    buildingSystem,
    events,
    peopleSystem,
    runtime,
    runtimeCalls,
    setLivePeople(next) { livePeople = copy(next); },
    worldSave,
  };
}

test('存档写入实时小数坐标，并把进行中任务标记为取消后重规划', () => {
  const fixture = createFixture();
  const snapshot = fixture.worldSave.exportSnapshot();
  const runtimeCarrier = snapshot.systems.actionRuntime.agents.find((entry) => entry.personId === 'carrier');
  const savedCarrier = snapshot.systems.people.people.find((entry) => entry.id === 'carrier');
  const savedSleeper = snapshot.systems.people.people.find((entry) => entry.id === 'sleeper');

  assert.equal(snapshot.systems.actionRuntime.policy, 'cancel-and-replan');
  assert.equal(runtimeCarrier.x, 7.375);
  assert.equal(runtimeCarrier.y, 8.625);
  assert.equal(runtimeCarrier.interruptedTask.type, 'deliverMaterials');
  assert.equal(savedCarrier.location.tileX, 7.375);
  assert.equal(savedCarrier.location.tileY, 8.625);
  assert.equal(savedCarrier.activity.status, 'idle');
  assert.equal(savedCarrier.activity.current, null);
  assert.equal(savedCarrier.inventory.items.wood, 3);
  assert.deepEqual(snapshot.systems.buildings.buildings[0].materials.reservations, []);
  assert.equal(savedSleeper.state.statusTags.includes('sleeping'), false);
  assert.equal(savedSleeper.state.statusTags.includes('sheltered'), false);
});

test('成功读档恢复精确位置、清空任务状态并保留已领材料', () => {
  const fixture = createFixture();
  const snapshot = fixture.worldSave.exportSnapshot();

  fixture.worldSave.importSnapshot(snapshot);

  const carrier = fixture.peopleSystem.get('carrier');
  const sleeper = fixture.peopleSystem.get('sleeper');
  assert.equal(carrier.location.tileX, 7.375);
  assert.equal(carrier.location.tileY, 8.625);
  assert.equal(carrier.inventory.items.wood, 3);
  assert.equal(carrier.activity.status, 'idle');
  assert.equal(carrier.activity.current, null);
  assert.equal(sleeper.state.statusTags.includes('sleeping'), false);
  assert.equal(sleeper.state.statusTags.includes('sheltered'), false);
  assert.equal(fixture.runtimeCalls.reset, 1);
  assert.equal(fixture.runtimeCalls.stop, 1);
  assert.equal(fixture.runtimeCalls.start, 1);
  assert.equal(fixture.events.some((entry) => entry.name === 'actions:interrupted-by-load'), true);
});

test('旧存档缺少行动运行时字段时从人物坐标恢复并安全清空活动', () => {
  const fixture = createFixture();
  const snapshot = fixture.worldSave.exportSnapshot();
  delete snapshot.systems.actionRuntime;
  const carrier = snapshot.systems.people.people.find((entry) => entry.id === 'carrier');
  carrier.location = { tileX: 10, tileY: 11 };
  carrier.activity = { ...carrier.activity, status: 'moving', current: { type: 'haulToCamp' } };

  fixture.worldSave.importSnapshot(snapshot);

  const restored = fixture.peopleSystem.get('carrier');
  assert.equal(restored.location.tileX, 10);
  assert.equal(restored.location.tileY, 11);
  assert.equal(restored.activity.status, 'idle');
  assert.equal(restored.activity.current, null);
  assert.equal(fixture.runtimeCalls.reset, 1);
});

test('读取后段失败时保留原运行任务，并恢复工地瞬时预留', () => {
  const fixture = createFixture();
  const target = fixture.worldSave.exportSnapshot();
  target.systems.chronicles = { fail: true };
  const beforePeople = fixture.peopleSystem.read();
  const beforeBuilding = fixture.buildingSystem.read();

  assert.throws(
    () => fixture.worldSave.importSnapshot(target),
    /已恢复读取前状态：史书模拟导入失败/,
  );

  assert.deepEqual(fixture.peopleSystem.read(), beforePeople);
  assert.deepEqual(fixture.buildingSystem.read(), beforeBuilding);
  assert.equal(fixture.runtimeCalls.reset, 0);
  assert.equal(fixture.runtimeCalls.stop, 1);
  assert.equal(fixture.runtimeCalls.start, 1);
  assert.equal(fixture.events.at(-1).name, 'save:load-failed');
  assert.equal(fixture.events.at(-1).payload.rollbackSucceeded, true);
});
