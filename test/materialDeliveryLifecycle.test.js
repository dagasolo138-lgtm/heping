import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { collectConstructionMaterial, deliverConstructionMaterial } from '../src/modules/actions/constructionEffects.js';
import { createRuntimeTask } from '../src/modules/actions/actionExecutor.js';

function withRuntime(run) {
  const previousRuntime = globalThis.shengling;
  const previousEventBus = globalThis.__shenglingEventBus;
  const events = [];
  globalThis.__shenglingEventBus = {
    emit: (eventName, payload) => events.push({ eventName, payload: structuredClone(payload) }),
  };
  globalThis.shengling = {
    gameTime: {
      stamp: () => ({ year: 1, day: 2, minute: 40, tick: 1000, label: '第 2 日 00:40' }),
    },
    peopleSystem: {
      getRuntime: () => ({
        id: 'person-1',
        identity: { alive: true, name: '阿禾' },
        inventory: { items: { wood: 4 } },
        work: { skills: { building: 3 } },
        state: { energy: 70 },
      }),
    },
  };
  try {
    return run(events);
  } finally {
    globalThis.shengling = previousRuntime;
    globalThis.__shenglingEventBus = previousEventBus;
  }
}

function deliveryTask(overrides = {}) {
  return {
    id: 'delivery-1',
    type: ACTION_TYPES.DELIVER_MATERIALS,
    label: '运送建材',
    destination: { x: 1, y: 1 },
    workDuration: 20,
    data: {
      stage: 'collect',
      siteId: 'site-1',
      reservationId: 'reservation-1',
      materialId: 'wood',
      siteDestination: { x: 4, y: 1 },
      laborCost: {
        tool: {
          id: 'tool-basket-1',
          effects: { workDurationMultiplier: 0.9, energyMultiplier: 0.85, loadWeightMultiplier: 0.65 },
        },
      },
      ...(overrides.data ?? {}),
    },
    ...overrides,
  };
}

function peopleSystem() {
  const changes = [];
  return {
    changes,
    get: () => ({
      id: 'person-1',
      identity: { name: '阿禾', alive: true },
      inventory: { items: { wood: 0 } },
    }),
    changeItem: (personId, itemId, amount) => changes.push({ personId, itemId, amount }),
  };
}

function deliveryPeople({ wood = 4 } = {}) {
  const changes = [];
  const locations = [];
  const activities = [];
  const lifeEvents = [];
  let activity = { completedCount: 0 };
  return {
    changes,
    locations,
    activities,
    lifeEvents,
    get: () => ({
      id: 'person-1',
      identity: { name: '阿禾', alive: true },
      inventory: { items: { wood } },
      activity,
    }),
    changeItem: (personId, itemId, amount) => changes.push({ personId, itemId, amount }),
    setLocation: (personId, location) => locations.push({ personId, location }),
    setActivity: (personId, next) => {
      activity = { ...activity, ...next };
      activities.push({ personId, activity: structuredClone(next) });
    },
    addLifeEvent: (personId, event) => lifeEvents.push({ personId, event }),
  };
}

const gameTime = {
  stamp: () => ({ year: 1, day: 2, minute: 40, tick: 1000, label: '第 2 日 00:40' }),
};

test('材料不足会取消预留并立即写入明确失败原因', () => withRuntime((events) => {
  const people = peopleSystem();
  const cancelled = [];
  const result = collectConstructionMaterial({
    agent: { personId: 'person-1', x: 1, y: 1 },
    task: deliveryTask(),
    peopleSystem: people,
    campStore: { take: () => 0 },
    buildingSystem: {
      beginDelivery: () => ({ id: 'reservation-1', itemId: 'wood', amount: 4 }),
      cancelReservation: (...args) => cancelled.push(args),
      get: () => ({ label: '草棚工地' }),
    },
    campId: 'starting-camp',
  });

  assert.equal(result.nextTask, null);
  assert.equal(result.failureReason, 'construction-material-insufficient');
  assert.deepEqual(cancelled, [['site-1', 'reservation-1']]);
  const failure = events.find((entry) => entry.eventName === 'actions:failed');
  assert.equal(failure.payload.reason, 'construction-material-insufficient');
  assert.equal(failure.payload.details.materialId, 'wood');
}));

