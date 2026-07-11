import test from 'node:test';
import assert from 'node:assert/strict';

import { createLongRunAuditWorld } from '../scripts/longRunAuditWorld.js';

test('运行世界会把低耐久工具转化为真实维修任务并恢复生产能力', { timeout: 180_000 }, () => {
  const world = createLongRunAuditWorld('v0281-maintenance-world');
  try {
    world.camp.change('starting-camp', 'wood', 8, 'maintenance-test-stock');
    world.tools.applyWear('tool-stone-axe-1', 60);
    const before = world.tools.get('tool-stone-axe-1').durability;
    const demand = world.tools.getMaintenanceDemand('tool-stone-axe-1');
    assert.ok(demand);

    world.actions.advanceTicks(1_200);

    const after = world.tools.get('tool-stone-axe-1');
    const repairTasks = world.taskLifecycle.list({ type: 'repairTool' });
    const repairFlows = world.resourceFlow.list({ category: 'repair' });
    assert.ok(after.durability > before, `维修后耐久未提高：${before} -> ${after.durability}`);
    assert.equal(world.tools.getMaintenanceDemand(after.id), null);
    assert.ok(repairTasks.some((record) => record.status === 'completed'), '没有已完成的维修任务');
    assert.ok(repairFlows.some((entry) => entry.itemId === 'wood'), '没有维修材料流水');
    assert.ok(repairFlows.some((entry) => entry.itemId === 'durability:stoneAxe'), '没有耐久恢复流水');
    assert.equal(world.toolMaintenanceRuntime.verify().ok, true);
    assert.equal(world.resourceFlow.verify().ok, true);
    assert.equal(world.dailyEconomy.verify().ok, true);
  } finally {
    world.restoreGlobals();
  }
});
