import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { scoreCommitmentUtility } from '../src/modules/actions/commitmentUtility.js';
import { scoreUtilityCandidates } from '../src/modules/actions/utilityScorer.js';

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

test('效用评分读取世界动力承诺，但不会创造候选', () => {
  const previous = globalThis.shengling;
  globalThis.shengling = {
    worldDynamicsSystem: {
      listCommitments: () => [{ id: 'water-1', type: 'restore-water-reserve', state: 'active', priority: 75, progress: 0 }],
    },
  };
  try {
    const candidates = [
      { type: ACTION_TYPES.FETCH_WATER, estimates: { distance: 0, expectedDuration: 0, expectedEnergy: 0 }, destination: { x: 0, y: 0 } },
      { type: ACTION_TYPES.GATHER_BERRIES, estimates: { distance: 0, expectedDuration: 0, expectedEnergy: 0 }, destination: { x: 0, y: 0 } },
    ];
    const scored = scoreUtilityCandidates({
      person: { id: 'p1', work: { occupation: 'unassigned', skills: {} }, relations: {}, family: {} },
      desire: { needs: { thirst: 0, hunger: 0, fatigue: 0, stress: 0 }, traits: {} },
      candidates,
      camp: {},
      population: 1,
      actionCounts: {},
      stockTargets: { shortage: { water: 0, food: 0, wood: 0 } },
    });
    assert.equal(scored.length, 2);
    assert.equal(scored[0].candidate.type, ACTION_TYPES.FETCH_WATER);
    assert.equal(scored[0].factors.communityCommitment, 13.5);
    assert.equal(scored[0].commitmentTargets[0].id, 'water-1');
  } finally {
    globalThis.shengling = previous;
  }
});
