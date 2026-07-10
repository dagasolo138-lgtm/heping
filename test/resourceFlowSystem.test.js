import test from 'node:test';
import assert from 'node:assert/strict';
import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';

function createHarness() {
  let tick = 10;
  const people = [{
    id: 'person-1',
    inventory: { items: { wood: 2 } },
    activity: { current: null },
  }];
  const camps = [{ id: 'starting-camp', items: {} }];
  const tools = [{ id: 'tool-axe', typeId: 'stone-axe', durability: 10, maxDurability: 10 }];
  const runtime = {
    peopleSystem: { list: () => structuredClone(people) },
    campStore: { list: () => structuredClone(camps) },
    toolSystem: { list: () => structuredClone(tools) },
  };
  const gameTime = {
    stamp: () => ({ tick, year: 1, day: 1, minute: tick, label: `第 1 日 ${tick}` }),
    now: () => ({ year: 1, day: 1, minute: tick }),
  };
  const system = createResourceFlowSystem({ gameTime, getRuntime: () => runtime, maxEntries: 100 });
  return {
    system,
    people,
    camps,
    tools,
    setTick(value) { tick = value; },
  };
}

function observePerson(harness, reason = 'inventory:item') {
  harness.system.observe('people:changed', { reason, person: structuredClone(harness.people[0]) });
}

function observeCamp(harness, reason = 'inventory') {
  harness.system.observe('camp:changed', { reason, camp: structuredClone(harness.camps[0]) });
}

test('同一 tick 的人物与营地反向变化合并为单笔内部转移', () => {
  const harness = createHarness();
  harness.people[0].inventory.items.wood = 1;
  harness.people[0].activity.current = { id: 'haul-1', type: 'haulToCamp' };
  observePerson(harness);
  harness.camps[0].items.wood = 1;
  observeCamp(harness, 'haul:delivered');

  const flushed = harness.system.flush();
  assert.equal(flushed.length, 1);
  assert.equal(flushed[0].itemId, 'wood');
  assert.equal(flushed[0].amount, 1);
  assert.equal(flushed[0].from, 'person:person-1');
  assert.equal(flushed[0].to, 'camp:starting-camp');
  assert.equal(flushed[0].category, 'transfer');
  assert.equal(flushed[0].metadata.matched, true);
});

test('自然采集与腐败分别归入生产源和废弃物流向', () => {
  const harness = createHarness();
  harness.people[0].inventory.items.water = 2;
  harness.people[0].activity.current = { id: 'water-1', type: 'fetchWater' };
  observePerson(harness);
  harness.camps[0].items.berries = 3;
  observeCamp(harness, 'inventory');
  harness.system.flush();

  harness.setTick(11);
  harness.camps[0].items.berries = 1;
  observeCamp(harness, 'food:decay');
  harness.system.flush();

  const entries = harness.system.list();
  const water = entries.find((entry) => entry.itemId === 'water');
  const spoiled = entries.find((entry) => entry.category === 'spoilage');
  assert.equal(water.from, 'environment:river');
  assert.equal(water.to, 'person:person-1');
  assert.equal(water.category, 'production');
  assert.equal(spoiled.itemId, 'berries');
  assert.equal(spoiled.amount, 2);
  assert.equal(spoiled.to, 'waste:spoilage');
});

test('领取同一批物资时支持匹配且不重复计算', () => {
  const harness = createHarness();
  harness.camps[0].items.wood = 3;
  observeCamp(harness, 'inventory');
  harness.system.flush();

  harness.setTick(12);
  harness.camps[0].items.wood = 0;
  observeCamp(harness, 'construction:collect');
  harness.people[0].inventory.items.wood = 5;
  harness.people[0].activity.current = { id: 'delivery-1', type: 'deliverMaterials' };
  observePerson(harness);
  const entries = harness.system.flush();
  assert.equal(entries.length, 1);
  assert.equal(entries[0].amount, 3);
  assert.equal(entries[0].from, 'camp:starting-camp');
  assert.equal(entries[0].to, 'person:person-1');
});

test('同 tick 的独立生产与消费不会误配为账户转移', () => {
  const harness = createHarness();
  harness.system.enqueue({
    account: 'person:consumer',
    itemId: 'berries',
    delta: -1,
    reason: 'food:consume',
    personId: 'consumer',
  });
  harness.system.enqueue({
    account: 'person:gatherer',
    itemId: 'berries',
    delta: 1,
    reason: 'inventory:item',
    personId: 'gatherer',
    actionType: 'gatherBerries',
  });
  const entries = harness.system.flush();
  assert.equal(entries.length, 2);
  assert.ok(entries.some((entry) => entry.category === 'consumption' && entry.to === 'needs:consumer'));
  assert.ok(entries.some((entry) => entry.category === 'production' && entry.from.startsWith('map:feature:')));
  assert.equal(entries.some((entry) => entry.category === 'transfer'), false);
});

test('工具磨损和修理进入耐久流水', () => {
  const harness = createHarness();
  harness.tools[0].durability = 7;
  harness.system.observe('tools:changed', { reason: 'tool:used', tools: structuredClone(harness.tools), assignment: { taskId: 'chop-1', personId: 'person-1' } });
  harness.system.flush();

  harness.setTick(13);
  harness.tools[0].durability = 10;
  harness.system.observe('tools:changed', { reason: 'tool:repaired', tools: structuredClone(harness.tools) });
  harness.system.flush();

  const entries = harness.system.list({ itemId: 'durability:stone-axe' });
  assert.equal(entries.length, 2);
  assert.equal(entries[0].category, 'wear');
  assert.equal(entries[0].amount, 3);
  assert.equal(entries[1].category, 'repair');
  assert.equal(entries[1].amount, 3);
});

test('存档往返保留顺序与记录，检查点先结算悬空变化', () => {
  const harness = createHarness();
  harness.people[0].inventory.items.wood = 1;
  observePerson(harness);
  const checkpoint = harness.system.createCheckpoint();
  const exported = harness.system.exportState();

  const restored = createHarness();
  restored.system.importState(exported);
  assert.deepEqual(restored.system.list(), harness.system.list());

  harness.setTick(14);
  harness.people[0].inventory.items.water = 1;
  observePerson(harness);
  const settledCheckpoint = harness.system.createCheckpoint();
  assert.equal(settledCheckpoint.pending.length, 0);
  assert.equal(harness.system.getSummary({ skipFlush: true }).pending, 0);
  assert.ok(settledCheckpoint.state.entries.some((entry) => entry.itemId === 'water'));

  harness.system.restoreCheckpoint(checkpoint);
  assert.equal(harness.system.verify().ok, true);
});

test('校验器报告负库存和非法耐久', () => {
  const harness = createHarness();
  harness.people[0].inventory.items.wood = -1;
  harness.tools[0].durability = 12;
  const verification = harness.system.verify();
  assert.equal(verification.ok, false);
  assert.ok(verification.issues.some((issue) => issue.type === 'negative-inventory'));
  assert.ok(verification.issues.some((issue) => issue.type === 'invalid-durability'));
});
