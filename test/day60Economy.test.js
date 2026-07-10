import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';

import { createEventBus } from '../src/core/events/eventBus.js';
import { resetIdSequence } from '../src/core/ids/createId.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { createActionSystem } from '../src/modules/actions/actionSystem.js';
import { createReservationLedger } from '../src/modules/actions/reservationLedger.js';
import { createBuildingSystem } from '../src/modules/buildings/buildingSystem.js';
import { createResourceRenewalSystem } from '../src/modules/ecology/resourceRenewalSystem.js';
import { createDailyEconomySystem } from '../src/modules/economy/dailyEconomySystem.js';
import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';
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

const DAY_60_EXPECTED_FINGERPRINT = '0000000000000000000000000000000000000000000000000000000000000000';
const DAY_60_TICKS = 85_200;

function round(value, digits = 4) {
  const factor = 10 ** digits;
  return Math.round(Number(value ?? 0) * factor) / factor;
}

function sortById(list) {
  return [...list].sort((first, second) => String(first.id).localeCompare(String(second.id)));
}

function digest(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function createReplayWorld(seed) {
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
  const reservationLedger = createReservationLedger();
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
    reservationLedger,
  });
  const roadSampler = createRoadTickSampler({ roadSystem: roads, getPeople: () => actions.getMovementPeople() });
  const socialEvents = createSocialEventSystem({
    eventBus: bus,
    peopleSystem: people,
    gameTime: time,
    getRuntimePeople: () => actions.getRenderPeople(),
  });
  const chronicles = createChronicleSystem({ eventBus: bus, gameTime: time, peopleSystem: people });

  const runtime = {
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
    socialEventSystem: socialEvents,
    chronicleSystem: chronicles,
    worldSpeedSystem: { get: () => ({ value: 10, label: '10×', worldMinutesPerRealSecond: 60 }) },
  };

  const resourceFlow = createResourceFlowSystem({
    eventBus: bus,
    gameTime: time,
    getRuntime: () => runtime,
  });
  runtime.resourceFlowSystem = resourceFlow;
  bus.on('*', ({ eventName, payload }) => resourceFlow.observe(eventName, payload));

  const dailyEconomy = createDailyEconomySystem({
    eventBus: bus,
    gameTime: time,
    resourceFlowSystem: resourceFlow,
    getRuntime: () => runtime,
  });
  runtime.dailyEconomySystem = dailyEconomy;
  bus.on('*', ({ eventName, payload }) => dailyEconomy.observe(eventName, payload));

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

  globalThis.shengling = runtime;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  actions.start();
  actions.stop();
  globalThis.requestAnimationFrame = originalRequestAnimationFrame;
  globalThis.cancelAnimationFrame = originalCancelAnimationFrame;

  return {
    ...runtime,
    bus,
    time,
    people,
    map,
    camp,
    buildings,
    weather,
    fire,
    seasons,
    ecology,
    roads,
    farms,
    foodStorage,
    actions,
    socialEvents,
    chronicles,
    resourceFlow,
    dailyEconomy,
  };
}

function worldFingerprint(world) {
  const runtimePeople = world.actions.getMovementPeople();
  const map = world.map.get();
  return {
    time: world.time.now(),
    people: world.people.list({ sortBy: 'birth' }).map((person) => ({
      id: person.id,
      location: {
        tileX: round(runtimePeople.find((entry) => entry.id === person.id)?.location.tileX),
        tileY: round(runtimePeople.find((entry) => entry.id === person.id)?.location.tileY),
        homeId: person.location.homeId ?? null,
      },
      state: Object.fromEntries(Object.entries(person.state).map(([key, value]) => [key, typeof value === 'number' ? round(value) : value])),
      inventory: structuredClone(person.inventory.items),
      activity: {
        status: person.activity.status,
        currentType: person.activity.current?.type ?? null,
        completedCount: person.activity.completedCount,
      },
      lifeEvents: person.memories.lifeEvents.length,
      personalMemories: person.memories.personal.length,
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

function economyFingerprint(world) {
  return {
    world: worldFingerprint(world),
    reports: world.dailyEconomy.listReports().map((report) => ({
      year: report.year,
      day: report.day,
      opening: report.openingInventory.byItem,
      closing: report.closingInventory.byItem,
      categories: report.flow.byCategory,
      balances: report.balances,
      labor: report.labor,
      denials: report.denials,
      bottlenecks: report.bottlenecks.map(({ type, severity, itemId = null, value }) => ({ type, severity, itemId, value })),
      ok: report.ok,
    })),
    flow: world.resourceFlow.getSummary(),
    flowTail: world.resourceFlow.list({ limit: 40 }).map((entry) => ({
      tick: entry.tick,
      itemId: entry.itemId,
      amount: entry.amount,
      from: entry.from,
      to: entry.to,
      category: entry.category,
      taskId: entry.taskId,
    })),
  };
}

function advanceBatched(world, totalTicks, batchSize) {
  let remaining = totalTicks;
  while (remaining > 0) {
    const amount = Math.min(batchSize, remaining);
    world.actions.advanceTicks(amount);
    remaining -= amount;
  }
}

test('完整世界推进到第 60 日并命中经济指纹', { timeout: 600_000 }, () => {
  const originalRuntime = globalThis.shengling;
  try {
    const world = createReplayWorld('replay-seed-v0275-day60');
    globalThis.shengling = world;
    world.actions.advanceTicks(DAY_60_TICKS);
    const state = economyFingerprint(world);
    const fingerprint = digest(state);
    console.log(`DAY60_FINGERPRINT=${fingerprint}`);

    assert.deepEqual(world.time.now(), { year: 1, day: 60, minute: 720, tick: DAY_60_TICKS });
    assert.equal(world.dailyEconomy.listReports().length, 60);
    assert.equal(world.dailyEconomy.verify().ok, true);
    assert.equal(world.resourceFlow.verify().ok, true);
    assert.equal(world.actions.getDiagnostics().lastSimulationError, null);
    assert.equal(fingerprint, DAY_60_EXPECTED_FINGERPRINT);
  } finally {
    globalThis.shengling = originalRuntime;
  }
});

test('1×、5×、10× 批次推进在相同世界时间得到相同状态', { timeout: 300_000 }, () => {
  const originalRuntime = globalThis.shengling;
  try {
    const totalTicks = 1_680;
    const fingerprints = [1, 5, 10].map((batchSize) => {
      const world = createReplayWorld('replay-seed-v0275-speed');
      globalThis.shengling = world;
      advanceBatched(world, totalTicks, batchSize);
      assert.deepEqual(world.time.now(), { year: 1, day: 2, minute: 720, tick: totalTicks });
      assert.equal(world.actions.getDiagnostics().lastSimulationError, null);
      return digest(worldFingerprint(world));
    });
    assert.equal(new Set(fingerprints).size, 1);
  } finally {
    globalThis.shengling = originalRuntime;
  }
});
