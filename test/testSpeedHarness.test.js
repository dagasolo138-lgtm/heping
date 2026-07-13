import test from 'node:test';
import assert from 'node:assert/strict';
import { calculateTestTicks, createSimulationTestAccelerator, HIDDEN_TEST_MULTIPLIERS } from '../src/core/simulation/testSpeedHarness.js';

test('100× 测试倍率按真实秒数确定性换算 fixed ticks', () => {
  assert.deepEqual(HIDDEN_TEST_MULTIPLIERS, [100]);
  assert.equal(calculateTestTicks(1, 100), 600);
  assert.equal(calculateTestTicks(0.1, 100), 60);
  assert.throws(() => calculateTestTicks(1, 10), /不支持的测试倍率/);
});

test('测试推进器要求暂停世界，并调用既有 fixed-tick 入口', () => {
  let running = true;
  let total = 0;
  const actionSystem = {
    isRunning: () => running,
    advanceTicks(ticks) { total += ticks; return ticks; },
  };
  const gameTime = { stamp: () => ({ tick: total }) };
  const accelerator = createSimulationTestAccelerator({ actionSystem, gameTime });
  assert.throws(() => accelerator.advance(0.1), /必须暂停/);
  running = false;
  const result = accelerator.advance(0.1, { multiplier: 100 });
  assert.equal(result.ticks, 60);
  assert.equal(result.advanced, 60);
  assert.deepEqual(result.before, { tick: 0 });
  assert.deepEqual(result.after, { tick: 60 });
});
