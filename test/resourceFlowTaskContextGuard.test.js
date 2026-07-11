import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../src/core/events/eventBus.js';
import { attachResourceFlowTaskContextGuard } from '../src/modules/economy/resourceFlowTaskContextGuard.js';

test('资源流水任务上下文在失败、生命周期关闭和读档时清理', () => {
  const eventBus = createEventBus();
  const observed = [];
  const people = [{ id: 'person-1', activity: { current: null } }];
  const runtime = {
    actionSystem: {
      getRenderPeople: () => structuredClone(people),
    },
  };
  const resourceFlowSystem = {
    observe: (eventName, payload) => observed.push({ eventName, payload: structuredClone(payload) }),
  };
  const guard = attachResourceFlowTaskContextGuard({
    eventBus,
    resourceFlowSystem,
    getRuntime: () => runtime,
  });

  people[0].activity.current = { id: 'task-failed', type: 'deliverMaterials' };
  eventBus.emit('actions:assigned', {
    personId: 'person-1',
    task: { id: 'task-failed', type: 'deliverMaterials' },
  });
  assert.equal(guard.verify().ok, true);
  assert.equal(guard.getSummary().tracked, 1);

  people[0].activity.current = null;
  eventBus.emit('actions:failed', { taskId: 'task-failed', reason: 'route-blocked' });
  assert.equal(guard.getSummary().tracked, 0);
  assert.ok(observed.some((entry) => entry.eventName === 'actions:completed' && entry.payload.task.id === 'task-failed'));

  people[0].activity.current = { id: 'task-cancelled', type: 'gatherBerries' };
  eventBus.emit('actions:assigned', {
    personId: 'person-1',
    task: { id: 'task-cancelled', type: 'gatherBerries' },
  });
  people[0].activity.current = null;
  eventBus.emit('task-lifecycle:closed', {
    status: 'cancelled',
    record: { taskId: 'task-cancelled' },
  });
  assert.equal(guard.getSummary().tracked, 0);
  assert.ok(observed.some((entry) => entry.eventName === 'actions:completed' && entry.payload.task.id === 'task-cancelled'));

  people[0].activity.current = { id: 'task-before-load', type: 'fetchWater' };
  eventBus.emit('actions:assigned', {
    personId: 'person-1',
    task: { id: 'task-before-load', type: 'fetchWater' },
  });
  eventBus.emit('save:loaded', {});

  const summary = guard.getSummary();
  assert.equal(summary.tracked, 0);
  assert.equal(summary.clearedTerminal, 2);
  assert.equal(summary.clearedOnLoad, 1);
  assert.ok(observed.some((entry) => entry.eventName === 'actions:completed' && entry.payload.task.id === 'task-before-load'));
  assert.equal(guard.verify().ok, true);
});
