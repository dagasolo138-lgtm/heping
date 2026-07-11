import test from 'node:test';
import assert from 'node:assert/strict';

import { createTaskLifecycleSystem } from '../src/modules/economy/taskLifecycleSystem.js';

function createHarness() {
  let time = { year: 1, day: 1, minute: 480, tick: 0, label: '第 1 日 08:00' };
  const people = new Map([
    ['person-1', {
      id: 'person-1',
      identity: { alive: true },
      activity: { status: 'idle', current: null },
    }],
  ]);
  const events = [];
  const eventBus = { emit: (eventName, payload) => events.push({ eventName, payload }) };
  const gameTime = { stamp: () => structuredClone(time) };
  const runtime = {
    peopleSystem: {
      getRuntime: (id) => structuredClone(people.get(id) ?? null),
      get: (id) => structuredClone(people.get(id) ?? null),
    },
  };
  const system = createTaskLifecycleSystem({ eventBus, gameTime, getRuntime: () => runtime, maxRecords: 100 });

  function setTime(patch) {
    time = { ...time, ...patch };
  }

  function setActivity(current, { alive = true } = {}) {
    const person = people.get('person-1');
    person.identity.alive = alive;
    person.activity = current
      ? { status: 'working', current: structuredClone(current) }
      : { status: 'idle', current: null };
    system.observe('people:changed', { person: structuredClone(person), reason: 'activity:set' });
  }

  function assign(task = {}) {
    const value = {
      id: task.id ?? 'task-1',
      type: task.type ?? 'chopTree',
      label: task.label ?? '砍树',
      workDuration: task.workDuration ?? 30,
      data: {
        laborCost: {
          expectedDuration: task.expectedDuration ?? 30,
          expectedEnergy: task.expectedEnergy ?? 4,
        },
      },
    };
    setActivity(value);
    system.observe('actions:assigned', { personId: 'person-1', task: value });
    return value;
  }

  return { system, events, people, setTime, setActivity, assign };
}

test('正常完成会记录实际耗时且不会被同 tick 的 idle 事件误判为取消', () => {
  const harness = createHarness();
  const task = harness.assign();
  harness.setTime({ minute: 540, tick: 60 });
  harness.setActivity(null);
  harness.system.observe('actions:completed', { personId: 'person-1', task, result: { personId: 'person-1' } });
  harness.setTime({ minute: 541, tick: 61 });
  harness.system.observe('simulation:pre-tick', {});

  const record = harness.system.get(task.id);
  assert.equal(record.status, 'completed');
  assert.equal(record.elapsedWorldMinutes, 60);
  assert.equal(record.actualSeconds, 10);
  assert.equal(harness.system.getSummary().cancelled, 0);
});

test('活动被清空且没有完成事件时在下一 tick 记为取消', () => {
  const harness = createHarness();
  const task = harness.assign();
  harness.setTime({ minute: 500, tick: 20 });
  harness.setActivity(null);
  assert.equal(harness.system.get(task.id).status, 'active');

  harness.setTime({ minute: 501, tick: 21 });
  harness.system.observe('simulation:pre-tick', {});
  const record = harness.system.get(task.id);
  assert.equal(record.status, 'cancelled');
  assert.equal(record.outcome.reason, 'activity-cleared');
});

test('午夜前被清空的任务即使在次日判定，也保留前一日取消时间', () => {
  const harness = createHarness();
  const task = harness.assign();
  harness.setTime({ day: 1, minute: 1439, tick: 20, label: '第 1 日 23:59' });
  harness.setActivity(null);
  harness.setTime({ day: 2, minute: 0, tick: 21, label: '第 2 日 00:00' });
  harness.system.observe('simulation:pre-tick', {});

  const record = harness.system.get(task.id);
  assert.equal(record.closedAt.day, 1);
  assert.equal(harness.system.getDailySummary(1, 1).cancelled, 1);
  assert.equal(harness.system.getDailySummary(1, 1).carriedOut, 0);
  assert.equal(harness.system.getDailySummary(1, 2).carriedIn, 0);
});

test('人物死亡会把活动任务记为失败', () => {
  const harness = createHarness();
  const task = harness.assign();
  harness.setTime({ minute: 510, tick: 30 });
  harness.setActivity(null, { alive: false });
  harness.setTime({ minute: 511, tick: 31 });
  harness.system.observe('simulation:pre-tick', {});

  const record = harness.system.get(task.id);
  assert.equal(record.status, 'failed');
  assert.equal(record.outcome.reason, 'person-died');
});

test('跨午夜任务进入 carryOut 和 carryIn，但不会自动成为超时积压', () => {
  const harness = createHarness();
  const task = harness.assign({ expectedDuration: 60 });
  harness.setTime({ day: 2, minute: 0, tick: 10 });
  harness.system.observe('simulation:pre-tick', {});

  const dayOne = harness.system.getDailySummary(1, 1);
  const dayTwo = harness.system.getDailySummary(1, 2);
  assert.equal(dayOne.started, 1);
  assert.equal(dayOne.carriedOut, 1);
  assert.equal(dayOne.overdue, 0);
  assert.equal(dayTwo.carriedIn, 1);
  assert.equal(dayTwo.started, 0);

  harness.setTime({ day: 2, minute: 5, tick: 15 });
  harness.setActivity(null);
  harness.system.observe('actions:completed', { personId: 'person-1', task, result: { personId: 'person-1' } });
  assert.equal(harness.system.getDailySummary(1, 2).completed, 1);
});

test('真正超过预计耗时两倍的活动任务会被标为 overdue', () => {
  const harness = createHarness();
  harness.assign({ expectedDuration: 5 });
  harness.setTime({ minute: 700, tick: 220 });
  const summary = harness.system.getDailySummary(1, 1);
  assert.equal(summary.overdue, 1);
});

test('存档往返保留历史、活动任务和每日跨日快照', () => {
  const harness = createHarness();
  harness.assign({ id: 'task-active' });
  harness.setTime({ day: 2, minute: 0, tick: 10 });
  harness.system.observe('simulation:pre-tick', {});
  const saved = harness.system.exportState();

  const restored = createHarness();
  restored.setTime({ day: 2, minute: 0, tick: 10 });
  restored.system.importState(saved);
  assert.equal(restored.system.get('task-active').status, 'active');
  assert.equal(restored.system.getDailySummary(1, 1).carriedOut, 1);
  assert.equal(restored.system.verify().ok, true);
});

test('读档后的 cancel-and-replan 会关闭存档中的活动任务', () => {
  const harness = createHarness();
  harness.assign({ id: 'task-before-load' });
  harness.system.observe('save:loaded', {});
  const record = harness.system.get('task-before-load');
  assert.equal(record.status, 'cancelled');
  assert.equal(record.outcome.reason, 'save-load-replan');
});
