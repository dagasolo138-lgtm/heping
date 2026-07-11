import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../src/core/events/eventBus.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { createReservationLedger } from '../src/modules/actions/reservationLedger.js';
import { completeToolMaintenance } from '../src/modules/actions/toolMaintenanceEffects.js';
import { planToolMaintenanceAction } from '../src/modules/actions/toolMaintenancePlanner.js';
import { createToolMaintenanceRuntime } from '../src/modules/actions/toolMaintenanceRuntime.js';
import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';
import { createToolMaintenanceResourceFlowView } from '../src/modules/economy/toolMaintenanceResourceFlowView.js';
import { createYearAwareResourceFlowView } from '../src/modules/economy/yearAwareResourceFlowView.js';
import { createCampStore } from '../src/modules/settlements/campStore.js';
import { createToolSystem } from '../src/modules/tools/toolSystem.js';

function createHarness({ wood = 3 } = {}) {
  const previousRuntime = globalThis.shengling;
  const previousBus = globalThis.__shenglingEventBus;
  const eventBus = createEventBus();
  const gameTime = createGameTime({ year: 1, day: 1, minute: 480 });
  const reservationLedger = createReservationLedger();
  const campStore = createCampStore({ eventBus, gameTime });
  const camp = campStore.create({
    id: 'starting-camp',
    label: '起始营地',
    anchor: { x: 4, y: 4 },
    items: { wood },
    capacity: 24,
  });
  const person = {
    id: 'person-1',
    identity: { name: '测试村民', alive: true },
    location: { tileX: 4, tileY: 4 },
    work: { skills: { building: 2, gathering: 1 } },
    inventory: { items: {} },
    activity: { current: null },
  };
  const active = new Map();
  const runtime = {
    gameTime,
    campStore,
    reservationLedger,
    actionSystem: {
      getRenderPeople: () => [{ ...person, activity: { current: active.get(person.id) ?? null } }],
    },
  };
  globalThis.shengling = runtime;
  globalThis.__shenglingEventBus = eventBus;

  const toolSystem = createToolSystem({
    eventBus,
    gameTime,
    reservationLedger,
    getRuntime: () => runtime,
  });
  runtime.toolSystem = toolSystem;
  const toolMaintenanceRuntime = createToolMaintenanceRuntime({
    eventBus,
    reservationLedger,
    campStore,
    toolSystem,
    gameTime,
    getRuntime: () => runtime,
  });
  runtime.toolMaintenanceRuntime = toolMaintenanceRuntime;

  function startTask(task) {
    active.set(person.id, { id: task.id, type: task.type, label: task.label });
    eventBus.emit('actions:assigned', { personId: person.id, task: structuredClone(task), time: gameTime.stamp() });
  }

  function finishTask(task, eventName = 'actions:completed') {
    active.delete(person.id);
    eventBus.emit(eventName, { personId: person.id, task: structuredClone(task), taskId: task.id, time: gameTime.stamp() });
  }

  function installFlow() {
    const base = createResourceFlowSystem({ eventBus, gameTime, getRuntime: () => runtime });
    const yearAware = createYearAwareResourceFlowView({ resourceFlowSystem: base, gameTime });
    const flow = createToolMaintenanceResourceFlowView({ resourceFlowSystem: yearAware });
    runtime.resourceFlowSystem = flow;
    eventBus.on('*', ({ eventName, payload }) => base.observe(eventName, payload));
    return flow;
  }

  function restore() {
    globalThis.shengling = previousRuntime;
    globalThis.__shenglingEventBus = previousBus;
  }

  return {
    eventBus,
    gameTime,
    reservationLedger,
    campStore,
    camp,
    person,
    runtime,
    toolSystem,
    toolMaintenanceRuntime,
    startTask,
    finishTask,
    installFlow,
    restore,
  };
}

function damageStoneAxe(harness, amount = 60) {
  harness.toolSystem.applyWear('tool-stone-axe-1', amount);
  return harness.toolSystem.getMaintenanceDemand('tool-stone-axe-1');
}

