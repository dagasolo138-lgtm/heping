export const FARM_GROWTH_SYNC_INTERVAL_TICKS = 10;

function currentTick(gameTime) {
  return Number(gameTime?.now?.().tick ?? 0);
}

export function createFarmGrowthTickHandler({
  farmSystem,
  gameTime,
  intervalTicks = FARM_GROWTH_SYNC_INTERVAL_TICKS,
} = {}) {
  if (!farmSystem?.syncGrowth) throw new Error('农田生长调度缺少 farmSystem。');
  if (!gameTime?.now) throw new Error('农田生长调度缺少 gameTime。');

  const interval = Math.max(1, Math.floor(Number(intervalTicks) || 1));
  let lastSyncTick = currentTick(gameTime);
  let lastWeather = null;

  return function handleFarmGrowthTick({ weather } = {}) {
    const nowTick = currentTick(gameTime);
    const weatherChanged = lastWeather?.id !== undefined
      && weather?.id !== undefined
      && lastWeather.id !== weather.id;
    const elapsed = Math.max(0, nowTick - lastSyncTick);

    if (!weatherChanged && elapsed < interval) {
      if (weather) lastWeather = weather;
      return null;
    }

    const growthWeather = weatherChanged ? lastWeather : (weather ?? lastWeather);
    lastSyncTick = nowTick;
    if (weather) lastWeather = weather;
    return farmSystem.syncGrowth(growthWeather ?? weather ?? null);
  };
}
