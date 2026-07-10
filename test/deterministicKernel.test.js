import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createEventBus } from '../src/core/events/eventBus.js';
import { resetIdSequence } from '../src/core/ids/createId.js';
import { createFixedStepClock } from '../src/core/simulation/fixedStepClock.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { createUiRenderScheduler } from '../src/core/ui/uiRenderScheduler.js';
import { createActionSystem } from '../src/modules/actions/actionSystem.js';
import { createReservationLedger } from '../src/modules/actions/reservationLedger.js';
import { createBuildingSystem } from '../src/modules/buildings/buildingSystem.js';
import { createResourceRenewalSystem } from '../src/modules/ecology/resourceRenewalSystem.js';
import { createFireSystem } from '../src/modules/environment/fireSystem.js';
import { createWeatherSystem } from '../src/modules/environment/weatherSystem.js';
import { createFarmSystem } from '../src/modules/farming/farmSystem.js';
import { createChronicleSystem } from '../src/modules/history/chronicleSystem.js';
import { createMapSystem } from '../src/modules/map/mapSystem.js';
import { placeStartingSettlers } from '../src/modules/map/placeStartingSettlers.js';
import { createFounders } from '../src/modules/people/createFounders.js';
import { createPeopleSystem } from '../src/modules/people/peopleSystem.js';
import { createRoadSystem } from '../src/modules/roads/roadSystem.js';
import { createRoadTickSampler } from '../src/modules/roads/roadTickSampler.js';
import { createSeasonSystem } from '../src/modules/seasons/seasonSystem.js';
import { createCampRulesSystem } from '../src/modules/settlements/campRules.js';
import { createCampStore } from '../src/modules/settlements/campStore.js';
import { createSocialEventSystem } from '../src/modules/social/socialEventSystem.js';
import { createFoodStorageSystem } from '../src/modules/storage/foodStorageSystem.js';

const DAY_30_EXPECTED_FINGERPRINT = '0876a28dbd85d9ceb38c273a2049bb9433439089169be8bb27f79037efb73c4c';

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value ?? 0) * factor) / factor;
}

function terrainCounts(map) {
  return [...map.terrain].reduce((counts, terrain) => {
    counts[terrain] = (counts[terrain] ?? 0) + 1;
    return counts;
  }, {});
}

function sortById(list) {
  return [...list].sort((first, second) => String(first.id).localeCompare(String(second.id)));
}

function fingerprint(world) {
  const map = world.map.get();
  const runtimePeople = world.actions.getMovementPeople();
  return {
    time: world.time.now(),
    people: world.people.list({ sortBy: 'birth' }).map((person) => ({
      id: person.id,
      name: person.identity.name,
      location: {
        tileX: round(runtimePeople.find((item) => item.id === person.id)?.location.tileX),
        tileY: round(runtimePeople.find((item) => item.id === person.id)?.location.tileY),
        homeId: person.location.homeId ?? null,
      },
      state: Object.fromEntries(Object.entries(person.state).map(([key, value]) => [
        key,
        typeof value === 'number' ? round(value) : value,
      ])),
      inventory: structuredClone(person.inventory.items),
      activity: {
        status: person.activity.status,
        currentType: person.activity.current?.type ?? null,
        completedCount: person.activity.completedCount,
      },
      relations: Object.fromEntries(Object.entries(person.relations).sort(([a], [b]) => a.localeCompare(b))),
      lifeEventCount: person.memories.lifeEvents.length,
      personalMemoryCount: person.memories.personal.length,
    })),
    camp: world.camp.exportState(),
    buildings: sortById(world.buildings.list()),
    fire: world.fire.exportState(),
    farms: world.farms.exportState(),
    ecology: world.ecology.exportState(),
    roads: {
      ...world.roads.exportState(),
      cells: sortById(world.roads.exportState().cells),
    },
    foodStorage: world.foodStorage.exportState(),
    socialEvents: world.socialEvents.exportState(),
    chronicles: world.chronicles.exportState(),
    map: {
      seed: map.seed,
      terrainCounts: terrainCounts(map),
      features: sortById(map.features).map((feature) => ({
        id: feature.id,
        kind: feature.kind,
        x: feature.x,
        y: feature.y,
        resource: feature.resource ?? null,
        ecology: feature.ecology ?? null,
      })),
    },
    reservations: sortById(world.actions.getReservationLedger().list()),
    logs: world.actions.getRecentLogs(40).map((entry) => ({ summary: entry.summary, type: entry.type, time: entry.time })),
  };
}

