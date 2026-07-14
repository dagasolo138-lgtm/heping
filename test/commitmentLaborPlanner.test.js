import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import {
  estimateCommitmentDemandStrength,
  planCommitmentLabor,
  planCommitmentLaborPortfolio,
  verifyCommitmentLaborPortfolio,
} from '../src/modules/actions/commitmentLaborPlanner.js';

function commitment(overrides = {}) {
  return {
    id: 'commitment-water',
    type: 'restore-water-reserve',
    state: 'active',
    priority: 80,
    progress: 0,
    createdAt: { tick: 10 },
    ...overrides,
  };
}

test('优先级与进度决定劳动力需求，未满时继续吸引', () => {
  const source = commitment();
  assert.equal(estimateCommitmentDemandStrength(source), 0.8);

  const plan = planCommitmentLabor({
    commitment: source,
    population: 10,
    actionCounts: { [ACTION_TYPES.FETCH_WATER]: 2 },
    availableActions: [ACTION_TYPES.FETCH_WATER],
    capacityByAction: { [ACTION_TYPES.FETCH_WATER]: 3 },
  });

  assert.equal(plan.desiredWorkers, 3);
  assert.equal(plan.currentResponders, 2);
  assert.equal(plan.attractionSlots, 1);
  assert.equal(plan.targetWorkers, 3);
  assert.equal(plan.unmetWorkers, 0);
  assert.equal(plan.saturation, 0.667);
  assert.equal(plan.status, 'attracting');
  assert.equal(plan.attracting, true);
  assert.equal(plan.stopReason, null);
  assert.deepEqual(plan.responderAllocation, { [ACTION_TYPES.FETCH_WATER]: 2 });
  assert.deepEqual(plan.slotAllocation, { [ACTION_TYPES.FETCH_WATER]: 1 });
});

test('目标人数已满足后停止继续吸引村民', () => {
  const plan = planCommitmentLabor({
    commitment: commitment(),
    population: 10,
    actionCounts: { [ACTION_TYPES.FETCH_WATER]: 3 },
    availableActions: [ACTION_TYPES.FETCH_WATER],
    capacityByAction: { [ACTION_TYPES.FETCH_WATER]: 3 },
  });

  assert.equal(plan.desiredWorkers, 3);
  assert.equal(plan.currentResponders, 3);
  assert.equal(plan.attractionSlots, 0);
  assert.equal(plan.saturation, 1);
  assert.equal(plan.status, 'saturated');
  assert.equal(plan.attracting, false);
  assert.equal(plan.stopReason, 'labor-target-met');
});

test('组合规划按优先级分配响应者，同一劳动不会重复计算', () => {
  const portfolio = planCommitmentLaborPortfolio({
    commitments: [
      commitment({ id: 'normal-water', priority: 70, createdAt: { tick: 1 } }),
      commitment({ id: 'emergency-water', type: 'emergency-water-supply', priority: 100, createdAt: { tick: 2 } }),
    ],
    population: 10,
    actionCounts: { [ACTION_TYPES.FETCH_WATER]: 4 },
    availableActions: [ACTION_TYPES.FETCH_WATER],
    capacityByAction: { [ACTION_TYPES.FETCH_WATER]: 4 },
  });

  assert.deepEqual(portfolio.plans.map((plan) => plan.commitmentId), ['emergency-water', 'normal-water']);
  assert.equal(portfolio.plans[0].currentResponders, 3);
  assert.equal(portfolio.plans[0].status, 'saturated');
  assert.equal(portfolio.plans[1].currentResponders, 1);
  assert.equal(portfolio.plans[1].desiredWorkers, 3);
  assert.equal(portfolio.plans[1].unmetWorkers, 2);
  assert.equal(portfolio.plans[1].status, 'constrained');
  assert.equal(portfolio.plans[1].stopReason, 'response-capacity-exhausted');
  assert.equal(portfolio.summary.currentResponders, 4);
  assert.deepEqual(portfolio.unallocatedResponders, {});
  assert.equal(verifyCommitmentLaborPortfolio(portfolio).ok, true);
});

test('没有合法响应行动时记录阻塞原因，不吸引村民', () => {
  const plan = planCommitmentLabor({
    commitment: commitment({ priority: 100 }),
    population: 10,
    actionCounts: {},
    availableActions: [],
    capacityByAction: { [ACTION_TYPES.FETCH_WATER]: 3 },
  });

  assert.equal(plan.desiredWorkers, 3);
  assert.equal(plan.targetWorkers, 0);
  assert.equal(plan.unmetWorkers, 3);
  assert.equal(plan.status, 'blocked');
  assert.equal(plan.stopReason, 'no-legal-response');
  assert.deepEqual(plan.blockers, ['no-legal-response']);
  assert.equal(plan.attracting, false);
});

test('容量不足时只开放可执行名额，并保留未满足需求', () => {
  const plan = planCommitmentLabor({
    commitment: commitment({ priority: 100 }),
    population: 10,
    actionCounts: {},
    availableActions: [ACTION_TYPES.FETCH_WATER],
    capacityByAction: { [ACTION_TYPES.FETCH_WATER]: 2 },
  });

  assert.equal(plan.desiredWorkers, 3);
  assert.equal(plan.targetWorkers, 2);
  assert.equal(plan.attractionSlots, 2);
  assert.equal(plan.unmetWorkers, 1);
  assert.equal(plan.capacityConstrained, true);
  assert.equal(plan.status, 'attracting');
});

test('完成态、零人口与未知承诺均给出确定停止状态', () => {
  const completed = planCommitmentLabor({
    commitment: commitment({ state: 'completed', progress: 1 }),
    population: 10,
  });
  assert.equal(completed.status, 'inactive');
  assert.equal(completed.stopReason, 'inactive-commitment');

  const noPopulation = planCommitmentLabor({
    commitment: commitment({ priority: 100 }),
    population: 0,
  });
  assert.equal(noPopulation.status, 'blocked');
  assert.equal(noPopulation.stopReason, 'no-population');

  const unknown = planCommitmentLabor({
    commitment: commitment({ type: 'unknown-response' }),
    population: 10,
  });
  assert.equal(unknown.status, 'blocked');
  assert.equal(unknown.stopReason, 'no-response-action');
});

test('规划结果和校验结果为只读对象', () => {
  const portfolio = planCommitmentLaborPortfolio({
    commitments: [commitment()],
    population: 10,
    actionCounts: { [ACTION_TYPES.FETCH_WATER]: 1 },
  });
  const verification = verifyCommitmentLaborPortfolio(portfolio);

  assert.equal(verification.ok, true);
  assert.equal(Object.isFrozen(portfolio), true);
  assert.equal(Object.isFrozen(portfolio.plans), true);
  assert.equal(Object.isFrozen(portfolio.plans[0]), true);
  assert.equal(Object.isFrozen(portfolio.plans[0].responseActions), true);
  assert.equal(Object.isFrozen(verification), true);
});
