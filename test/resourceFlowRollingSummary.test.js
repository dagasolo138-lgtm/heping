import test from 'node:test';
import assert from 'node:assert/strict';

import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';

function createSystem({ maxEntries = 3 } = {}) {
  let tick = 1;
  const events = [];
  const eventBus = {
    emit(eventName, payload) {
      events.push({ eventName, payload: structuredClone(payload) });
    },
  };
  const gameTime = {
    stamp: () => ({ tick, year: 1, day: 1, minute: tick, label: `第 1 日 ${tick}` }),
    now: () => ({ year: 1, day: 1, minute: tick }),
  };
  const runtime = {
    peopleSystem: { list: () => [] },
    campStore: { list: () => [] },
    toolSystem: { list: () => [] },
  };
  const system = createResourceFlowSystem({ eventBus, gameTime, getRuntime: () => runtime, maxEntries });
  return {
    system,
    events,
    setTick(value) { tick = value; },
  };
}

function record(system, { itemId, amount, category }) {
  return system.record({
    itemId,
    amount,
    category,
    from: 'world:production',
    to: 'camp:starting-camp',
    reason: 'test',
  });
}

test('资源流水滚动摘要在记录淘汰后保持精确', () => {
  const harness = createSystem({ maxEntries: 3 });
  record(harness.system, { itemId: 'wood', amount: 2, category: 'production' });
  record(harness.system, { itemId: 'water', amount: 4, category: 'production' });
  record(harness.system, { itemId: 'wood', amount: 1, category: 'transfer' });
  record(harness.system, { itemId: 'berries', amount: 3, category: 'production' });

  assert.deepEqual(harness.system.getSummary({ skipFlush: true }), {
    totalEntries: 3,
    pending: 0,
    byItem: { water: 4, wood: 1, berries: 3 },
    byCategory: { production: 7, transfer: 1 },
  });

  const recorded = harness.events.filter((event) => event.eventName === 'resource-flow:recorded');
  assert.equal(recorded.length, 4);
  assert.deepEqual(recorded.at(-1).payload.summary, harness.system.getSummary({ skipFlush: true }));
});

test('资源流水导入后会重建滚动摘要', () => {
  const source = createSystem({ maxEntries: 3 });
  record(source.system, { itemId: 'wood', amount: 2, category: 'production' });
  record(source.system, { itemId: 'water', amount: 4, category: 'transfer' });
  const snapshot = source.system.exportState();

  const target = createSystem({ maxEntries: 3 });
  target.system.importState(snapshot);

  assert.deepEqual(target.system.getSummary({ skipFlush: true }), {
    totalEntries: 2,
    pending: 0,
    byItem: { wood: 2, water: 4 },
    byCategory: { production: 2, transfer: 4 },
  });
  assert.equal(target.system.verify().ok, true);
});

test('流水达到容量上限后 flush 仍返回本轮新增记录', () => {
  const harness = createSystem({ maxEntries: 2 });
  record(harness.system, { itemId: 'wood', amount: 1, category: 'production' });
  record(harness.system, { itemId: 'water', amount: 1, category: 'production' });

  harness.setTick(2);
  harness.system.enqueue({
    account: 'camp:starting-camp',
    itemId: 'berries',
    delta: 2,
    actionType: 'gatherBerries',
    reason: 'inventory:item',
  });
  const flushed = harness.system.flush();

  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].itemId, 'berries');
  assert.deepEqual(harness.system.list().map((entry) => entry.itemId), ['water', 'berries']);
  assert.deepEqual(harness.system.getSummary({ skipFlush: true }), {
    totalEntries: 2,
    pending: 0,
    byItem: { water: 1, berries: 2 },
    byCategory: { production: 3 },
  });
});
