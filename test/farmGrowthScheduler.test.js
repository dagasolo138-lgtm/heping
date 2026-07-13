import assert from 'node:assert/strict';
import test from 'node:test';

import {
  FARM_GROWTH_SYNC_INTERVAL_TICKS,
  createFarmGrowthTickHandler,
} from '../src/modules/farming/farmGrowthScheduler.js';

test('农田生长按固定 tick 批量同步', () => {
  let tick = 0;
  const calls = [];
  const handler = createFarmGrowthTickHandler({
    farmSystem: {
      syncGrowth(weather) {
        calls.push({ tick, weather: weather?.id ?? null });
      },
    },
    gameTime: { now: () => ({ tick }) },
  });

  for (tick = 1; tick < FARM_GROWTH_SYNC_INTERVAL_TICKS; tick += 1) {
    handler({ weather: { id: 'clear' } });
  }
  assert.deepEqual(calls, []);

  tick = FARM_GROWTH_SYNC_INTERVAL_TICKS;
  handler({ weather: { id: 'clear' } });
  assert.deepEqual(calls, [{ tick: FARM_GROWTH_SYNC_INTERVAL_TICKS, weather: 'clear' }]);
});

test('天气切换时先结算上一段天气，避免整段误用新天气', () => {
  let tick = 0;
  const calls = [];
  const handler = createFarmGrowthTickHandler({
    farmSystem: {
      syncGrowth(weather) {
        calls.push({ tick, weather: weather?.id ?? null });
      },
    },
    gameTime: { now: () => ({ tick }) },
    intervalTicks: 10,
  });

  tick = 1;
  handler({ weather: { id: 'clear' } });
  tick = 5;
  handler({ weather: { id: 'rain' } });

  assert.deepEqual(calls, [{ tick: 5, weather: 'clear' }]);

  tick = 15;
  handler({ weather: { id: 'rain' } });
  assert.deepEqual(calls, [
    { tick: 5, weather: 'clear' },
    { tick: 15, weather: 'rain' },
  ]);
});
