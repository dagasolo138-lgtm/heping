import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../src/core/events/eventBus.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { createReservationLedger } from '../src/modules/actions/reservationLedger.js';
import { completeToolMaintenance } from '../src/modules/actions/toolMaintenanceEffects.js';
import { planToolMaintenanceAction } from '../src/modules/actions/toolMaintenancePlanner.js';
import { createToolMaintenanceRuntime } from '../src/modules/actions/toolMaintenanceRuntime.js';
import { createDailyEconomySystem } from '../src/modules/economy/dailyEconomySystem.js';
import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';
import { createToolMaintenanceResourceFlowView } from '../src/modules/economy/toolMaintenanceResourceFlowView.js';
import { createYearAwareResourceFlowView } from '../src/modules/economy/yearAwareResourceFlowView.js';
import { createCampStore } from '../src/modules/settlements/campStore.js';
import { createToolSystem } from '../src/modules/tools/toolSystem.js';

function createHarness({ wood = 8 } = {}) {
  const previousRuntime = globalThis.shengling;
  const previousBus = globalThis.__shenglingEventBus;
  const eventBus = createEventBus();
  const gameTime = createGameTime({ year: 1, day: 1, minute: 480 });
  const reservationLedger = createReservationLedger();
  const campStore = createCampStore({ eventBus, gameTime });
  campStore.create({
    id: 'starting-camp',
    label: '起始营地',
    anchor: { x: 4, y: 4 },
    items: { wood },
    capacity: 24,
  });
  const person = {
    id: 'person-1',
    identity: { name: '测试匠人', alive: true },
    location: { tileX: 4, tileY: 4 },
    work: { skills: { building: 3, gathering: 1 } },
    inventory: { items: {} },
    activity: { current: null },
  };
  const active = new Map();
  const runtime = {
    gameTime,
    campStore,
    reservationLedger,
    peopleSystem: { list: () => [structuredClone(person)] },
    actionSystem: {
      getRenderPeople: () => [{ ...structuredClone(person), activity: { current: active.get(person.id) ?? null } }],
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

  const baseFlow = createResourceFlowSystem({ eventBus, gameTime, getRuntime: () => runtime });
  const yearAware = createYearAwareResourceFlowView({ resourceFlowSystem: baseFlow, gameTime });
  const resourceFlow = createToolMaintenanceResourceFlowView({ resourceFlowSystem: yearAware });
  runtime.resourceFlowSystem = resourceFlow;
  eventBus.on('*', ({ eventName, payload }) => baseFlow.observe(eventName, payload));

  const dailyEconomy = createDailyEconomySystem({
    eventBus,
    gameTime,
    resourceFlowSystem: resourceFlow,
    getRuntime: () => runtime,
  });
  runtime.dailyEconomySystem = dailyEconomy;
  eventBus.on('*', ({ eventName, payload }) => dailyEconomy.observe(eventName, payload));

  function startTask(task) {
    active.set(person.id, { id: task.id, type: task.type, label: task.label });
    eventBus.emit('actions:assigned', { personId: person.id, task: structuredClone(task), time: gameTime.stamp() });
  }

  function finishTask(task, result = null, eventName = 'actions:completed') {
    active.delete(person.id);
    eventBus.emit(eventName, {
      personId: person.id,
      task: structuredClone(task),
      taskId: task.id,
      result: structuredClone(result),
      time: gameTime.stamp(),
    });
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
    person,
    runtime,
    toolSystem,
    toolMaintenanceRuntime,
    resourceFlow,
    dailyEconomy,
    startTask,
    finishTask,
    restore,
  };
}

function forceReplacementDemand(harness, { broken = false } = {}) {
  const toolId = 'tool-stone-axe-1';
  for (let cycle = 0; cycle < 2; cycle += 1) {
    harness.toolSystem.applyWear(toolId, 999);
    harness.toolSystem.repair(toolId, Infinity);
  }
  harness.toolSystem.applyWear(toolId, broken ? 999 : 50);
  const demand = harness.toolSystem.getMaintenanceDemand(toolId);
  assert.equal(demand.mode, 'replace');
  return demand;
}

test('真实替换任务预留工具与材料，完成后开启新一代并记录替换流水', () => {
  const harness = createHarness({ wood: 8 });
  try {
    const demand = forceReplacementDemand(harness);
    const beforeTool = harness.toolSystem.get(demand.toolId);
    const beforeWood = harness.campStore.get('starting-camp').items.wood;
    const task = planToolMaintenanceAction({
      person: harness.person,
      camp: harness.campStore.get('starting-camp'),
      actionCounts: {},
    });

    assert.equal(task.type, ACTION_TYPES.REPLACE_TOOL);
    assert.equal(task.data.mode, 'replace');
    assert.equal(task.data.demandId, demand.id);
    assert.equal(task.data.generation, beforeTool.generation);
    harness.startTask(task);

    const bundle = harness.toolMaintenanceRuntime.getTaskReservation(task.id);
    assert.equal(bundle.mode, 'replace');
    assert.equal(bundle.actionType, ACTION_TYPES.REPLACE_TOOL);
    assert.equal(bundle.toolId, demand.toolId);
    assert.equal(harness.reservationLedger.count({ type: 'tool', key: demand.toolId }), 1);
    assert.equal(harness.reservationLedger.amount({ type: 'camp-item', key: 'starting-camp:wood' }), 3);

    const result = completeToolMaintenance({
      agent: { personId: harness.person.id, x: 4, y: 4 },
      task,
      peopleSystem: { get: () => harness.person },
      campStore: harness.campStore,
      gameTime: harness.gameTime,
    });
    assert.equal(result.ok, true);
    assert.equal(result.details.mode, 'replace');

    const replaced = harness.toolSystem.get(demand.toolId);
    assert.equal(harness.campStore.get('starting-camp').items.wood, beforeWood - 3);
    assert.equal(replaced.generation, beforeTool.generation + 1);
    assert.equal(replaced.durability, replaced.maxDurability);
    assert.equal(replaced.repairsSinceReplacement, 0);
    assert.equal(replaced.wearSinceReplacement, 0);
    assert.equal(harness.toolSystem.getMaintenanceDemand(replaced.id), null);

    harness.finishTask(task, result);
    assert.equal(harness.reservationLedger.count({ taskId: task.id }), 0);
    assert.equal(harness.toolMaintenanceRuntime.verify().ok, true);

    const replacementEntries = harness.resourceFlow.list({ category: 'replacement' })
      .filter((entry) => entry.taskId === task.id);
    assert.equal(replacementEntries.length, 2);
    assert.ok(replacementEntries.some((entry) => entry.itemId === 'wood'
      && entry.metadata.toolId === demand.toolId
      && entry.metadata.actionType === ACTION_TYPES.REPLACE_TOOL));
    assert.ok(replacementEntries.some((entry) => entry.itemId === 'durability:stoneAxe'
      && entry.metadata.maintenanceMode === 'replace'));
    assert.equal(harness.resourceFlow.verify().ok, true);

    const report = harness.dailyEconomy.getCurrentReport();
    assert.equal(report.flow.byCategory.replacement, 6 + 3);
    assert.equal(report.balances.wood.replacement, 3);
    assert.equal(report.balances.wood.discrepancy, 0);
    assert.equal(report.labor.byAction.replaceTool.assigned, 1);
    assert.equal(report.labor.byAction.replaceTool.completed, 1);
    assert.equal(harness.dailyEconomy.verify().ok, true);
  } finally {
    harness.restore();
  }
});

test('关键工具损坏时最低保障把替换任务提升到最高优先级', () => {
  const harness = createHarness({ wood: 8 });
  try {
    const demand = forceReplacementDemand(harness, { broken: true });
    assert.equal(demand.guaranteeGap, true);
    assert.equal(demand.priority, 'high');
    assert.equal(harness.toolSystem.getSummary().guaranteeGaps, 1);
    const coverage = harness.toolSystem.getCoverage().find((entry) => entry.typeId === 'stoneAxe');
    assert.equal(coverage.gap, 1);
    assert.equal(coverage.protected, true);

    const task = planToolMaintenanceAction({
      person: harness.person,
      camp: harness.campStore.get('starting-camp'),
      actionCounts: {},
    });
    assert.equal(task.type, ACTION_TYPES.REPLACE_TOOL);
    assert.equal(task.data.guaranteeGap, true);
    assert.equal(task.data.utility.score, 100);
    assert.equal(task.data.utility.factors.minimumGuarantee, 80);
  } finally {
    harness.restore();
  }
});

test('替换材料不足或已有维护任务时不会规划第二个任务', () => {
  const shortage = createHarness({ wood: 2 });
  try {
    forceReplacementDemand(shortage);
    assert.equal(planToolMaintenanceAction({
      person: shortage.person,
      camp: shortage.campStore.get('starting-camp'),
      actionCounts: {},
    }), null);
  } finally {
    shortage.restore();
  }

  const capped = createHarness({ wood: 8 });
  try {
    forceReplacementDemand(capped);
    assert.equal(planToolMaintenanceAction({
      person: capped.person,
      camp: capped.campStore.get('starting-camp'),
      actionCounts: { [ACTION_TYPES.REPAIR_TOOL]: 1 },
    }), null);
    assert.equal(planToolMaintenanceAction({
      person: capped.person,
      camp: capped.campStore.get('starting-camp'),
      actionCounts: { [ACTION_TYPES.REPLACE_TOOL]: 1 },
    }), null);
  } finally {
    capped.restore();
  }
});

test('替换执行期间材料被移走时整单失败且不会进入新一代', () => {
  const harness = createHarness({ wood: 3 });
  try {
    const demand = forceReplacementDemand(harness);
    const task = planToolMaintenanceAction({
      person: harness.person,
      camp: harness.campStore.get('starting-camp'),
      actionCounts: {},
    });
    harness.startTask(task);
    const before = harness.toolSystem.get(demand.toolId);
    assert.equal(harness.campStore.take('starting-camp', 'wood', 3, 'external-test-use'), 3);

    const result = completeToolMaintenance({
      agent: { personId: harness.person.id, x: 4, y: 4 },
      task,
      peopleSystem: { get: () => harness.person },
      campStore: harness.campStore,
      gameTime: harness.gameTime,
    });
    assert.equal(result.ok, false);
    assert.equal(result.reason, 'maintenance-material-shortage');
    const after = harness.toolSystem.get(demand.toolId);
    assert.equal(after.generation, before.generation);
    assert.equal(after.durability, before.durability);
    assert.equal(harness.toolSystem.getMaintenanceDemand(after.id).id, demand.id);

    harness.finishTask(task, result, 'actions:failed');
    assert.equal(harness.reservationLedger.count({ taskId: task.id }), 0);
    assert.equal(harness.toolMaintenanceRuntime.verify().ok, true);
  } finally {
    harness.restore();
  }
});
