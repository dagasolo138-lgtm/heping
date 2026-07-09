export const FOOD_STORAGE_SCHEMA_VERSION = 1;

const FOOD_DECAY_PER_MINUTE = Object.freeze({
  berries: 0.022,
  millet: 0.0065,
});

const WEATHER_DECAY_MULTIPLIER = Object.freeze({
  clear: 0.8,
  cloudy: 1,
  rain: 2.1,
  cold: 0.7,
  coldRain: 2.5,
});

const SYNC_INTERVAL_MINUTES = 30;

function clone(value) {
  return structuredClone(value);
}

function round(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function weatherMultiplier(weather) {
  return Number(WEATHER_DECAY_MULTIPLIER[weather?.id] ?? 1);
}

function protectionMultiplier(protection) {
  return Math.max(0.28, 1 - Math.min(1, Number(protection ?? 0)) * 0.72);
}

function foodRates(weather, protection) {
  const weatherFactor = weatherMultiplier(weather);
  const storageFactor = protectionMultiplier(protection);
  return Object.fromEntries(Object.entries(FOOD_DECAY_PER_MINUTE).map(([itemId, rate]) => [
    itemId,
    round(rate * weatherFactor * storageFactor),
  ]));
}

export function createFoodStorageSystem({ eventBus, gameTime, campStore, campId = 'starting-camp' }) {
  let lastProcessedTick = Number(gameTime.now().tick ?? 0);
  let lastWeather = null;
  let lastResult = null;

  function getSummary() {
    const storage = campStore.getStorage(campId);
    const food = campStore.getFoodSummary(campId);
    const weather = lastWeather;
    const rates = foodRates(weather, storage?.protection ?? 0);
    return {
      storage: storage ? clone(storage) : null,
      food: food ? clone(food) : null,
      weather: weather ? clone(weather) : null,
      decayPerMinute: rates,
      lastResult: lastResult ? clone(lastResult) : null,
    };
  }

  function sync(weather) {
    lastWeather = weather ? clone(weather) : lastWeather;
    const nowTick = Number(gameTime.now().tick ?? 0);
    const elapsedMinutes = nowTick - lastProcessedTick;
    if (elapsedMinutes < SYNC_INTERVAL_MINUTES) return getSummary();
    lastProcessedTick = nowTick;

    const storage = campStore.getStorage(campId);
    const rates = foodRates(lastWeather, storage?.protection ?? 0);
    const result = campStore.ageFood(campId, {
      elapsedMinutes,
      decayPerMinute: rates,
      reason: 'food:weather-decay',
    });
    lastResult = {
      elapsedMinutes,
      weatherId: lastWeather?.id ?? 'clear',
      storageProtection: Number(storage?.protection ?? 0),
      rates,
      ...(result ?? { changed: false, spoiled: {} }),
    };

    eventBus.emit('storage:food-aged', {
      summary: getSummary(),
      result: clone(lastResult),
      time: gameTime.stamp(),
    });
    if (Object.values(lastResult.spoiled ?? {}).some((amount) => amount > 0)) {
      eventBus.emit('storage:food-spoiled', {
        spoiled: clone(lastResult.spoiled),
        summary: getSummary(),
        time: gameTime.stamp(),
      });
    }
    return getSummary();
  }

  function exportState() {
    return {
      schemaVersion: FOOD_STORAGE_SCHEMA_VERSION,
      exportedAt: gameTime.stamp(),
      lastProcessedTick,
      lastWeather: lastWeather ? clone(lastWeather) : null,
      lastResult: lastResult ? clone(lastResult) : null,
    };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== FOOD_STORAGE_SCHEMA_VERSION) {
      throw new Error('食物储存存档格式不兼容。');
    }
    lastProcessedTick = Math.max(0, Number(snapshot.lastProcessedTick ?? gameTime.now().tick ?? 0));
    lastWeather = snapshot.lastWeather ? clone(snapshot.lastWeather) : null;
    lastResult = snapshot.lastResult ? clone(snapshot.lastResult) : null;
    eventBus.emit('storage:food-hydrated', { summary: getSummary(), time: gameTime.stamp() });
    return getSummary();
  }

  eventBus.on('simulation:time', ({ weather }) => { sync(weather); });

  return Object.freeze({ sync, getSummary, exportState, importState });
}
