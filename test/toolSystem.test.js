import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../src/core/events/eventBus.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { buildLaborCostProfile } from '../src/modules/actions/laborCostModel.js';
import { createReservationLedger } from '../src/modules/actions/reservationLedger.js';
import { createToolSystem } from '../src/modules/tools/toolSystem.js';

function createHarness() {
  const eventBus = createEventBus();
  const gameTime = createGameTime({ year: 1, day: 1, minute: 480 });
  const reservationLedger = createReservationLedger();
  const runtime = { actionSystem: { getRenderPeople: () => [] } };
  const toolSystem = createToolSystem({
    eventBus,
    gameTime,
    reservationLedger,
    getRuntime: () => runtime,
  });
  runtime.toolSystem = toolSystem;
  return { eventBus, gameTime, reservationLedger, runtime, toolSystem };
}

function task(id, type, toolId = null) {
  return {
    id,
    type,
    workDuration: 4,
    destination: { x: 4, y: 0 },
    data: toolId ? { laborCost: { tool: { id: toolId } } } : {},
  };
}

const person = {
  id: 'person-1',
  identity: { alive: true },
  location: { tileX: 0, tileY: 0 },
  state: { energy: 100 },
  work: { skills: { woodcutting: 0, gathering: 0, building: 0 } },
  inventory: { items: {} },
};

const mapSystem = {
  getTerrainAt: () => 0,
  getTile: () => ({ terrain: 0 }),
};
const roadSystem = { getMovementMultiplierAt: () => 1 };
const weather = { movementMultiplier: 1, workMultiplier: 1 };

test('初始公共工具包含石斧、搬运篮、简易农具和石镐', () => {
  const { toolSystem } = createHarness();
  assert.deepEqual(toolSystem.list().map((tool) => tool.typeId).sort(), [
    'carryingBasket', 'simpleFarmTool', 'stoneAxe', 'stonePick',
  ]);
  assert.deepEqual(toolSystem.getSummary(), {
    total: 4,
    usable: 4,
    broken: 0,
    reserved: 0,
    averageCondition: 1,
  });
});

test('同一件工具不能被两个任务同时占用', () => {
  const { toolSystem, reservationLedger } = createHarness();
  const first = toolSystem.reserveForTask({ task: task('task-1', ACTION_TYPES.CHOP_TREE), personId: 'person-1' });
  const second = toolSystem.reserveForTask({ task: task('task-2', ACTION_TYPES.CHOP_TREE), personId: 'person-2' });
  assert.equal(first.toolId, 'tool-stone-axe-1');
  assert.equal(second, null);
  assert.equal(reservationLedger.count({ type: 'tool', key: 'tool-stone-axe-1' }), 1);
});

test('任务完成扣除耐久并释放工具占用', () => {
  const { toolSystem, reservationLedger } = createHarness();
  const chop = task('task-1', ACTION_TYPES.CHOP_TREE);
  toolSystem.reserveForTask({ task: chop, personId: 'person-1' });
  const before = toolSystem.get('tool-stone-axe-1').durability;
  const result = toolSystem.completeTask({ task: chop, personId: 'person-1' });
  assert.equal(result.wear, 2.4);
  assert.equal(toolSystem.get('tool-stone-axe-1').durability, before - 2.4);
  assert.equal(reservationLedger.count({ type: 'tool' }), 0);
  assert.equal(toolSystem.getAssignments().length, 0);
});

test('取消和孤立任务释放工具但不产生磨损', () => {
  const { toolSystem, reservationLedger } = createHarness();
  const first = task('task-cancel', ACTION_TYPES.HAUL_TO_CAMP);
  toolSystem.reserveForTask({ task: first, personId: 'person-1' });
  const before = toolSystem.get('tool-carrying-basket-1').durability;
  toolSystem.releaseTask(first.id);
  assert.equal(toolSystem.get('tool-carrying-basket-1').durability, before);

  const second = task('task-orphan', ACTION_TYPES.HAUL_TO_CAMP);
  toolSystem.reserveForTask({ task: second, personId: 'person-1' });
  toolSystem.reconcile(new Set());
  assert.equal(reservationLedger.count({ type: 'tool' }), 0);
  assert.equal(toolSystem.getAssignments().length, 0);
  assert.equal(toolSystem.get('tool-carrying-basket-1').durability, before);
});