test('真实维修任务预留工具与材料，并在完成时恢复耐久和记录维修流水', () => {
  const harness = createHarness({ wood: 3 });
  try {
    const demand = damageStoneAxe(harness);
    const flow = harness.installFlow();
    const task = planToolMaintenanceAction({
      person: harness.person,
      camp: harness.campStore.get('starting-camp'),
      actionCounts: {},
    });
    assert.equal(task.data.demandId, demand.id);
    harness.startTask(task);

    const bundle = harness.toolMaintenanceRuntime.getTaskReservation(task.id);
    assert.equal(bundle.toolId, demand.toolId);
    assert.equal(bundle.materialReservations.length, 1);
    assert.equal(harness.reservationLedger.count({ type: 'tool', key: demand.toolId }), 1);
    assert.equal(harness.reservationLedger.count({ type: 'camp-item', key: 'starting-camp:wood' }), 1);

    const beforeTool = harness.toolSystem.get(demand.toolId);
    const beforeWood = harness.campStore.get('starting-camp').items.wood;
    const result = completeToolMaintenance({
      agent: { personId: harness.person.id, x: 4, y: 4 },
      task,
      peopleSystem: { get: () => harness.person },
      campStore: harness.campStore,
      gameTime: harness.gameTime,
    });
    assert.equal(result.ok, true);
    assert.equal(harness.campStore.get('starting-camp').items.wood, beforeWood - 1);
    assert.ok(harness.toolSystem.get(demand.toolId).durability > beforeTool.durability);
    assert.equal(harness.toolSystem.getMaintenanceDemand(demand.toolId), null);

    harness.finishTask(task);
    assert.equal(harness.reservationLedger.count({ taskId: task.id }), 0);
    assert.equal(harness.toolMaintenanceRuntime.verify().ok, true);

    const repairEntries = flow.list({ category: 'repair' }).filter((entry) => entry.taskId === task.id);
    assert.equal(repairEntries.length, 2);
    assert.ok(repairEntries.some((entry) => entry.itemId === 'wood' && entry.metadata.toolId === demand.toolId));
    assert.ok(repairEntries.some((entry) => entry.itemId === 'durability:stoneAxe' && entry.metadata.toolId === demand.toolId));
  } finally {
    harness.restore();
  }
});

test('维修开始后材料被移走会整单失败，不扣第二次材料也不改变工具', () => {
  const harness = createHarness({ wood: 1 });
  try {
    const demand = damageStoneAxe(harness);
    const task = planToolMaintenanceAction({
      person: harness.person,
      camp: harness.campStore.get('starting-camp'),
      actionCounts: {},
    });
    harness.startTask(task);
    const before = harness.toolSystem.get(demand.toolId).durability;

    assert.equal(harness.campStore.take('starting-camp', 'wood', 1, 'external-test-use'), 1);
    const result = completeToolMaintenance({
      agent: { personId: harness.person.id, x: 4, y: 4 },
      task,
      peopleSystem: { get: () => harness.person },
      campStore: harness.campStore,
      gameTime: harness.gameTime,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'maintenance-material-shortage');
    assert.equal(harness.campStore.get('starting-camp').items.wood ?? 0, 0);
    assert.equal(harness.toolSystem.get(demand.toolId).durability, before);
    assert.equal(harness.toolSystem.getMaintenanceDemand(demand.toolId).id, demand.id);

    harness.finishTask(task, 'actions:failed');
    assert.equal(harness.reservationLedger.count({ taskId: task.id }), 0);
    assert.equal(harness.toolMaintenanceRuntime.verify().ok, true);
  } finally {
    harness.restore();
  }
});

test('材料不足或目标工具已被占用时不会规划重复维修任务', () => {
  const shortage = createHarness({ wood: 0 });
  try {
    damageStoneAxe(shortage);
    assert.equal(planToolMaintenanceAction({
      person: shortage.person,
      camp: shortage.campStore.get('starting-camp'),
      actionCounts: {},
    }), null);
  } finally {
    shortage.restore();
  }

  const occupied = createHarness({ wood: 2 });
  try {
    const demand = damageStoneAxe(occupied);
    occupied.reservationLedger.reserve({
      id: 'other-task:tool',
      type: 'tool',
      key: demand.toolId,
      taskId: 'other-task',
      ownerId: 'person-2',
      amount: 1,
      capacity: 1,
    });
    assert.equal(planToolMaintenanceAction({
      person: occupied.person,
      camp: occupied.campStore.get('starting-camp'),
      actionCounts: {},
    }), null);
  } finally {
    occupied.restore();
  }
});
