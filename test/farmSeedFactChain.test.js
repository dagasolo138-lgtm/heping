import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../src/core/events/eventBus.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { completeFarmAction } from '../src/modules/actions/farmEffects.js';
import { planFarmAction } from '../src/modules/actions/farmPlanner.js';
import { createReservationLedger } from '../src/modules/actions/reservationLedger.js';
import { createFarmSystem } from '../src/modules/farming/farmSystem.js';
import { createSoil } from '../src/modules/farming/soilModel.js';
import { createFounders } from '../src/modules/people/createFounders.js';
import { createPeopleSystem } from '../src/modules/people/peopleSystem.js';
import { createCampStore } from '../src/modules/settlements/campStore.js';

function fieldSnapshot(time, status = 'readyToSow') {
  return {
    id: 'test-millet-field',
    label: '测试粟田',
    anchor: { x: 8, y: 8 },
    footprint: { width: 2, height: 2 },
    cropId: 'millet',
    origin: 'test',
    expansion: null,
    status,
    clearing: { required: 1, completed: 1 },
    soil: createSoil(time.now().tick),
    growth: { progressed: status === 'mature' ? 1440 : 0, required: 1440, lastTick: time.now().tick },
    planting: ['growing', 'mature'].includes(status)
      ? { seedItemId: 'milletSeed', seedAmount: 1, personId: 'previous-farmer', taskId: 'previous-sow', plantedAt: time.stamp() }
      : null,
    plantedAt: ['growing', 'mature'].includes(status) ? time.stamp() : null,
    matureAt: status === 'mature' ? time.stamp() : null,
    harvestCount: 0,
    createdAt: time.stamp(),
    updatedAt: time.stamp(),
  };
}

function setup({ campSeeds = 2 } = {}) {
  const previousRuntime = globalThis.shengling;
  const previousBus = globalThis.__shenglingEventBus;
  const bus = createEventBus();
  const time = createGameTime({ year: 1, day: 1, minute: 480 });
  const people = createPeopleSystem({ eventBus: bus, gameTime: time });
  createFounders(people);
  const camp = createCampStore({ eventBus: bus, gameTime: time });
  camp.create({
    id: 'starting-camp',
    label: '起始营地',
    anchor: { x: 0, y: 0 },
    items: campSeeds > 0 ? { milletSeed: campSeeds } : {},
    capacity: 24,
  });
  const reservationLedger = createReservationLedger();
  const mapSystem = {
    getTile: () => ({ terrain: 'grass', features: [] }),
    setTerrainBatch: () => {},
  };
  const buildingSystem = {
    list: () => [],
    completedByType: () => true,
  };
  const seasonSystem = {
    get: () => ({ id: 'spring', label: '春季' }),
    getCropRule: () => ({ canSow: true, growthMultiplier: 1, waitingLabel: '可播种' }),
  };
  const farm = createFarmSystem({ eventBus: bus, gameTime: time, mapSystem, buildingSystem, seasonSystem });
  globalThis.shengling = {
    gameTime: time,
    peopleSystem: people,
    campStore: camp,
    reservationLedger,
    farmSystem: farm,
  };
  const person = people.getAliveRuntime()[0];
  people.setLocation(person.id, { tileX: 0, tileY: 0 });

  return {
    bus,
    time,
    people,
    camp,
    farm,
    reservationLedger,
    personId: person.id,
    restore() {
      globalThis.shengling = previousRuntime;
      globalThis.__shenglingEventBus = previousBus;
    },
  };
}

test('播种任务从营地领取真实粟种，抵达农田后才消耗', () => {
  const world = setup();
  try {
    world.farm.importState({ schemaVersion: 2, initialSeedsProvisioned: true, fields: [fieldSnapshot(world.time)] });
    const person = world.people.getRuntime(world.personId);
    const task = planFarmAction({ person, farmSystem: world.farm, actionCounts: {} });
    assert.equal(task.type, 'sowMillet');
    assert.equal(task.data.seedItemId, 'milletSeed');

    world.people.setActivity(world.personId, { status: 'working', current: { id: task.id, type: task.type, label: task.label } });
    world.bus.emit('actions:assigned', { personId: world.personId, task });

    assert.equal(world.camp.get('starting-camp').items.milletSeed, 1);
    assert.equal(world.people.get(world.personId).inventory.items.milletSeed, 1);
    assert.equal(world.reservationLedger.list({ type: 'farm-seed-cargo' }).length, 1);

    const result = completeFarmAction({
      agent: { personId: world.personId, x: 9, y: 9 },
      task,
      peopleSystem: world.people,
      farmSystem: world.farm,
      gameTime: world.time,
    });

    assert.equal(result.seedAmount, 1);
    assert.equal(world.people.get(world.personId).inventory.items.milletSeed ?? 0, 0);
    assert.equal(world.reservationLedger.list({ type: 'farm-seed-cargo' }).length, 0);
    const field = world.farm.get('test-millet-field');
    assert.equal(field.status, 'growing');
    assert.equal(field.planting.taskId, task.id);
    assert.equal(field.planting.seedAmount, 1);
    assert.equal(world.farm.verifySeeds().ok, true);
  } finally {
    world.restore();
  }
});

test('收获把总产量拆成口粮与粟种并同时进入人物背包', () => {
  const world = setup({ campSeeds: 0 });
  try {
    world.farm.importState({ schemaVersion: 2, initialSeedsProvisioned: true, fields: [fieldSnapshot(world.time, 'mature')] });
    const beforeMillet = Number(world.people.get(world.personId).inventory.items.millet ?? 0);
    const beforeSeeds = Number(world.people.get(world.personId).inventory.items.milletSeed ?? 0);
    const task = {
      id: 'harvest-task',
      type: 'harvestMillet',
      label: '收获粟米',
      data: { fieldId: 'test-millet-field' },
    };
    const result = completeFarmAction({
      agent: { personId: world.personId, x: 9, y: 9 },
      task,
      peopleSystem: world.people,
      farmSystem: world.farm,
      gameTime: world.time,
    });
    assert.equal(result.harvest.totalAmount, result.harvest.foodAmount + result.harvest.seedAmount);
    assert.equal(result.harvest.foodAmount, 6);
    assert.equal(result.harvest.seedAmount, 2);
    assert.equal(world.people.get(world.personId).inventory.items.millet, beforeMillet + 6);
    assert.equal(world.people.get(world.personId).inventory.items.milletSeed, beforeSeeds + 2);
    assert.equal(world.farm.get('test-millet-field').status, 'readyToSow');
  } finally {
    world.restore();
  }
});

test('v1 农田存档的隐藏 seedStock 会迁移到营地真实库存', () => {
  const world = setup({ campSeeds: 0 });
  try {
    world.farm.importState({ schemaVersion: 1, seedStock: 2, fields: [fieldSnapshot(world.time)] });
    assert.equal(world.camp.get('starting-camp').items.milletSeed, 2);
    assert.equal(world.farm.getSeedSummary().onHand, 2);
  } finally {
    world.restore();
  }
});
