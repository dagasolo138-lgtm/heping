import test from 'node:test';
import assert from 'node:assert/strict';

import { createLongRunAuditWorld } from '../scripts/longRunAuditWorld.js';
import { createWorldSaveSystem } from '../src/modules/persistence/worldSaveSystem.js';

function forceReplacementDemand(world) {
  const toolId = 'tool-stone-axe-1';
  for (let cycle = 0; cycle < 2; cycle += 1) {
    world.tools.applyWear(toolId, 999);
    world.tools.repair(toolId, Infinity);
  }
  world.tools.applyWear(toolId, 50);
  const demand = world.tools.getMaintenanceDemand(toolId);
  assert.equal(demand.mode, 'replace');
  return demand;
}

test('失败读档会同时恢复替换任务、工具代际、统一预留和维护运行时', { timeout: 180_000 }, () => {
  const world = createLongRunAuditWorld('v0282-replacement-save-rollback');
  try {
    world.camp.change('starting-camp', 'wood', 12, 'replacement-test-stock');
    const demand = forceReplacementDemand(world);

    for (let index = 0; index < 2_000 && world.toolMaintenanceRuntime.listReservations().length === 0; index += 1) {
      world.actions.advanceTicks(1);
    }
    const beforeMaintenance = world.toolMaintenanceRuntime.createCheckpoint();
    const beforeAction = world.actions.createRuntimeCheckpoint();
    const beforeTool = world.tools.get(demand.toolId);
    assert.equal(beforeMaintenance.reservations.length, 1, '没有进入替换任务执行阶段');
    assert.equal(beforeMaintenance.reservations[0].mode, 'replace');
    assert.equal(beforeMaintenance.reservations[0].actionType, 'replaceTool');
    assert.equal(beforeMaintenance.reservations[0].materialReservations[0].amount, 3);
    const taskId = beforeMaintenance.reservations[0].taskId;
    assert.ok(beforeAction.agents.some((agent) => agent.task?.id === taskId && agent.task?.type === 'replaceTool'));

    let refreshCalls = 0;
    world.runtime.mapView = {
      setMap() {
        refreshCalls += 1;
        if (refreshCalls === 1) throw new Error('注入替换任务地图刷新失败');
      },
      redraw() {},
    };

    const saveSystem = createWorldSaveSystem({
      eventBus: world.bus,
      gameTime: world.time,
      peopleSystem: world.people,
      mapSystem: world.map,
      campStore: world.camp,
      campRulesSystem: world.runtime.campRulesSystem,
      buildingSystem: world.buildings,
      fireSystem: world.fire,
      ecologySystem: world.ecology,
      roadSystem: world.roads,
      farmSystem: world.farms,
      foodStorageSystem: world.foodStorage,
      socialEventSystem: world.socialEvents,
      chronicleSystem: world.chronicles,
      getRuntime: () => world.runtime,
    });
    const snapshot = saveSystem.exportSnapshot();

    assert.throws(
      () => saveSystem.importSnapshot(snapshot),
      /读取世界存档失败，已恢复读取前状态：注入替换任务地图刷新失败/,
    );

    const afterMaintenance = world.toolMaintenanceRuntime.createCheckpoint();
    const afterAction = world.actions.createRuntimeCheckpoint();
    const afterTool = world.tools.get(demand.toolId);
    assert.deepEqual(afterMaintenance, beforeMaintenance);
    assert.deepEqual(
      afterAction.agents.find((agent) => agent.task?.id === taskId),
      beforeAction.agents.find((agent) => agent.task?.id === taskId),
    );
    assert.equal(afterTool.generation, beforeTool.generation);
    assert.equal(afterTool.durability, beforeTool.durability);
    assert.equal(afterTool.repairsSinceReplacement, beforeTool.repairsSinceReplacement);
    beforeMaintenance.reservations[0].reservationIds.forEach((reservationId) => {
      assert.ok(world.reservationLedger.list().some((entry) => entry.id === reservationId), `缺少回滚后的替换预留：${reservationId}`);
    });
    assert.equal(world.toolMaintenanceRuntime.verify().ok, true);
    assert.equal(world.tools.verifyMaintenance().ok, true);
  } finally {
    world.restoreGlobals();
  }
});
