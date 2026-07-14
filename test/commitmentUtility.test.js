import test from 'node:test';
import assert from 'node:assert/strict';
import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import {
  runtimeOpportunityCommitments,
  scoreCommitmentUtility,
} from '../src/modules/actions/commitmentUtility.js';
import { scoreUtilityCandidates } from '../src/modules/actions/utilityScorer.js';

function candidate(type, effectEstimates = {}) {
  return {
    type,
    effectEstimates,
    estimates: { distance: 0, expectedDuration: 0, expectedEnergy: 0 },
    destination: { x: 0, y: 0 },
  };
}

test('活跃共同承诺只给具备匹配正向效果的合法候选加分', () => {
  const commitments = [{ id: 'food-1', type: 'restore-food-reserve', state: 'active', priority: 80, progress: 0 }];
  const food = scoreCommitmentUtility({
    candidate: candidate(ACTION_TYPES.GATHER_BERRIES),
    commitments,
    population: 10,
  });
  const water = scoreCommitmentUtility({
    candidate: candidate(ACTION_TYPES.FETCH_WATER),
    commitments,
    population: 10,
  });
  const zeroYield = scoreCommitmentUtility({
    candidate: candidate(ACTION_TYPES.GATHER_BERRIES, { foodAmount: 0 }),
    commitments,
    population: 10,
  });

  assert.equal(food.score, 14.4);
  assert.equal(food.matches[0].id, 'food-1');
  assert.equal(food.matches[0].effects[0].metric, 'effective-stock');
  assert.equal(food.matches[0].effects[0].subjectId, 'food');
  assert.equal(water.score, 0);
  assert.equal(zeroYield.score, 0);
  assert.equal(zeroYield.blocked[0].reason, 'no-useful-effect');
});

test('承诺分数随未满足劳动力比例衰减，达到目标人数后归零', () => {
  const commitments = [{ id: 'food-1', type: 'restore-food-reserve', state: 'active', priority: 100, progress: 0 }];
  const fresh = scoreCommitmentUtility({
    candidate: candidate(ACTION_TYPES.GATHER_BERRIES),
    commitments,
    population: 10,
    actionCounts: {},
  });
  const partiallyStaffed = scoreCommitmentUtility({
    candidate: candidate(ACTION_TYPES.GATHER_BERRIES),
    commitments,
    population: 10,
    actionCounts: { [ACTION_TYPES.GATHER_BERRIES]: 1 },
  });
  const saturated = scoreCommitmentUtility({
    candidate: candidate(ACTION_TYPES.GATHER_BERRIES),
    commitments,
    population: 10,
    actionCounts: { [ACTION_TYPES.GATHER_BERRIES]: 3 },
  });

  assert.equal(fresh.matches[0].desiredWorkers, 3);
  assert.equal(fresh.score, 18);
  assert.equal(partiallyStaffed.matches[0].currentResponders, 1);
  assert.equal(partiallyStaffed.matches[0].remainingDemand, 2);
  assert.equal(partiallyStaffed.score, 12);
  assert.equal(saturated.score, 0);
  assert.equal(saturated.blocked[0].status, 'saturated');
  assert.equal(saturated.blocked[0].stopReason, 'labor-target-met');
});

test('已完成承诺不加分，多项有效承诺合计仍封顶 18', () => {
  const score = scoreCommitmentUtility({
    candidate: candidate(ACTION_TYPES.CHOP_TREE),
    population: 10,
    commitments: [
      { id: 'done', type: 'restore-wood-reserve', state: 'completed', priority: 100, progress: 0 },
      { id: 'wood', type: 'restore-wood-reserve', state: 'active', priority: 100, progress: 0.5 },
      { id: 'storage', type: 'improve-storage', state: 'active', priority: 100, progress: 0 },
    ],
  });

  assert.equal(score.score, 18);
  assert.deepEqual(score.matches.map((entry) => entry.id), ['storage', 'wood']);
});

