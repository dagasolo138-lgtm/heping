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

function completeRepairCycle(toolSystem, toolId = 'tool-stone-axe-1') {
  toolSystem.applyWear(toolId, 999);
  toolSystem.repair(toolId, Infinity);
}

test('初始公共工具包含石斧、搬运篮、简易农具和石镐', () => {
  const { toolSystem } = createHarness();
  assert.deepEqual(toolSystem.list().map((tool) => tool.typeId).sort(), [
    'carryingBasket', 'simpleFarmTool', 'stoneAxe', 'stonePick',
  ]);
  assert.deepEqual(toolSystem.getSummary(), {
    total: 4,
    usable: 4,
    broken: 0,
    low: 0,
    critical: 0,
    maintenanceNeeded: 0,
    urgentMaintenance: 0,
    replacementNeeded: 0,
    guaranteeGaps: 0,
    reserved: 0,
    averageCondition: 1,
  });
  assert.deepEqual(toolSystem.getCoverage().map(({ typeId, required, usable, gap, protected: protectedValue }) => ({
    typeId, required, usable, gap, protected: protectedValue,
  })), [
    { typeId: 'stoneAxe', required: 1, usable: 1, gap: 0, protected: true },
    { typeId: 'carryingBasket', required: 1, usable: 1, gap: 0, protected: true },
    { typeId: 'simpleFarmTool', required: 1, usable: 1, gap: 0, protected: true },
  ]);
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
  assert.equal(toolSystem.get('tool-stone-axe-1').wearSinceReplacement, 2.4);
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

test('工具耐久与代际可存档，运行时占用不进入长期存档', () => {
  const { toolSystem } = createHarness();
  toolSystem.applyWear('tool-simple-farm-tool-1', 12);
  toolSystem.reserveForTask({ task: task('task-farm', ACTION_TYPES.CLEAR_FIELD), personId: 'person-1' });
  const snapshot = toolSystem.exportState();
  assert.equal(snapshot.schemaVersion, 3);
  const stored = snapshot.tools.find((tool) => tool.id === 'tool-simple-farm-tool-1');
  assert.equal(stored.durability, 72);
  assert.equal(stored.generation, 1);
  assert.equal(stored.wearSinceReplacement, 12);
  assert.equal('assignments' in snapshot, false);

  toolSystem.resetToDefaults();
  toolSystem.importState(snapshot);
  assert.equal(toolSystem.get('tool-simple-farm-tool-1').durability, 72);
  assert.equal(toolSystem.get('tool-simple-farm-tool-1').wearSinceReplacement, 12);
  assert.equal(toolSystem.getAssignments().length, 0);
});

test('失败读档检查点可以恢复工具耐久、代际与运行时占用', () => {
  const { toolSystem } = createHarness();
  const chop = task('task-live', ACTION_TYPES.CHOP_TREE);
  toolSystem.reserveForTask({ task: chop, personId: 'person-1' });
  toolSystem.applyWear('tool-stone-axe-1', 3);
  const checkpoint = toolSystem.createCheckpoint();

  toolSystem.resetToDefaults();
  toolSystem.restoreCheckpoint(checkpoint);
  const restored = toolSystem.get('tool-stone-axe-1');
  assert.equal(restored.durability, 69);
  assert.equal(restored.generation, 1);
  assert.equal(restored.wearSinceReplacement, 3);
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

test('低耐久工具生成唯一且稳定的维修需求', () => {
  const { toolSystem } = createHarness();
  toolSystem.applyWear('tool-stone-axe-1', 50);
  const first = toolSystem.getMaintenanceDemand('tool-stone-axe-1');
  assert.equal(first.id, 'tool-maintenance:tool-stone-axe-1');
  assert.equal(first.mode, 'repair');
  assert.equal(first.state, 'requested');
  assert.equal(first.priority, 'normal');
  assert.equal(first.reason, 'low-durability');
  assert.deepEqual(first.materials, { wood: 1 });
  assert.ok(first.targetDurability > first.currentDurability);

  toolSystem.applyWear('tool-stone-axe-1', 1);
  const second = toolSystem.getMaintenanceDemand('tool-stone-axe-1');
  assert.equal(second.id, first.id);
  assert.deepEqual(second.requestedAt, first.requestedAt);
  assert.equal(toolSystem.listMaintenanceDemands().length, 1);
  const verification = toolSystem.verifyMaintenance();
  assert.equal(verification.ok, true, JSON.stringify(verification.errors));
  assert.equal(verification.demandCount, 1);
  assert.equal(verification.replacementDemandCount, 0);
});

test('严重磨损和损坏会把维修需求升级为高优先级并触发最低保障', () => {
  const { toolSystem } = createHarness();
  toolSystem.applyWear('tool-stone-axe-1', 999);
  const demand = toolSystem.getMaintenanceDemand('tool-stone-axe-1');
  assert.equal(demand.state, 'urgent');
  assert.equal(demand.priority, 'high');
  assert.equal(demand.reason, 'broken');
  assert.equal(demand.guaranteeGap, true);
  assert.equal(toolSystem.getSummary().urgentMaintenance, 1);
  assert.equal(toolSystem.getSummary().guaranteeGaps, 1);
  assert.equal(toolSystem.getCoverage().find((entry) => entry.typeId === 'stoneAxe').protected, true);
});

test('部分修理保留原需求，恢复到阈值以上后清除', () => {
  const { toolSystem } = createHarness();
  toolSystem.applyWear('tool-stone-axe-1', 999);
  const original = toolSystem.getMaintenanceDemand('tool-stone-axe-1');

  toolSystem.repair('tool-stone-axe-1', 10);
  const partial = toolSystem.getMaintenanceDemand('tool-stone-axe-1');
  assert.equal(partial.id, original.id);
  assert.deepEqual(partial.requestedAt, original.requestedAt);
  assert.equal(partial.priority, 'high');

  toolSystem.repair('tool-stone-axe-1', 60);
  assert.equal(toolSystem.getMaintenanceDemand('tool-stone-axe-1'), null);
  assert.equal(toolSystem.get('tool-stone-axe-1').condition, 'healthy');
  assert.equal(toolSystem.get('tool-stone-axe-1').repairsSinceReplacement, 2);
  assert.equal(toolSystem.verifyMaintenance().ok, true);
});

test('达到本代维修上限后下一次磨损生成替换需求，替换开启新一代', () => {
  const { toolSystem } = createHarness();
  completeRepairCycle(toolSystem);
  completeRepairCycle(toolSystem);
  const afterRepairs = toolSystem.get('tool-stone-axe-1');
  assert.equal(afterRepairs.repairsSinceReplacement, 2);
  assert.equal(afterRepairs.generation, 1);

  toolSystem.applyWear('tool-stone-axe-1', 50);
  const demand = toolSystem.getMaintenanceDemand('tool-stone-axe-1');
  assert.equal(demand.mode, 'replace');
  assert.equal(demand.id, 'tool-replacement:tool-stone-axe-1');
  assert.equal(demand.reason, 'replacement-required');
  assert.equal(demand.replacementReason, 'repair-limit');
  assert.deepEqual(demand.materials, { wood: 3 });
  assert.equal(toolSystem.getSummary().replacementNeeded, 1);

  const replaced = toolSystem.replace('tool-stone-axe-1');
  assert.equal(replaced.generation, 2);
  assert.equal(replaced.durability, replaced.maxDurability);
  assert.equal(replaced.repairsSinceReplacement, 0);
  assert.equal(replaced.wearSinceReplacement, 0);
  assert.equal(replaced.replacedCount, 1);
  assert.equal(toolSystem.getMaintenanceDemand(replaced.id), null);
  assert.equal(toolSystem.verifyMaintenance().ok, true);
});

test('v1 与 v2 工具存档可迁移到 v3 且不会凭空触发替换', () => {
  [1, 2].forEach((schemaVersion) => {
    const { toolSystem } = createHarness();
    const legacyTools = toolSystem.list().map((tool) => {
      const legacy = { ...tool, schemaVersion };
      delete legacy.generation;
      delete legacy.repairsSinceReplacement;
      delete legacy.wearSinceReplacement;
      if (schemaVersion === 1) {
        delete legacy.condition;
        delete legacy.maintenance;
        delete legacy.replacedCount;
      }
      if (legacy.id === 'tool-stone-axe-1') {
        legacy.durability = 10;
        legacy.status = 'usable';
      }
      return legacy;
    });

    toolSystem.importState({ schemaVersion, tools: legacyTools });
    const migrated = toolSystem.get('tool-stone-axe-1');
    assert.equal(migrated.schemaVersion, 3);
    assert.equal(migrated.generation, 1);
    assert.equal(migrated.repairsSinceReplacement, 0);
    assert.equal(migrated.wearSinceReplacement, 0);
    assert.equal(migrated.condition, 'critical');
    assert.equal(toolSystem.getMaintenanceDemand(migrated.id).mode, 'repair');
    assert.equal(toolSystem.getMaintenanceDemand(migrated.id).priority, 'high');
    assert.equal(toolSystem.verifyMaintenance().ok, true);
  });
});
