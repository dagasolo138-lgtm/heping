import { WORLD_MINUTES_PER_REAL_SECOND } from './fixedStepClock.js';

export const HIDDEN_TEST_MULTIPLIERS = Object.freeze([100]);
const MAX_TEST_TICKS = 36_000;

function normalizeMultiplier(value) {
  const numeric = Number(value);
  return HIDDEN_TEST_MULTIPLIERS.find((entry) => entry === numeric) ?? null;
}

export function calculateTestTicks(realSeconds, multiplier = 100) {
  const seconds = Number(realSeconds);
  const normalizedMultiplier = normalizeMultiplier(multiplier);
  if (!Number.isFinite(seconds) || seconds <= 0) throw new Error('测试推进秒数必须大于 0。');
  if (normalizedMultiplier === null) throw new Error(`不支持的测试倍率：${multiplier}`);
  return Math.min(MAX_TEST_TICKS, Math.max(1, Math.floor(seconds * WORLD_MINUTES_PER_REAL_SECOND * normalizedMultiplier)));
}

export function createSimulationTestAccelerator({ actionSystem, gameTime = null } = {}) {
  if (!actionSystem?.advanceTicks) throw new Error('测试加速器缺少行动系统。');

  function advance(realSeconds, { multiplier = 100, publishUi = false } = {}) {
    if (actionSystem.isRunning?.()) throw new Error('使用测试倍率前必须暂停世界运行。');
    const ticks = calculateTestTicks(realSeconds, multiplier);
    const before = gameTime?.stamp?.() ?? null;
    const advanced = actionSystem.advanceTicks(ticks, { publishUi });
    const after = gameTime?.stamp?.() ?? null;
    return Object.freeze({ multiplier, realSeconds: Number(realSeconds), ticks, advanced, before, after });
  }

  return Object.freeze({
    advance,
    options: () => HIDDEN_TEST_MULTIPLIERS,
    isSupported: (value) => normalizeMultiplier(value) !== null,
  });
}
