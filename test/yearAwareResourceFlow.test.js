import test from 'node:test';
import assert from 'node:assert/strict';

import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';
import { createYearAwareResourceFlowView } from '../src/modules/economy/yearAwareResourceFlowView.js';

function createHarness() {
  let time = { year: 2, day: 1, minute: 0, tick: 1000, label: '第 2 年第 1 日' };
  const runtime = {
    peopleSystem: { list: () => [] },
    campStore: { list: () => [] },
    toolSystem: { list: () => [] },
  };
  const gameTime = {
    stamp: () => structuredClone(time),
    now: () => structuredClone(time),
  };
  const base = createResourceFlowSystem({ gameTime, getRuntime: () => runtime, maxEntries: 100 });
  const system = createYearAwareResourceFlowView({ resourceFlowSystem: base, gameTime });
  return {
    base,
    system,
    setTime(next) { time = { ...time, ...next }; },
  };
}

function record(base, { year, day, tick, itemId, amount, category = 'production' }) {
  base.record({
    tick,
    time: { year, day, minute: 60, tick, label: `${year}:${day}` },
    itemId,
    amount,
    unit: 'units',
    from: category === 'production' ? 'world:production' : 'camp:starting-camp',
    to: category === 'production' ? 'camp:starting-camp' : 'needs:population',
    category,
  });
}

test('同一日号的不同年份不会在查询中合并', () => {
  const harness = createHarness();
  record(harness.base, { year: 1, day: 1, tick: 10, itemId: 'berries', amount: 2 });
  record(harness.base, { year: 2, day: 1, tick: 1010, itemId: 'wood', amount: 4 });
  record(harness.base, { year: 2, day: 2, tick: 1970, itemId: 'water', amount: 3 });

  assert.equal(harness.system.list({ day: 1 }).length, 2);
  assert.deepEqual(harness.system.list({ year: 1, day: 1 }).map((entry) => entry.itemId), ['berries']);
  assert.deepEqual(harness.system.list({ year: 2, day: 1 }).map((entry) => entry.itemId), ['wood']);

  const firstYear = harness.system.getDailySummary(1, 1);
  const secondYear = harness.system.getDailySummary(2, 1);
  assert.deepEqual(firstYear.byItem, { berries: 2 });
  assert.deepEqual(secondYear.byItem, { wood: 4 });
});

test('单参数旧接口按当前年份解释，且支持对象参数', () => {
  const harness = createHarness();
  record(harness.base, { year: 1, day: 1, tick: 10, itemId: 'berries', amount: 2 });
  record(harness.base, { year: 2, day: 1, tick: 1010, itemId: 'wood', amount: 4 });

  harness.setTime({ year: 2, day: 1 });
  assert.deepEqual(harness.system.getDailySummary(1).byItem, { wood: 4 });
  assert.deepEqual(harness.system.getDailySummary({ year: 1, day: 1 }).byItem, { berries: 2 });
});

test('limit 在年份和日期筛选完成后应用', () => {
  const harness = createHarness();
  record(harness.base, { year: 1, day: 1, tick: 10, itemId: 'berries', amount: 1 });
  record(harness.base, { year: 2, day: 1, tick: 1010, itemId: 'wood', amount: 1 });
  record(harness.base, { year: 2, day: 1, tick: 1011, itemId: 'water', amount: 1 });

  const selected = harness.system.list({ year: 2, day: 1, limit: 1 });
  assert.equal(selected.length, 1);
  assert.equal(selected[0].itemId, 'water');
});
