import test from 'node:test';
import assert from 'node:assert/strict';

import { createDailyEconomySystem } from '../src/modules/economy/dailyEconomySystem.js';
import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';
import { createTaskLifecycleSystem } from '../src/modules/economy/taskLifecycleSystem.js';
import { createTaskLifecycleEconomyView } from '../src/modules/economy/taskLifecycleEconomyView.js';

function createHarness() {
  let time = { year: 1, day: 1, minute: 1438, tick: 0, label: '第 1 日 23:58' };
  const person = {
    id: 'person-1',
    identity: { alive: true },
    activity: { status: 'idle', current: null },
    inventory: { items: {} },
  };
  const runtime = {
    peopleSystem: {
      list: () => [structuredClone(person)],
      getRuntime: () => structuredClone(person),
      get: () => structuredClone(person),
    },
    campStore: { list: () => [{ id: 'starting-camp', items: { wood: 2, water: 1, berries: 1 } }] },
    toolSystem: { list: () => [] },
    stockTargetSystem: {
      get: () => ({ goals: { water: 1, food: 1, wood: 2 }, amounts: { effective: { water: 1, food: 1, wood: 2 } } }),
    },
  };
  const gameTime = {
    stamp: () => structuredClone(time),
    now: () => structuredClone(time),
  };
  const eventBus = { emit() {} };
  const flow = createResourceFlowSystem({ gameTime, getRuntime: () => runtime, maxEntries: 100 });
  const lifecycle = createTaskLifecycleSystem({ eventBus, gameTime, getRuntime: () => runtime, maxRecords: 100 });
  const base = createDailyEconomySystem({ eventBus, gameTime, resourceFlowSystem: flow, getRuntime: () => runtime });
  const economy = createTaskLifecycleEconomyView({ dailyEconomySystem: base, taskLifecycleSystem: lifecycle });

  return {
    economy,
    base,
    lifecycle,
    person,
    setTime(patch) { time = { ...time, ...patch }; },
  };
}

test('跨日活动任务只显示 carry 状态，不再由 assigned-completed 生成假积压', () => {
  const harness = createHarness();
  const task = {
    id: 'task-midnight',
    type: 'chopTree',
    label: '砍树',
    data: { laborCost: { expectedDuration: 60, expectedEnergy: 3 } },
  };
  harness.person.activity = { status: 'working', current: task };
  harness.lifecycle.observe('actions:assigned', { personId: 'person-1', task });

  harness.setTime({ day: 2, minute: 0, tick: 2, label: '第 2 日 00:00' });
  harness.lifecycle.observe('simulation:pre-tick', {});
  harness.base.observe('simulation:pre-tick', {});

  const firstDay = harness.economy.getReport(1, 1);
  assert.equal(firstDay.labor.started, 1);
  assert.equal(firstDay.labor.completed, 0);
  assert.equal(firstDay.labor.carriedOut, 1);
  assert.equal(firstDay.labor.overdue, 0);
  assert.equal(firstDay.bottlenecks.some((entry) => entry.type === 'labor-backlog'), false);
  assert.equal(firstDay.bottlenecks.some((entry) => entry.type === 'labor-overdue'), false);
});

test('经济存档把任务生命周期作为同一事务的一部分保存和恢复', () => {
  const harness = createHarness();
  const task = {
    id: 'task-save',
    type: 'fetchWater',
    label: '取水',
    data: { laborCost: { expectedDuration: 20, expectedEnergy: 1 } },
  };
  harness.person.activity = { status: 'working', current: task };
  harness.lifecycle.observe('actions:assigned', { personId: 'person-1', task });
  const saved = harness.economy.exportState();
  assert.ok(saved.taskLifecycle);

  const restored = createHarness();
  restored.economy.importState(saved);
  assert.equal(restored.lifecycle.get('task-save').status, 'active');
  assert.equal(restored.economy.verify().ok, true);
});
