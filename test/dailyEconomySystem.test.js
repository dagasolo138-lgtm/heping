import test from 'node:test';
import assert from 'node:assert/strict';

import { createDailyEconomySystem } from '../src/modules/economy/dailyEconomySystem.js';
import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';

function createHarness() {
  let time = { year: 1, day: 1, minute: 480, tick: 0, label: '第 1 日 08:00' };
  const people = [{ id: 'person-1', inventory: { items: {} } }];
  const camps = [{ id: 'starting-camp', items: { wood: 2, water: 1, berries: 1 } }];
  let targets = {
    goals: { water: 3, food: 3, wood: 4 },
    amounts: { effective: { water: 1, food: 1, wood: 2 } },
  };
  const runtime = {
    peopleSystem: { list: () => structuredClone(people) },
    campStore: { list: () => structuredClone(camps) },
    toolSystem: { list: () => [] },
    stockTargetSystem: { get: () => structuredClone(targets) },
  };
  const gameTime = {
    stamp: () => structuredClone(time),
    now: () => structuredClone(time),
  };
  const flow = createResourceFlowSystem({ gameTime, getRuntime: () => runtime, maxEntries: 200 });
  const daily = createDailyEconomySystem({ gameTime, resourceFlowSystem: flow, getRuntime: () => runtime });
  return {
    daily,
    flow,
    people,
    camps,
    runtime,
    setTime(next) { time = { ...time, ...next }; },
    setTargets(next) { targets = structuredClone(next); },
  };
}

function record(flow, input) {
  flow.record({
    tick: input.tick ?? 1,
    time: input.time ?? { year: 1, day: 1, minute: 500, tick: input.tick ?? 1, label: '第 1 日' },
    unit: 'units',
    ...input,
  });
}

test('日级对账将生产与消耗解释为期初期末库存变化', () => {
  const harness = createHarness();
  record(harness.flow, { itemId: 'wood', amount: 3, from: 'map:feature:tree-1', to: 'camp:starting-camp', category: 'production', reason: 'chopTree' });
  record(harness.flow, { itemId: 'water', amount: 1, from: 'camp:starting-camp', to: 'needs:person-1', category: 'consumption', reason: 'drink' });
  harness.camps[0].items.wood = 5;
  harness.camps[0].items.water = 0;

  const report = harness.daily.getCurrentReport();
  assert.equal(report.balances.wood.actualDelta, 3);
  assert.equal(report.balances.wood.expectedDelta, 3);
  assert.equal(report.balances.water.actualDelta, -1);
  assert.equal(report.balances.water.expectedDelta, -1);
  assert.equal(report.ok, true);
});

test('播种把真实粟种记为 planting 出库并保持日报守恒', () => {
  const harness = createHarness();
  harness.camps[0].items.milletSeed = 2;
  harness.daily.reset();
  record(harness.flow, {
    itemId: 'milletSeed',
    amount: 1,
    from: 'person:person-1',
    to: 'farm:field-1',
    category: 'planting',
    reason: 'sowMillet',
  });
  harness.camps[0].items.milletSeed = 1;

  const report = harness.daily.getCurrentReport();
  assert.equal(report.flow.byCategory.planting, 1);
  assert.equal(report.balances.milletSeed.planting, 1);
  assert.equal(report.balances.milletSeed.expectedDelta, -1);
  assert.equal(report.balances.milletSeed.actualDelta, -1);
  assert.equal(report.balances.milletSeed.discrepancy, 0);
  assert.equal(report.ok, true);
  assert.equal(harness.daily.verify().ok, true);
});

test('劳动分配、完成和生存拒绝进入日报与瓶颈', () => {
  const harness = createHarness();
  const task = {
    id: 'task-1',
    type: 'chopTree',
    data: { laborCost: { expectedDuration: 18, expectedEnergy: 4.5 } },
  };
  harness.daily.observe('actions:assigned', { personId: 'person-1', task });
  harness.daily.observe('actions:completed', { personId: 'person-1', task });
  harness.daily.observe('survival:resource-denied', { personId: 'person-1', need: 'water', deniedReason: 'noWater' });

  const report = harness.daily.getCurrentReport();
  assert.equal(report.labor.assigned, 1);
  assert.equal(report.labor.completed, 1);
  assert.equal(report.labor.expectedSeconds, 18);
  assert.equal(report.labor.expectedEnergy, 4.5);
  assert.equal(report.denials.water, 1);
  assert.ok(report.bottlenecks.some((entry) => entry.type === 'survival-shortage'));
});

test('跨日时锁定前一日报告并以当前库存作为新日期初', () => {
  const harness = createHarness();
  record(harness.flow, { itemId: 'wood', amount: 1, from: 'world:production', to: 'camp:starting-camp', category: 'production' });
  harness.camps[0].items.wood = 3;
  harness.setTime({ day: 2, minute: 0, tick: 960, label: '第 2 日 00:00' });
  harness.daily.observe('simulation:pre-tick', {});

  const previous = harness.daily.getReport(1, 1);
  const current = harness.daily.getCurrentReport();
  assert.equal(previous.closingInventory.byItem.wood, 3);
  assert.equal(current.openingInventory.byItem.wood, 3);
  assert.equal(current.day, 2);
});

test('库存目标缺口和腐败压力形成可解释瓶颈', () => {
  const harness = createHarness();
  record(harness.flow, { itemId: 'berries', amount: 2, from: 'map:feature:berries', to: 'camp:starting-camp', category: 'production' });
  record(harness.flow, { itemId: 'berries', amount: 1, from: 'camp:starting-camp', to: 'waste:spoilage', category: 'spoilage' });
  harness.camps[0].items.berries = 2;

  const report = harness.daily.getCurrentReport();
  assert.ok(report.bottlenecks.some((entry) => entry.type === 'stock-gap' && entry.itemId === 'water'));
  assert.ok(report.bottlenecks.some((entry) => entry.type === 'spoilage-pressure'));
});

test('存档往返保留历史日报和当前劳动草稿', () => {
  const harness = createHarness();
  harness.daily.observe('actions:assigned', { task: { id: 'task-1', type: 'fetchWater', data: { laborCost: { expectedDuration: 5, expectedEnergy: 1 } } } });
  harness.setTime({ day: 2, minute: 0, tick: 960 });
  harness.daily.observe('simulation:pre-tick', {});
  const saved = harness.daily.exportState();

  const restored = createHarness();
  restored.setTime({ day: 2, minute: 0, tick: 960 });
  restored.daily.importState(saved);
  assert.equal(restored.daily.getReport(1, 1).labor.assigned, 1);
  assert.equal(restored.daily.getCurrentReport().day, 2);
  assert.equal(restored.daily.verify().ok, true);
});

test('账实不符会被日报和总校验同时报告', () => {
  const harness = createHarness();
  record(harness.flow, { itemId: 'wood', amount: 2, from: 'world:production', to: 'camp:starting-camp', category: 'production' });
  harness.camps[0].items.wood = 3;

  const report = harness.daily.getCurrentReport();
  assert.equal(report.balances.wood.discrepancy, -1);
  assert.equal(report.ok, false);
  const verification = harness.daily.verify();
  assert.equal(verification.ok, false);
  assert.ok(verification.issues.some((issue) => issue.type === 'inventory-mismatch'));
});