test('播种与收获机会转成确定的运行时临时承诺', () => {
  const commitments = runtimeOpportunityCommitments([
    {
      id: 'rain-1',
      signature: 'farm:rain-sowing-window',
      kind: 'rain-sowing-window',
      state: 'active',
      value: 0.8,
      domain: 'agriculture',
      evidence: { sowableFields: 2 },
      openedAt: { tick: 10 },
    },
    {
      id: 'harvest-1',
      signature: 'farm:harvest-window',
      kind: 'harvest-window',
      state: 'active',
      value: 0.7,
      domain: 'agriculture',
      evidence: { matureFields: 1 },
      openedAt: { tick: 11 },
    },
    { id: 'surplus', kind: 'stock-surplus', state: 'active', value: 1 },
  ]);

  assert.deepEqual(commitments.map((entry) => entry.type), ['harvest-millet-window', 'sow-millet-window']);
  assert.equal(commitments[0].priority, 70);
  assert.equal(commitments[0].sourceKind, 'opportunity');
  assert.equal(commitments[1].goal.target, 2);
  assert.equal(Object.isFrozen(commitments), true);
});

test('种子短缺和收获窗口共同奖励真实收获，播种窗口只奖励播种', () => {
  const opportunities = runtimeOpportunityCommitments([
    { id: 'rain', kind: 'rain-sowing-window', state: 'active', value: 0.8, evidence: { sowableFields: 1 } },
    { id: 'harvest', kind: 'harvest-window', state: 'active', value: 0.7, evidence: { matureFields: 1 } },
  ]);
  const harvest = scoreCommitmentUtility({
    candidate: candidate(ACTION_TYPES.HARVEST_MILLET),
    population: 10,
    commitments: [
      ...opportunities,
      { id: 'seed', type: 'restore-seed-reserve', state: 'active', priority: 90, progress: 0 },
    ],
  });
  const sow = scoreCommitmentUtility({
    candidate: candidate(ACTION_TYPES.SOW_MILLET),
    population: 10,
    commitments: opportunities,
  });

  assert.equal(harvest.score, 18);
  assert.deepEqual(harvest.matches.map((entry) => entry.type).sort(), ['harvest-millet-window', 'restore-seed-reserve']);
  assert.equal(harvest.matches.find((entry) => entry.type === 'harvest-millet-window').sourceKind, 'opportunity');
  assert.equal(sow.score, 14.4);
  assert.deepEqual(sow.matches.map((entry) => entry.type), ['sow-millet-window']);
});

test('效用评分每轮只读取一次承诺快照，复用劳动力计划且不会创造候选', () => {
  const previous = globalThis.shengling;
  let reads = 0;
  globalThis.shengling = {
    worldDynamicsSystem: {
      listCommitments: () => {
        reads += 1;
        return [{ id: 'water-1', type: 'restore-water-reserve', state: 'active', priority: 75, progress: 0 }];
      },
    },
  };
  try {
    const candidates = [
      candidate(ACTION_TYPES.FETCH_WATER),
      candidate(ACTION_TYPES.GATHER_BERRIES),
    ];
    const scored = scoreUtilityCandidates({
      person: { id: 'p1', work: { occupation: 'unassigned', skills: {} }, relations: {}, family: {} },
      desire: { needs: { thirst: 0, hunger: 0, fatigue: 0, stress: 0 }, traits: {} },
      candidates,
      camp: {},
      population: 10,
      actionCounts: {},
      stockTargets: { shortage: { water: 0, food: 0, wood: 0 } },
    });

    assert.equal(reads, 1);
    assert.equal(scored.length, 2);
    assert.equal(scored[0].candidate.type, ACTION_TYPES.FETCH_WATER);
    assert.equal(scored[0].factors.communityCommitment, 13.5);
    assert.equal(scored[0].commitmentTargets[0].id, 'water-1');
    assert.equal(scored[0].commitmentTargets[0].desiredWorkers, 3);
    assert.equal(scored[1].factors.communityCommitment, 0);
  } finally {
    globalThis.shengling = previous;
  }
});

test('效用评分在承诺劳动力已满时停止给后续候选加分', () => {
  const scored = scoreUtilityCandidates({
    person: { id: 'p1', work: { occupation: 'unassigned', skills: {} }, relations: {}, family: {} },
    desire: { needs: { thirst: 0, hunger: 0, fatigue: 0, stress: 0 }, traits: {} },
    candidates: [candidate(ACTION_TYPES.FETCH_WATER)],
    camp: {},
    population: 10,
    actionCounts: { [ACTION_TYPES.FETCH_WATER]: 3 },
    stockTargets: { shortage: { water: 0, food: 0, wood: 0 } },
    commitments: [{ id: 'water-1', type: 'restore-water-reserve', state: 'active', priority: 100, progress: 0 }],
  });

  assert.equal(scored[0].factors.communityCommitment, 0);
  assert.equal(scored[0].commitmentTargets.length, 0);
  assert.equal(scored[0].commitmentBlocked[0].stopReason, 'labor-target-met');
});
