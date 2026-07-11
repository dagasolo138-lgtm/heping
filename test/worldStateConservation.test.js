import test from 'node:test';
import assert from 'node:assert/strict';

import { createLongRunAuditWorld } from '../scripts/longRunAuditWorld.js';

function round(value) {
  return Math.round(Number(value ?? 0) * 1000) / 1000;
}

test('运行世界中的任务、预留、工具与营地库存保持一致', { timeout: 180_000 }, () => {
  const world = createLongRunAuditWorld('v0277-world-state-conservation');
  try {
    world.actions.advanceTicks(720);

    const diagnostics = world.actions.getDiagnostics();
    const lifecycle = world.taskLifecycle.verify();
    const resourceFlow = world.resourceFlow.verify();
    const economy = world.dailyEconomy.verify();
    const alivePeople = world.people.getAliveRuntime();
    const activeTasks = world.taskLifecycle.list({ status: 'active' });
    const activeTaskIds = new Set(activeTasks.map((record) => record.taskId));
    const activePersonIds = activeTasks.map((record) => record.personId);
    const reservations = world.reservationLedger.list();
    const reservationIds = reservations.map((entry) => entry.id);
    const toolAssignments = world.tools.getAssignments();

    assert.equal(diagnostics.lastSimulationError, null);
    assert.equal(lifecycle.ok, true, JSON.stringify(lifecycle.issues));
    assert.equal(resourceFlow.ok, true, JSON.stringify(resourceFlow.issues));
    assert.equal(economy.ok, true, JSON.stringify(economy.issues));
    assert.ok(activeTasks.length <= alivePeople.length);
    assert.equal(new Set(activePersonIds).size, activePersonIds.length, '同一人物存在多个活动任务');
    assert.equal(new Set(reservationIds).size, reservationIds.length, '存在重复预留 ID');

    reservations.forEach((entry) => {
      if (entry.taskId) assert.ok(activeTaskIds.has(entry.taskId), `发现孤立预留：${entry.id}`);
      assert.ok(Number(entry.amount) > 0, `预留数量无效：${entry.id}`);
    });

    activeTasks.forEach((record) => {
      const slots = reservations.filter((entry) => entry.taskId === record.taskId && entry.type === 'task-slot');
      assert.equal(slots.length, 1, `活动任务缺少唯一 task-slot：${record.taskId}`);
    });

    toolAssignments.forEach((assignment) => {
      assert.ok(activeTaskIds.has(assignment.taskId), `发现孤立工具占用：${assignment.taskId}`);
      assert.ok(
        reservations.some((entry) => entry.id === assignment.reservationId && entry.type === 'tool'),
        `工具占用缺少预留：${assignment.taskId}`,
      );
    });

    world.tools.list().forEach((tool) => {
      assert.ok(tool.durability >= 0, `工具耐久为负：${tool.id}`);
      assert.ok(tool.durability <= tool.maxDurability, `工具耐久超过上限：${tool.id}`);
    });

    world.people.list().forEach((person) => {
      Object.entries(person.inventory?.items ?? {}).forEach(([itemId, amount]) => {
        assert.ok(Number(amount) >= 0, `人物库存为负：${person.id}/${itemId}`);
      });
    });

    world.camp.list().forEach((camp) => {
      const storage = world.camp.getStorage(camp.id);
      assert.ok(storage.used <= storage.capacity, `营地库存超过容量：${camp.id}`);
      assert.equal(round(storage.available), round(Math.max(0, storage.capacity - storage.used)));
      Object.entries(camp.items ?? {}).forEach(([itemId, amount]) => {
        assert.ok(Number(amount) >= 0, `营地库存为负：${camp.id}/${itemId}`);
      });

      const food = world.camp.getFoodSummary(camp.id);
      ['berries', 'millet'].forEach((itemId) => {
        assert.equal(
          round(food.items[itemId].amount),
          round(camp.items?.[itemId] ?? 0),
          `食物批次与营地库存不一致：${camp.id}/${itemId}`,
        );
      });
    });
  } finally {
    world.restoreGlobals();
  }
});
