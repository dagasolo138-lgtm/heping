import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../src/core/events/eventBus.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { createPeopleSystem } from '../src/modules/people/peopleSystem.js';
import { createFounders } from '../src/modules/people/createFounders.js';
import { createMapSystem } from '../src/modules/map/mapSystem.js';
import { placeStartingSettlers } from '../src/modules/map/placeStartingSettlers.js';
import { createCampStore } from '../src/modules/settlements/campStore.js';
import { createCampRulesSystem } from '../src/modules/settlements/campRules.js';
import { createBuildingSystem } from '../src/modules/buildings/buildingSystem.js';
import { createWeatherSystem } from '../src/modules/environment/weatherSystem.js';
import { createFireSystem } from '../src/modules/environment/fireSystem.js';
import { createResourceRenewalSystem } from '../src/modules/ecology/resourceRenewalSystem.js';
import { createActionSystem } from '../src/modules/actions/actionSystem.js';
import { planNextAction } from '../src/modules/actions/actionPlanner.js';

test('搬运任务只预留当前真实可用的营地容量', () => {
  const person = {
    identity: { alive: true },
    inventory: { items: { wood: 4, berries: 2 } },
  };
  const camp = { id: 'starting-camp', anchor: { x: 1, y: 1 }, items: {}, storage: { capacity: 24 } };

  const task = planNextAction({
    person,
    camp,
    population: 10,
    storage: { available: 1 },
  });

  assert.equal(task.type, 'haulToCamp');
  assert.equal(task.data.reservedCapacity, 1);
  assert.equal(planNextAction({ person, camp, population: 10, storage: { available: 0 } }), null);
});

test('建筑存档不会保存或恢复运行时建材预留', () => {
  const eventBus = createEventBus();
  const gameTime = createGameTime({ year: 1, day: 1, minute: 480 });
  const buildings = createBuildingSystem({ eventBus, gameTime });
  const site = buildings.startConstruction({ typeId: 'communalShelter', anchor: { x: 10, y: 10 } });
  buildings.reserveMaterial(site.id, 'wood', 3);

  const snapshot = buildings.exportState();
  assert.deepEqual(snapshot.buildings[0].materials.reservations, []);

  snapshot.buildings[0].materials.reservations = [{
    id: 'legacy-reservation',
    itemId: 'wood',
    amount: 3,
    state: 'reserved',
  }];
  buildings.importState(snapshot);
  assert.deepEqual(buildings.get(site.id).materials.reservations, []);
  assert.equal(buildings.getMaterialNeed(site.id).wood, 12);
});

test('10× 模拟可运行到第 4 日中午且完成首座草棚', { timeout: 120_000 }, async () => {
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const originalRuntime = globalThis.shengling;
  let frameId = 0;
  let queue = new Map();

  globalThis.requestAnimationFrame = (callback) => {
    const id = ++frameId;
    queue.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => queue.delete(id);

  try {
    const bus = createEventBus();
    const time = createGameTime({ year: 1, day: 1, minute: 480 });
    const people = createPeopleSystem({ eventBus: bus, gameTime: time });
    const map = createMapSystem({ eventBus: bus, gameTime: time });
    const camp = createCampStore({ eventBus: bus, gameTime: time });
    const campRules = createCampRulesSystem({ eventBus: bus, gameTime: time });
    const buildings = createBuildingSystem({ eventBus: bus, gameTime: time });
    const weather = createWeatherSystem({ eventBus: bus, gameTime: time });

    createFounders(people);
    const valley = map.createStartingValley();
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
    const ecology = createResourceRenewalSystem({
      eventBus: bus,
      gameTime: time,
      mapSystem: map,
      buildingSystem: buildings,
    });
    globalThis.shengling = {
      worldSpeedSystem: {
        get: () => ({ value: 10, label: '10×', worldMinutesPerRealSecond: 60 }),
      },
      ecologySystem: ecology,
    };

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
    });
    globalThis.shengling.actionSystem = actions;

    bus.on('buildings:completed', ({ building }) => {
      if (building.typeId === 'communalShelter') {
        const residents = people.getAlive().map((person) => person.id);
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

    actions.start();
    let now = performance.now();
    let frames = 0;
    while (
      (time.now().day < 4 || (time.now().day === 4 && time.now().minute < 720))
      && frames < 1_400
      && actions.isRunning()
    ) {
      now += 120;
      const callbacks = [...queue.values()];
      queue = new Map();
      callbacks.forEach((callback) => callback(now));
      frames += 1;
      if (frames % 100 === 0) await Promise.resolve();
    }

    const diagnostics = actions.getDiagnostics();
    assert.equal(diagnostics.actionLoopRunning, true);
    assert.equal(diagnostics.lastSimulationError, null);
    assert.equal(time.now().day, 4);
    assert.ok(time.now().minute >= 720);
    assert.ok(buildings.completedByType('communalShelter'), JSON.stringify({
      storage: camp.getStorage('starting-camp'),
      construction: buildings.list().map((building) => ({
        typeId: building.typeId,
        status: building.status,
        delivered: building.materials.delivered,
        reservations: building.materials.reservations,
      })),
      people: people.getAlive().map((person) => ({
        name: person.identity.name,
        activity: person.activity.current,
        inventory: person.inventory.items,
      })),
      logs: actions.getRecentLogs(12).map((entry) => entry.summary),
    }, null, 2));

    const activeDeliveries = people.getAlive()
      .filter((person) => person.activity.current?.type === 'deliverMaterials').length;
    const openReservations = buildings.list()
      .flatMap((building) => building.materials.reservations);
    assert.ok(openReservations.length <= activeDeliveries);

    const blockedHauls = actions.getRecentLogs(40)
      .filter((entry) => entry.summary.includes('储存已满')).length;
    assert.ok(blockedHauls <= 2, `满仓空跑日志过多：${blockedHauls}`);
    actions.stop();
  } finally {
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
    globalThis.shengling = originalRuntime;
  }
});
