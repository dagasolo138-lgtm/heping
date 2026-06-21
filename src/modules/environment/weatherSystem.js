import { hashSeed } from '../../core/random/seededRandom.js';

const WINDOW_MINUTES = 240;

export const WEATHER_PROFILES = Object.freeze({
  clear: {
    id: 'clear', label: '晴朗', temperature: 18, isRain: false,
    movementMultiplier: 1, workMultiplier: 1, wetnessRate: 0, coldRate: 0,
  },
  cloudy: {
    id: 'cloudy', label: '阴天', temperature: 12, isRain: false,
    movementMultiplier: 0.96, workMultiplier: 0.95, wetnessRate: 0, coldRate: 0.15,
  },
  rain: {
    id: 'rain', label: '降雨', temperature: 10, isRain: true,
    movementMultiplier: 0.82, workMultiplier: 0.76, wetnessRate: 1.8, coldRate: 0.42,
  },
  cold: {
    id: 'cold', label: '寒冷', temperature: 5, isRain: false,
    movementMultiplier: 0.9, workMultiplier: 0.86, wetnessRate: 0, coldRate: 0.75,
  },
  coldRain: {
    id: 'coldRain', label: '冷雨', temperature: 4, isRain: true,
    movementMultiplier: 0.72, workMultiplier: 0.64, wetnessRate: 2.25, coldRate: 1.15,
  },
});

function timeWindow(time) {
  return Math.floor((Number(time?.minute ?? 0) % 1440) / WINDOW_MINUTES);
}

function chooseProfileId(time, seed) {
  const window = timeWindow(time);
  if (Number(time?.year ?? 1) === 1 && Number(time?.day ?? 1) === 1) {
    return ['cold', 'cloudy', 'clear', 'rain', 'coldRain', 'cold'][window] ?? 'cloudy';
  }
  const random = hashSeed(`${seed}:${time?.year}:${time?.day}:${window}`) / 4294967295;
  if (random < 0.34) return 'clear';
  if (random < 0.58) return 'cloudy';
  if (random < 0.79) return 'rain';
  if (random < 0.91) return 'cold';
  return 'coldRain';
}

function buildWeather(time, seed, season) {
  const window = timeWindow(time);
  const profile = WEATHER_PROFILES[chooseProfileId(time, seed)];
  const variation = (hashSeed(`${seed}:temperature:${time?.year}:${time?.day}:${window}`) % 5) - 2;
  const seasonTemperatureModifier = Number(season?.temperatureModifier ?? 0);
  const temperature = profile.temperature + variation + seasonTemperatureModifier;
  return {
    ...profile,
    key: `${time?.year}:${time?.day}:${window}:${season?.id ?? 'base'}`,
    baseTemperature: profile.temperature + variation,
    seasonId: season?.id ?? null,
    seasonTemperatureModifier,
    temperature,
    requiresFire: profile.isRain || temperature <= 8,
    window,
  };
}

export function createWeatherSystem({ eventBus, gameTime, seed = 'starting-valley-weather-v1' }) {
  let seasonSystem = null;
  let weather = buildWeather(gameTime.now(), seed, null);

  function getSeason() {
    return seasonSystem?.get?.() ?? null;
  }

  function get() {
    return structuredClone(weather);
  }

  function refresh({ emit = true } = {}) {
    const next = buildWeather(gameTime.now(), seed, getSeason());
    const changed = next.key !== weather.key || next.temperature !== weather.temperature;
    weather = next;
    if (emit && changed) eventBus.emit('environment:weather', { weather: get(), time: gameTime.stamp() });
    return get();
  }

  function sync() {
    return refresh();
  }

  function setSeasonSystem(nextSeasonSystem) {
    seasonSystem = nextSeasonSystem;
    return refresh();
  }

  return Object.freeze({ get, sync, setSeasonSystem });
}
