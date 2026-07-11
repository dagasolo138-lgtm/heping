import test from 'node:test';
import assert from 'node:assert/strict';

import { createLongRunAuditWorld } from '../scripts/longRunAuditWorld.js';
import { createWorldSaveSystem } from '../src/modules/persistence/worldSaveSystem.js';

test('失败读档会同时恢复维修任务、统一预留和维修运行时', { timeout: 180_000 }, () => {
  const world = createLongRunAuditWorld('v0281-maintenance-save-rollback');
  try {
    world.camp.change('starting-camp', 'wood', 8, 'maintenance-test-stock');
    world.tools.applyWear('tool-stone-axe-1', 60);

    for (let index = 0; index < 2_000 && world.toolMaintenanceRuntime.listReservations().length === 0; index += 1) {
      world.actions.advanceTicks(1);
    }
    const beforeMaintenance = world.toolMaintenanceRuntime.createCheckpoint();
    const beforeAction = world.actions.createRuntimeCheckpoint();
    assert.equal(beforeMaintenance.reservations.length, 1, '没有进入维修任务执行阶段');
    const taskId = beforeMaintenance.reservations[0].taskId;
    assert.ok(beforeAction.agents.some((agent) => agent.task?.id === taskId));

    let refreshCalls = 0;
    world.runtime.mapView = {
      setMap() {
        refreshCalls += 1;
        if (refreshCalls === 1) throw new Error('注入地图刷新失败');
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
      /读取世界存档失败，已恢复读取前状态：注入地图刷新失败/,
    );

    const afterMaintenance = world.toolMaintenanceRuntime.createCheckpoint();
    const afterAction = world.actions.createRuntimeCheckpoint();
    assert.deepEqual(afterMaintenance, beforeMaintenance);
    assert.deepEqual(
      afterAction.agents.find((agent) => agent.task?.id === taskId),
      beforeAction.agents.find((agent) => agent.task?.id === taskId),
    );
    beforeMaintenance.reservations[0].reservationIds.forEach((reservationId) => {
      assert.ok(world.reservationLedger.list().some((entry) => entry.id === reservationId), `缺少回滚后的维修预留：${reservationId}`);
    });
    assert.equal(world.toolMaintenanceRuntime.verify().ok, true);
  } finally {
    world.restoreGlobals();
  }
});
