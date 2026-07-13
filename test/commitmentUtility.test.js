import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { scoreCommitmentUtility } from '../src/modules/actions/commitmentUtility.js';

test('活跃共同承诺只给匹配的合法候选加分', () => {
  const commitments = [{ id: 'food-1', type: 'restore-food-reserve', state: 'active', priority: 80, progress: 0 }];
  const food = scoreCommitmentUtility({ candidate: { type: ACTION_TYPES.GATHER_BERRIES }, commitments });
  const water = scoreCommitmentUtility({ candidate: { type: ACTION_TYPES.FETCH_WATER }, commitments });
  assert.equal(food.score, 14.4);
  assert.equal(food.matches[0].id, 'food-1');
  assert.equal(water.score, 0);
});

test('已完成承诺不加分，进度会衰减且总分封顶', () => {
  const candidate = { type: ACTION_TYPES.CHOP_TREE };
  const score = scoreCommitmentUtility({
    candidate,
    commitments: [
      { id: 'done', type: 'restore-wood-reserve', state: 'completed', priority: 100, progress: 0 },
      { id: 'wood', type: 'restore-wood-reserve', state: 'active', priority: 100, progress: 0.5 },
      { id: 'storage', type: 'improve-storage', state: 'active', priority: 100, progress: 0 },
    ],
  });
  assert.equal(score.score, 18);
  assert.deepEqual(score.matches.map((entry) => entry.id), ['storage', 'wood']);
});
