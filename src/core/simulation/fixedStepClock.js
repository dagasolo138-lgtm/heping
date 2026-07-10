export const WORLD_MINUTES_PER_REAL_SECOND = 6;
export const WORLD_MINUTES_PER_TICK = 1;
export const SIMULATION_SECONDS_PER_TICK = WORLD_MINUTES_PER_TICK / WORLD_MINUTES_PER_REAL_SECOND;

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, Number(value) || 0));
}

export function createFixedStepClock({ maxTicksPerFrame = 240, maxRealDeltaSeconds = 0.25 } = {}) {
  let accumulatorMinutes = 0;
  let totalTicks = 0;

  function consume(realDeltaSeconds, speed = 1) {
    const realDelta = clamp(realDeltaSeconds, 0, maxRealDeltaSeconds);
    const worldSpeed = clamp(speed, 0.5, 10);
    accumulatorMinutes += realDelta * worldSpeed * WORLD_MINUTES_PER_REAL_SECOND;
    const availableTicks = Math.floor(accumulatorMinutes / WORLD_MINUTES_PER_TICK);
    const ticks = Math.min(Math.max(0, Math.floor(maxTicksPerFrame)), availableTicks);
    accumulatorMinutes -= ticks * WORLD_MINUTES_PER_TICK;
    totalTicks += ticks;
    return ticks;
  }

  function reset() {
    accumulatorMinutes = 0;
    totalTicks = 0;
  }

  function getDiagnostics() {
    return {
      accumulatorMinutes,
      totalTicks,
      maxTicksPerFrame,
      maxRealDeltaSeconds,
      worldMinutesPerTick: WORLD_MINUTES_PER_TICK,
      simulationSecondsPerTick: SIMULATION_SECONDS_PER_TICK,
    };
  }

  return Object.freeze({ consume, reset, getDiagnostics });
}
