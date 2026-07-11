import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../src/core/events/eventBus.js';
import { createDailyEconomySystem } from '../src/modules/economy/dailyEconomySystem.js';
import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';
import { createTaskLifecycleSystem } from '../src/modules/economy/taskLifecycleSystem.js';
import { createTaskLifecycleEconomyView } from '../src/modules/economy/taskLifecycleEconomyView.js';

function createHarness(initialTime = { year: 1, day: 1, minute: 480, tick: 0, label: '第 1 日 08:00' }) {
  let time = structuredClone(initialTime);
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
  const bus = createEventBus();
  const flow = createResourceFlowSystem({ gameTime, getRuntime: () => runtime, maxEntries: 20 });
  const lifecycle = createTaskLifecycleSystem({ eventBus: bus, gameTime, getRuntime: () => runtime, maxRecords: 2 });
  bus.on('*', ({ eventName, payload }) => lifecycle.observe(eventName, payload));
  const base = createDailyEconomySystem({ eventBus: bus, gameTime, resourceFlowSystem: flow, getRuntime: () => runtime });
  const economy = createTaskLifecycleEconomyView({ dailyEconomySystem: base, taskLifecycleSystem: lifecycle, eventBus: bus });
  bus.on('*', ({ eventName, payload }) => base.observe(eventName, payload));

  function completeTask(id) {
    const task = {
      id,
      type: 'fetchWater',
      label: '取水',
      data: { laborCost: { expectedDuration: 20, expectedEnergy: 1 } },
    };
    person.activity = { status: 'working', current: task };
    bus.emit('actions:assigned', { personId: person.id, task, time: gameTime.stamp() });
    time = { ...time, tick: time.tick + 6, minute: time.minute + 6 };
    person.activity = { status: 'idle', current: null };
    bus.emit('actions:completed', {
      personId: person.id,
      task,
      result: { personId: person.id },
      time: gameTime.stamp(),
    });
  }

  function advanceDay(day) {
    time = {
      year: 1,
      day,
      minute: 0,
      tick: (day - 1) * 1440,
      label: `第 ${day} 日 00:00`,
    };
    bus.emit('simulation:pre-tick', { time: gameTime.stamp() });
  }

  return {
    economy,
    lifecycle,
    completeTask,
    advanceDay,
    now: () => structuredClone(time),
  };
}

test('任务记录淘汰后历史日报劳动摘要保持冻结并可存档恢复', () => {
  const harness = createHarness();
  harness.completeTask('day-1-task');
  harness.advanceDay(2);

  const original = harness.economy.getReport(1, 1).labor;
  assert.equal(original.started, 1);
  assert.equal(original.completed, 1);

  harness.completeTask('day-2-task');
  harness.advanceDay(3);
  harness.completeTask('day-3-task');
  harness.advanceDay(4);
  harness.completeTask('day-4-task');

  assert.equal(harness.lifecycle.get('day-1-task'), null);
  assert.equal(harness.lifecycle.getDailySummary(1, 1).started, 0);
  assert.deepEqual(harness.economy.getReport(1, 1).labor, original);

  const saved = harness.economy.exportState();
  assert.ok(saved.taskLifecycleLaborSnapshots.some((entry) => entry.key === '1:1'));

  const restored = createHarness(harness.now());
  restored.economy.importState(saved);
  assert.deepEqual(restored.economy.getReport(1, 1).labor, original);
  assert.equal(restored.economy.verify().ok, true);
});