function fingerprintDigest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function createReplayWorld(seed = 'shengling-starting-valley-v1') {
  resetIdSequence(seed);
  const bus = createEventBus();
  const time = createGameTime({ year: 1, day: 1, minute: 480 });
  const people = createPeopleSystem({ eventBus: bus, gameTime: time });
  const map = createMapSystem({ eventBus: bus, gameTime: time });
  const camp = createCampStore({ eventBus: bus, gameTime: time });
  const campRules = createCampRulesSystem({ eventBus: bus, gameTime: time });
  const buildings = createBuildingSystem({ eventBus: bus, gameTime: time });
  const weather = createWeatherSystem({ eventBus: bus, gameTime: time, seed: `${seed}:weather` });

  createFounders(people);
  const valley = map.createStartingValley({ seed });
  placeStartingSettlers({ peopleSystem: people, map: valley });
  camp.create({
    id: 'starting-camp',
    label: '起始营地',
    anchor: valley.spawnPoint,
    items: { wood: 3, berries: 2, water: 1 },
    capacity: 24,
    storageLabel: '营地露天堆放',
  });

  const fire = createFireSystem({ eventBus: bus, gameTime: time, mapSystem: map });
  const seasons = createSeasonSystem({ eventBus: bus, gameTime: time });
  weather.setSeasonSystem(seasons);
  const ecology = createResourceRenewalSystem({ eventBus: bus, gameTime: time, mapSystem: map, buildingSystem: buildings });
  const roads = createRoadSystem({ eventBus: bus, gameTime: time });
  const farms = createFarmSystem({ eventBus: bus, gameTime: time, mapSystem: map, buildingSystem: buildings, seasonSystem: seasons });
  const foodStorage = createFoodStorageSystem({ eventBus: bus, gameTime: time, campStore: camp });
  const ledger = createReservationLedger();
  const actions = createActionSystem({
    peopleSystem: people,
    mapSystem: map,
    campStore: camp,
    buildingSystem: buildings,
    weatherSystem: weather,
    fireSystem: fire,
    campRulesSystem: campRules,
    eventBus: bus,
    gameTime: time,
    reservationLedger: ledger,
  });
  const roadSampler = createRoadTickSampler({ roadSystem: roads, getPeople: () => actions.getMovementPeople() });

  globalThis.shengling = {
    gameTime: time,
    peopleSystem: people,
    mapSystem: map,
    campStore: camp,
    campRulesSystem: campRules,
    buildingSystem: buildings,
    weatherSystem: weather,
    fireSystem: fire,
    seasonSystem: seasons,
    ecologySystem: ecology,
    roadSystem: roads,
    farmSystem: farms,
    foodStorageSystem: foodStorage,
    actionSystem: actions,
    worldSpeedSystem: { get: () => ({ value: 10, label: '10×', worldMinutesPerRealSecond: 60 }) },
  };

  const socialEvents = createSocialEventSystem({
    eventBus: bus,
    peopleSystem: people,
    gameTime: time,
    getRuntimePeople: () => actions.getRenderPeople(),
  });
  const chronicles = createChronicleSystem({ eventBus: bus, gameTime: time, peopleSystem: people });
  globalThis.shengling.socialEventSystem = socialEvents;
  globalThis.shengling.chronicleSystem = chronicles;

  bus.on('simulation:tick', ({ weather: currentWeather }) => {
    ecology.sync();
    farms.syncGrowth(currentWeather);
    foodStorage.sync(currentWeather);
    roadSampler.sample();
  });
  bus.on('buildings:completed', ({ building }) => {
    if (building.typeId === 'communalShelter') {
      const residents = people.getAliveRuntime().map((person) => person.id);
      buildings.assignOccupants(building.id, residents);
      residents.forEach((id) => people.setLocation(id, { homeId: building.id }));
    }
    if (building.typeId === 'storageShed') {
      camp.applyStorageUpgrade('starting-camp', {
        sourceBuildingId: building.id,
        label: building.label,
        capacityDelta: building.effects.storageCapacity,
        protectionDelta: building.effects.storageProtection,
      });
    }
  });
  bus.on('farms:changed', ({ reason, field }) => {
    if (reason !== 'field:harvested' || field?.id !== 'first-millet-field') return;
    const currentCamp = camp.get('starting-camp');
    if (currentCamp) farms.ensureExpansionField({ campAnchor: currentCamp.anchor });
  });

  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  actions.start();
  actions.stop();
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;

  return {
    bus, time, people, map, camp, campRules, buildings, weather, fire,
    seasons, ecology, roads, farms, foodStorage, actions, socialEvents, chronicles,
  };
}