test('损坏工具退出候选列表，修理后恢复可用', () => {
  const { toolSystem } = createHarness();
  toolSystem.applyWear('tool-stone-axe-1', 999);
  assert.equal(toolSystem.get('tool-stone-axe-1').status, 'broken');
  assert.equal(toolSystem.previewForAction(ACTION_TYPES.CHOP_TREE), null);
  toolSystem.repair('tool-stone-axe-1', 20);
  assert.equal(toolSystem.get('tool-stone-axe-1').status, 'usable');
  assert.equal(toolSystem.previewForAction(ACTION_TYPES.CHOP_TREE).id, 'tool-stone-axe-1');
});

test('工具耐久可存档，运行时占用不进入长期存档', () => {
  const { toolSystem } = createHarness();
  toolSystem.applyWear('tool-simple-farm-tool-1', 12);
  toolSystem.reserveForTask({ task: task('task-farm', ACTION_TYPES.CLEAR_FIELD), personId: 'person-1' });
  const snapshot = toolSystem.exportState();
  assert.equal(snapshot.tools.find((tool) => tool.id === 'tool-simple-farm-tool-1').durability, 72);
  assert.equal('assignments' in snapshot, false);

  toolSystem.resetToDefaults();
  toolSystem.importState(snapshot);
  assert.equal(toolSystem.get('tool-simple-farm-tool-1').durability, 72);
  assert.equal(toolSystem.getAssignments().length, 0);
});

test('失败读档检查点可以恢复工具耐久与运行时占用', () => {
  const { toolSystem } = createHarness();
  const chop = task('task-live', ACTION_TYPES.CHOP_TREE);
  toolSystem.reserveForTask({ task: chop, personId: 'person-1' });
  toolSystem.applyWear('tool-stone-axe-1', 3);
  const checkpoint = toolSystem.createCheckpoint();

  toolSystem.resetToDefaults();
  toolSystem.restoreCheckpoint(checkpoint);
  assert.equal(toolSystem.get('tool-stone-axe-1').durability, 69);
  assert.equal(toolSystem.getAssignments()[0].taskId, 'task-live');
});

test('石斧降低伐木耗时和能耗，搬运篮降低有效负重', () => {
  const harness = createHarness();
  const originalRuntime = globalThis.shengling;
  try {
    globalThis.shengling = { toolSystem: harness.toolSystem };
    const bareTask = task('bare', ACTION_TYPES.CHOP_TREE);
    harness.toolSystem.applyWear('tool-stone-axe-1', 999);
    const bare = buildLaborCostProfile({
      person,
      task: bareTask,
      position: { x: 0, y: 0 },
      route: [{ x: 4, y: 0 }],
      mapSystem,
      roadSystem,
      weather,
    });

    harness.toolSystem.repair('tool-stone-axe-1', Infinity);
    const equipped = buildLaborCostProfile({
      person,
      task: task('equipped', ACTION_TYPES.CHOP_TREE),
      position: { x: 0, y: 0 },
      route: [{ x: 4, y: 0 }],
      mapSystem,
      roadSystem,
      weather,
    });
    assert.equal(equipped.tool.id, 'tool-stone-axe-1');
    assert.ok(equipped.effectiveWorkDuration < bare.effectiveWorkDuration);
    assert.ok(equipped.expectedEnergy < bare.expectedEnergy);

    const loadedPerson = { ...person, inventory: { items: { wood: 10 } } };
    const basket = buildLaborCostProfile({
      person: loadedPerson,
      task: task('haul', ACTION_TYPES.HAUL_TO_CAMP),
      position: { x: 0, y: 0 },
      route: [{ x: 4, y: 0 }],
      mapSystem,
      roadSystem,
      weather,
    });
    assert.equal(basket.tool.id, 'tool-carrying-basket-1');
    assert.ok(basket.effectiveLoadWeight < basket.loadWeight);
  } finally {
    globalThis.shengling = originalRuntime;
  }
});
