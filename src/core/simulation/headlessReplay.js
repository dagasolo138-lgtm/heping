import { performance } from 'node:perf_hooks';

function normalizePositiveInteger(value, fallback) {
  const numeric = Math.floor(Number(value));
  return Number.isFinite(numeric) && numeric > 0 ? numeric : fallback;
}

export function createHeadlessReplay({ actionSystem, gameTime = null, eventBus = null, defaultBatchSize = 600 } = {}) {
  if (!actionSystem?.advanceTicks) throw new Error('无界面回放缺少行动系统。');
  const normalizedDefaultBatchSize = normalizePositiveInteger(defaultBatchSize, 600);
  let runs = 0;
  let totalTicks = 0;
  let totalElapsedMs = 0;
  let lastRun = null;

  function advanceTicks(count, { batchSize = normalizedDefaultBatchSize, onBatch = null } = {}) {
    if (actionSystem.isRunning?.()) throw new Error('无界面回放前必须暂停实时世界循环。');
    const requestedTicks = Math.max(0, Math.floor(Number(count) || 0));
    const normalizedBatchSize = normalizePositiveInteger(batchSize, normalizedDefaultBatchSize);
    const before = gameTime?.stamp?.() ?? null;
    const startedAt = performance.now();
    let advancedTicks = 0;
    let batches = 0;

    while (advancedTicks < requestedTicks) {
      const amount = Math.min(normalizedBatchSize, requestedTicks - advancedTicks);
      const advanced = Number(actionSystem.advanceTicks(amount, { publishUi: false }) ?? 0);
      if (advanced !== amount) throw new Error(`无界面回放推进数量不一致：请求 ${amount}，实际 ${advanced}`);
      advancedTicks += advanced;
      batches += 1;
      onBatch?.({ advancedTicks, requestedTicks, batches, batchSize: amount, time: gameTime?.stamp?.() ?? null });
    }

    const elapsedMs = performance.now() - startedAt;
    const after = gameTime?.stamp?.() ?? null;
    const result = Object.freeze({
      mode: 'headless',
      requestedTicks,
      advancedTicks,
      batches,
      batchSize: normalizedBatchSize,
      elapsedMs: Math.round(elapsedMs),
      ticksPerSecond: Math.round(advancedTicks / Math.max(0.001, elapsedMs / 1000)),
      before,
      after,
      eventBus: eventBus?.getDiagnostics?.() ?? null,
    });
    runs += 1;
    totalTicks += advancedTicks;
    totalElapsedMs += elapsedMs;
    lastRun = result;
    return result;
  }

  function getDiagnostics() {
    return {
      mode: 'headless',
      runs,
      totalTicks,
      totalElapsedMs: Math.round(totalElapsedMs),
      averageTicksPerSecond: Math.round(totalTicks / Math.max(0.001, totalElapsedMs / 1000)),
      lastRun,
      eventBus: eventBus?.getDiagnostics?.() ?? null,
    };
  }

  return Object.freeze({ advanceTicks, getDiagnostics });
}