test('固定步长时钟不受现实帧切分方式影响', () => {
  const first = createFixedStepClock();
  const second = createFixedStepClock();
  let firstTicks = 0;
  let secondTicks = 0;
  for (let index = 0; index < 100; index += 1) firstTicks += first.consume(0.1, 10);
  for (let index = 0; index < 50; index += 1) secondTicks += second.consume(0.2, 10);
  assert.equal(firstTicks, 600);
  assert.equal(secondTicks, 600);
  assert.equal(first.getDiagnostics().accumulatorMinutes, second.getDiagnostics().accumulatorMinutes);
});

test('UI 调度器合并高频请求并限制刷新频率', () => {
  let current = 0;
  let frameCallback = null;
  let timerCallback = null;
  const renders = [];
  const scheduler = createUiRenderScheduler({
    maxFps: 10,
    now: () => current,
    requestFrame(callback) { frameCallback = callback; return 1; },
    cancelFrame() { frameCallback = null; },
    setTimer(callback) { timerCallback = callback; return 2; },
    clearTimer() { timerCallback = null; },
    render: (reasons) => renders.push(reasons),
  });

  scheduler.request('a');
  scheduler.request('b');
  frameCallback(current);
  assert.deepEqual(renders, [['a', 'b']]);
  current = 20;
  scheduler.request('c');
  scheduler.request('d');
  assert.equal(renders.length, 1);
  current = 100;
  timerCallback();
  frameCallback(current);
  assert.deepEqual(renders[1], ['c', 'd']);
});

test('统一预留账本执行容量约束并按任务释放', () => {
  const ledger = createReservationLedger();
  assert.ok(ledger.reserve({ id: 'a', type: 'camp-storage', key: 'camp', taskId: 'task-1', amount: 3, capacity: 5 }));
  assert.equal(ledger.reserve({ id: 'b', type: 'camp-storage', key: 'camp', taskId: 'task-2', amount: 3, capacity: 5 }), null);
  assert.ok(ledger.reserve({ id: 'c', type: 'feature', key: 'tree-1', taskId: 'task-1', capacity: 1 }));
  assert.equal(ledger.reserve({ id: 'd', type: 'feature', key: 'tree-1', taskId: 'task-2', capacity: 1 }), null);
  assert.equal(ledger.releaseTask('task-1').length, 2);
  assert.equal(ledger.getSummary().total, 0);
});

test('固定种子回放到第 30 日命中确定性世界指纹', { timeout: 300_000 }, () => {
  const originalRuntime = globalThis.shengling;
  try {
    const world = createReplayWorld('replay-seed-v026');
    world.actions.advanceTicks(42_000);
    const state = fingerprint(world);
    const digest = fingerprintDigest(state);
    console.log(`DAY30_FINGERPRINT=${digest}`);

    assert.deepEqual(world.time.now(), { year: 1, day: 30, minute: 720, tick: 42_000 });
    assert.equal(digest, DAY_30_EXPECTED_FINGERPRINT);

    const storage = world.camp.getStorage('starting-camp');
    const reservedStorage = world.actions.getReservationLedger().amount({ type: 'camp-storage', key: 'starting-camp' });
    assert.ok(reservedStorage <= storage.available);
    world.people.getAliveRuntime().forEach((person) => {
      Object.values(person.inventory.items).forEach((amount) => assert.ok(Number(amount) >= 0));
    });
    Object.values(world.camp.get('starting-camp').items).forEach((amount) => assert.ok(Number(amount) >= 0));
    const activeTasks = world.people.getAliveRuntime().filter((person) => person.activity.current).length;
    assert.equal(world.actions.getReservationLedger().count({ type: 'task-slot' }), activeTasks);
    assert.equal(world.actions.getDiagnostics().lastSimulationError, null);
  } finally {
    globalThis.shengling = originalRuntime;
  }
});
