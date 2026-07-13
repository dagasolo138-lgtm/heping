import test from 'node:test';
import assert from 'node:assert/strict';

import { createWorldDynamicsSystem } from '../src/modules/dynamics/worldDynamicsSystem.js';

function createClock() {
  let time = { year: 1, day: 1, minute: 0, tick: 0 };
  return {
    stamp: () => structuredClone(time),
    set(next) { time = { ...time, ...next }; },
  };
}

function report(day, overrides = {}) {
  return {
    year: 1,
    day,
    openedAt: { year: 1, day, minute: 0, tick: day * 1440 },
    closedAt: { year: 1, day, minute: 1439, tick: day * 1440 + 1439 },
    stockTargets: { goals: { food: 10, water: 8, wood: 6 } },
    stockGaps: {},
    closingInventory: { byItem: { food: 10, water: 8, wood: 6 } },
    denials: { total: 0, food: 0, water: 0 },
    flow: { byCategory: { production: 10, spoilage: 0 } },
    labor: { assigned: 4, completed: 4, cancelled: 0, failed: 0 },
    ...overrides,
  };
}

test('持续两日的库存压力形成承诺，压力解除后承诺完成', () => {
  const clock = createClock();
  const system = createWorldDynamicsSystem({ gameTime: clock, getRuntime: () => ({}) });

  system.evaluate(report(1, { stockGaps: { food: 5 } }), {});
  let pressure = system.listPressures({ state: 'active' })[0];
  assert.equal(pressure.signature, 'stock-gap:food');
  assert.equal(pressure.persistenceDays, 1);
  assert.equal(system.listCommitments({ state: 'active' }).length, 0);

  clock.set({ day: 2, tick: 2880 });
  system.evaluate(report(2, { stockGaps: { food: 5 } }), {});
  pressure = system.listPressures({ state: 'active' })[0];
  assert.equal(pressure.persistenceDays, 2);
  const commitment = system.listCommitments({ state: 'active' })[0];
  assert.equal(commitment.type, 'restore-food-reserve');
  assert.equal(commitment.goal.itemId, 'food');

  clock.set({ day: 3, tick: 4320 });
  system.evaluate(report(3), {});
  assert.equal(system.listPressures({ state: 'active' }).length, 0);
  assert.equal(system.listPressures({ state: 'resolved' }).length, 1);
  assert.equal(system.listCommitments({ state: 'completed' })[0].progress, 1);
  assert.equal(system.verify().ok, true);
});

test('同一日报重复评估不会虚增持续天数', () => {
  const clock = createClock();
  const system = createWorldDynamicsSystem({ gameTime: clock, getRuntime: () => ({}) });
  const dayOne = report(1, { stockGaps: { water: 4 } });
  system.evaluate(dayOne, {});
  system.evaluate(dayOne, {});
  assert.equal(system.listPressures({ state: 'active' })[0].persistenceDays, 1);
});

test('雨天播种窗口与库存富余会生成机会', () => {
  const clock = createClock();
  const system = createWorldDynamicsSystem({ gameTime: clock, getRuntime: () => ({}) });
  system.evaluate(report(1, {
    closingInventory: { byItem: { food: 18, water: 8, wood: 6 } },
  }), {
    weather: { id: 'rain', isRain: true },
    farm: { sowable: 1, mature: 0, seed: { onHand: 2, shortage: 0 }, soil: {}, total: 1 },
  });
  const signatures = system.listOpportunities({ state: 'active' }).map((entry) => entry.signature).sort();
  assert.deepEqual(signatures, ['farm:rain-sowing-window', 'surplus:food']);
});

test('状态可导出、恢复并保持确定摘要', () => {
  const clock = createClock();
  const first = createWorldDynamicsSystem({ gameTime: clock, getRuntime: () => ({}) });
  first.evaluate(report(1, { denials: { total: 3, food: 3, water: 0 } }), {});
  const snapshot = first.exportState();

  const second = createWorldDynamicsSystem({ gameTime: clock, getRuntime: () => ({}) });
  second.importState(snapshot);
  assert.deepEqual(second.getSummary(), first.getSummary());
  assert.equal(second.verify().ok, true);
  assert.throws(() => second.importState({ ...snapshot, schemaVersion: 99 }), /格式不兼容/);
});
