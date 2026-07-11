import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskLifecycleSystem } from '../src/modules/economy/taskLifecycleSystem.js';
import { createTaskLifecycleStageCostView } from '../src/modules/economy/taskLifecycleStageCostView.js';

function createHarness() {
  let time = { year: 1, day: 1, minute: 480, tick: 0, label: '第 1 日 08:00' };
  const eventBus = { emit() {} };
  const gameTime = { stamp: () => structuredClone(time) };
  const base = createTaskLifecycleSystem({ eventBus, gameTime, getRuntime: () => ({}) });
  const system = createTaskLifecycleStageCostView({ taskLifecycleSystem: base, gameTime });

  function setTime(patch) {
    time = { ...time, ...patch };
  }

  function task({
    id = 'delivery-1',
    stage = 'collect',
    expectedDuration = 12,
    expectedEnergy = 3,
    carriedAmount = 0,
  } = {}) {
    return {
      id,
      type: 'deliverMaterials',
      label: '运送建材',
      phase: 'moving',
      destination: stage === 'collect' ? { x: 1, y: 1 } : { x: 8, y: 8 },
      workDuration: expectedDuration,
      data: {
        stage,
        carriedAmount,
        laborCost: {
          expectedDuration,
          expectedEnergy,
          tool: { id: 'tool-basket-1' },
        },
      },
    };
  }

  function assign(value = task()) {
    system.observe('actions:assigned', { personId: 'person-1', task: value });
    return value;
  }

  function transition(value = task({ stage: 'deliver', expectedDuration: 28, expectedEnergy: 7, carriedAmount: 4 })) {
    system.observe('actions:stage-transition', {
      personId: 'person-1',
      taskId: value.id,
      task: value,
      fromStage: 'collect',
      toStage: 'deliver',
      reason: 'construction-material-collected',
      time: gameTime.stamp(),
    });
    return value;
  }

  return { system, gameTime, setTime, task, assign, transition };
}

test('同一建材运输只开始一次，但累计领取和负重送达两段成本', () => {
  const harness = createHarness();
  const initial = harness.assign();
  harness.setTime({ minute: 500, tick: 20 });
  const delivery = harness.transition();

  const active = harness.system.get(initial.id);
  assert.equal(active.expected.seconds, 40);
  assert.equal(active.expected.energy, 10);
  assert.equal(active.stageCostBreakdown.length, 2);
  assert.equal(active.stageCostBreakdown[1].stage, 'deliver');
  assert.equal(active.stageCostBreakdown[1].carriedAmount, 4);
  assert.equal(active.stageCostBreakdown[1].toolId, 'tool-basket-1');

  harness.setTime({ minute: 560, tick: 80 });
  harness.system.observe('actions:completed', {
    personId: 'person-1',
    task: delivery,
    result: { personId: 'person-1' },
  });

  const summary = harness.system.getDailySummary(1, 1);
  assert.equal(summary.started, 1);
  assert.equal(summary.completed, 1);
  assert.equal(summary.stageTransitions, 1);
  assert.equal(summary.expectedSeconds, 40);
  assert.equal(summary.expectedEnergy, 10);
  assert.equal(summary.byAction.deliverMaterials.started, 1);
  assert.equal(summary.byAction.deliverMaterials.completed, 1);
});

test('跨午夜时第二阶段成本进入实际发生的第二天', () => {
  const harness = createHarness();
  const initial = harness.assign(harness.task({ expectedDuration: 10, expectedEnergy: 2 }));
  harness.setTime({ day: 2, minute: 5, tick: 965, label: '第 2 日 00:05' });
  const delivery = harness.transition(harness.task({
    id: initial.id,
    stage: 'deliver',
    expectedDuration: 24,
    expectedEnergy: 6,
    carriedAmount: 3,
  }));
  harness.setTime({ day: 2, minute: 45, tick: 1005, label: '第 2 日 00:45' });
  harness.system.observe('actions:completed', {
    personId: 'person-1',
    task: delivery,
    result: { personId: 'person-1' },
  });

  const dayOne = harness.system.getDailySummary(1, 1);
  const dayTwo = harness.system.getDailySummary(1, 2);
  assert.equal(dayOne.started, 1);
  assert.equal(dayOne.expectedSeconds, 10);
  assert.equal(dayOne.expectedEnergy, 2);
  assert.equal(dayTwo.started, 0);
  assert.equal(dayTwo.completed, 1);
  assert.equal(dayTwo.stageTransitions, 1);
  assert.equal(dayTwo.expectedSeconds, 24);
  assert.equal(dayTwo.expectedEnergy, 6);
});

test('重复阶段事件不会重复累计成本', () => {
  const harness = createHarness();
  harness.assign();
  harness.setTime({ minute: 500, tick: 20 });
  const delivery = harness.task({ stage: 'deliver', expectedDuration: 28, expectedEnergy: 7, carriedAmount: 4 });
  harness.transition(delivery);
  harness.transition(delivery);

  const active = harness.system.get(delivery.id);
  assert.equal(active.expected.seconds, 40);
  assert.equal(active.expected.energy, 10);
  assert.equal(active.stageCostBreakdown.length, 2);
  assert.equal(harness.system.getSummary().stageTransitions, 1);
});

test('存档往返保留阶段成本并通过账本校验', () => {
  const harness = createHarness();
  harness.assign();
  harness.setTime({ minute: 500, tick: 20 });
  harness.transition();
  const snapshot = harness.system.exportState();

  const restored = createHarness();
  restored.setTime({ minute: 500, tick: 20 });
  restored.system.importState(snapshot);
  const active = restored.system.get('delivery-1');
  assert.equal(active.expected.seconds, 40);
  assert.equal(active.expected.energy, 10);
  assert.equal(active.stageCostBreakdown.length, 2);
  assert.equal(restored.system.verify().ok, true);
});
