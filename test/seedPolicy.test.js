import test from 'node:test';
import assert from 'node:assert/strict';

import { buildSeedStockTarget, splitMilletHarvest, verifyHarvestSplit } from '../src/modules/farming/seedPolicy.js';

test('粟米收获按真实总产量拆分口粮和留种', () => {
  const result = splitMilletHarvest(8, { seedShare: 0.15, minimumSeedReturn: 1 });
  assert.deepEqual(result, { totalAmount: 8, foodAmount: 7, seedAmount: 1 });
  assert.equal(verifyHarvestSplit(result).ok, true);
});

test('低产收获仍至少保留下一轮种子并维持总量守恒', () => {
  assert.deepEqual(splitMilletHarvest(3), { totalAmount: 3, foodAmount: 2, seedAmount: 1 });
  assert.deepEqual(splitMilletHarvest(1), { totalAmount: 1, foodAmount: 0, seedAmount: 1 });
});

test('种子目标由全部农田下一轮需求和一轮缓冲组成', () => {
  const summary = buildSeedStockTarget({
    fields: [{ id: 'field-1', status: 'growing' }, { id: 'field-2', status: 'readyToSow' }],
    campAmount: 1,
    carriedAmount: 1,
    inTransitAmount: 1,
  });
  assert.equal(summary.requiredPlantings, 2);
  assert.equal(summary.target, 3);
  assert.equal(summary.onHand, 2);
  assert.equal(summary.shortage, 1);
  assert.equal(summary.inTransit, 1);
});
