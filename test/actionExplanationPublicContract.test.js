import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { buildActionExplanation, plannerLabel } from '../src/modules/actions/actionExplanation.js';

test('行动解释公开契约保持版本、调度器名称和硬规则稳定', () => {
  const explanation = buildActionExplanation({
    id: 'sleep-task',
    type: ACTION_TYPES.SLEEP,
    label: '睡眠',
    destination: { x: 0, y: 0 },
    workDuration: 8,
    data: { sheltered: true, shelterLabel: '集体草棚' },
  });

  assert.equal(explanation.version, 1);
  assert.equal(explanation.planner, 'night-sleep');
  assert.equal(plannerLabel('farm-planner'), '农业调度');
  assert.ok(explanation.hardRules.includes('夜间作息优先'));
  assert.ok(explanation.hardRules.includes('优先使用已分配住所'));
  assert.equal(Object.isFrozen(explanation), true);
});
