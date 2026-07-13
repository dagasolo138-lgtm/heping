import test from 'node:test';
import assert from 'node:assert/strict';

import { subscribeObserverEvents } from '../src/core/events/observerSubscriptions.js';

function createBus() {
  const listeners = new Map();
  return {
    on(eventName, listener) {
      if (!listeners.has(eventName)) listeners.set(eventName, []);
      listeners.get(eventName).push(listener);
      return () => {};
    },
    emit(eventName, payload) {
      (listeners.get(eventName) ?? []).forEach((listener) => listener(payload));
    },
  };
}

test('观察订阅过滤器跳过无关 mutation，并保留其他事件', () => {
  const eventBus = createBus();
  const observed = [];
  const observer = { observe: (eventName, payload) => observed.push({ eventName, payload }) };
  const subscription = subscribeObserverEvents({
    eventBus,
    observer,
    eventNames: ['people:changed', 'actions:completed'],
    shouldObserve: (eventName, payload) => eventName !== 'people:changed' || payload.reason === 'inventory:item',
  });

  eventBus.emit('people:changed', { reason: 'state:needs' });
  eventBus.emit('people:changed', { reason: 'inventory:item' });
  eventBus.emit('actions:completed', { task: { id: 'task-1' } });

  assert.deepEqual(observed.map((entry) => entry.eventName), ['people:changed', 'actions:completed']);
  assert.deepEqual(subscription.getDiagnostics(), { observed: 2, skipped: 1 });
});

test('观察订阅默认不改变原有全事件行为', () => {
  const eventBus = createBus();
  const observed = [];
  const subscription = subscribeObserverEvents({
    eventBus,
    observer: { observe: (eventName, payload) => observed.push({ eventName, payload }) },
    eventNames: ['people:changed'],
  });

  eventBus.emit('people:changed', { reason: 'state:needs' });
  eventBus.emit('people:changed', { reason: 'location:set' });

  assert.equal(observed.length, 2);
  assert.deepEqual(subscription.getDiagnostics(), { observed: 2, skipped: 0 });
});