test('领取成功会保留同一任务 ID，并显式标记 collect 到 deliver', () => withRuntime((events) => {
  const people = peopleSystem();
  const result = collectConstructionMaterial({
    agent: { personId: 'person-1', x: 1, y: 1 },
    task: deliveryTask(),
    peopleSystem: people,
    campStore: { take: () => 4 },
    buildingSystem: {
      beginDelivery: () => ({ id: 'reservation-1', itemId: 'wood', amount: 4 }),
      cancelReservation: () => false,
      get: () => ({ label: '草棚工地' }),
    },
    campId: 'starting-camp',
  });

  assert.equal(result.failureReason, null);
  assert.equal(result.nextTask.id, 'delivery-1');
  assert.equal(result.nextTask.data.previousStage, 'collect');
  assert.equal(result.nextTask.data.stage, 'deliver');
  assert.equal(result.nextTask.data.carriedAmount, 4);
  assert.deepEqual(people.changes, [{ personId: 'person-1', itemId: 'wood', amount: 4 }]);
  assert.equal(events.some((entry) => entry.eventName === 'actions:failed'), false);
}));

test('负重送达阶段生成真实劳动成本并发布阶段转换事件', () => withRuntime((events) => {
  const task = deliveryTask({
    destination: { x: 2, y: 0 },
    data: {
      stage: 'deliver',
      previousStage: 'collect',
      carriedAmount: 4,
      laborCost: {
        tool: {
          id: 'tool-basket-1',
          effects: { workDurationMultiplier: 0.9, energyMultiplier: 0.85, loadWeightMultiplier: 0.65 },
        },
      },
    },
  });
  const runtimeTask = createRuntimeTask(
    task,
    { personId: 'person-1', x: 0, y: 0 },
    { isWalkable: () => true, getTerrainAt: () => 'grass' },
  );

  assert.ok(runtimeTask);
  assert.equal(runtimeTask.id, 'delivery-1');
  assert.equal(runtimeTask.data.stage, 'deliver');
  assert.ok(runtimeTask.data.laborCost.expectedDuration > 0);
  assert.ok(runtimeTask.data.laborCost.expectedEnergy > 0);
  assert.ok(runtimeTask.data.laborCost.loadWeight > 0);
  assert.equal(runtimeTask.data.laborCost.tool.id, 'tool-basket-1');

  const transition = events.find((entry) => entry.eventName === 'actions:stage-transition');
  assert.equal(transition.payload.taskId, 'delivery-1');
  assert.equal(transition.payload.fromStage, 'collect');
  assert.equal(transition.payload.toStage, 'deliver');
  assert.equal(transition.payload.task.data.laborCost.loadWeight, runtimeTask.data.laborCost.loadWeight);
}));

test('送达路线阻断会立即记录失败，且不会生成第二阶段任务', () => withRuntime((events) => {
  const task = deliveryTask({
    destination: { x: 2, y: 2 },
    data: { stage: 'deliver', previousStage: 'collect', carriedAmount: 4 },
  });
  const runtimeTask = createRuntimeTask(
    task,
    { personId: 'person-1', x: 0, y: 0 },
    { isWalkable: () => false },
  );

  assert.equal(runtimeTask, null);
  const failure = events.find((entry) => entry.eventName === 'actions:failed');
  assert.equal(failure.payload.taskId, 'delivery-1');
  assert.equal(failure.payload.reason, 'delivery-route-blocked');
  assert.equal(failure.payload.details.stage, 'deliver');
}));

test('工地预留在交接前失效时保留人物背包中的全部建材', () => withRuntime((events) => {
  const people = deliveryPeople({ wood: 4 });
  const result = deliverConstructionMaterial({
    agent: { personId: 'person-1', x: 4, y: 1 },
    task: deliveryTask({ data: { stage: 'deliver', carriedAmount: 4 } }),
    peopleSystem: people,
    buildingSystem: {
      deliverReservation: () => null,
      get: () => ({ label: '草棚工地' }),
    },
    gameTime,
  });

  assert.equal(result, null);
  assert.deepEqual(people.changes, []);
  assert.equal(people.activities.at(-1).activity.status, 'idle');
  assert.equal(people.activities.at(-1).activity.current, null);
  const failure = events.find((entry) => entry.eventName === 'actions:failed');
  assert.equal(failure.payload.reason, 'delivery-handoff-failed');
  assert.equal(failure.payload.details.carriedAmount, 4);
}));

test('部分交接只扣除实际送达量，剩余材料继续留在背包', () => withRuntime((events) => {
  const people = deliveryPeople({ wood: 4 });
  const result = deliverConstructionMaterial({
    agent: { personId: 'person-1', x: 4, y: 1 },
    task: deliveryTask({ data: { stage: 'deliver', carriedAmount: 4 } }),
    peopleSystem: people,
    buildingSystem: {
      deliverReservation: () => ({ amount: 2 }),
      get: () => ({ label: '草棚工地' }),
    },
    gameTime,
  });

  assert.ok(result);
  assert.deepEqual(people.changes, [{ personId: 'person-1', itemId: 'wood', amount: -2 }]);
  assert.equal(events.some((entry) => entry.eventName === 'actions:failed'), false);
  assert.equal(people.lifeEvents.at(-1).event.details.amount, 2);
}));
