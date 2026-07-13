import test from 'node:test';
import assert from 'node:assert/strict';

import { createHeadlessEventBus } from '../src/core/events/headlessEventBus.js';
import { subscribeObserverEvents } from '../src/core/events/observerSubscriptions.js';
import { createHeadlessReplay } from '../src/core/simulation/headlessReplay.js';

test('无界面事件总线丢弃展示事件并保留状态事件', () => {
  const bus = createHeadlessEventBus();
  let stateEvents = 0;
  let logEvents = 0;
  bus.on('people:changed', () => { stateEvents += 1; });
  bus.on('actions:log', () => { logEvents += 1; });

  assert.equal(bus.emit('people:changed', { person: { id: 'p1' } }), true);
  assert.equal(bus.emit('actions:log', { entry: { id: 'log-1' } }), false);
  assert.equal(stateEvents, 1);
  assert.equal(logEvents, 0);
  assert.equal(bus.getDiagnostics().suppressedByEvent['actions:log'], 1);
});

test('精确观察订阅不会被无关环境事件唤醒', () => {
  const bus = createHeadlessEventBus({ suppressedEvents: [] });
  const observed = [];
  const observer = { observe: (eventName) => observed.push(eventName) };
  subscribeObserverEvents({ eventBus: bus, observer, eventNames: ['simulation:pre-tick', 'actions:completed'] });

  bus.emit('environment:updated', {});
  bus.emit('simulation:pre-tick', {});
  bus.emit('actions:completed', {});
  assert.deepEqual(observed, ['simulation:pre-tick', 'actions:completed']);
});

test('无界面推进器按批次完整消费 fixed ticks', () => {
  let tick = 0;
  let running = false;
  const actionSystem = {
    isRunning: () => running,
    advanceTicks(amount) {
      tick += amount;
      return amount;
    },
  };
  const gameTime = { stamp: () => ({ tick }) };
  const replay = createHeadlessReplay({ actionSystem, gameTime, defaultBatchSize: 4 });
  const result = replay.advanceTicks(10);

  assert.equal(result.advancedTicks, 10);
  assert.equal(result.batches, 3);
  assert.deepEqual(result.before, { tick: 0 });
  assert.deepEqual(result.after, { tick: 10 });
  assert.equal(replay.getDiagnostics().totalTicks, 10);

  running = true;
  assert.throws(() => replay.advanceTicks(1), /必须暂停/);
});
