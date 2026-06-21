const EXPOSURE_KEY = 'environment.exposure';

function clamp(value, min = 0, max = 100) {
  return Math.max(min, Math.min(max, value));
}

function inside(building, point) {
  return point.x >= building.anchor.x
    && point.x <= building.anchor.x + building.footprint.width
    && point.y >= building.anchor.y
    && point.y <= building.anchor.y + building.footprint.height;
}

export function getExposure(person) {
  const stored = person.extensions?.[EXPOSURE_KEY] ?? {};
  return {
    wetness: Number(stored.wetness ?? 0),
    cold: Number(stored.cold ?? 0),
  };
}

export function evaluateExposure({ person, agent, weather, fireSystem, buildingSystem, seconds }) {
  const previous = getExposure(person);
  const residence = buildingSystem.getResidenceFor(person.id);
  const sheltered = Boolean(residence && inside(residence, agent));
  const warm = fireSystem.isWarmAt(agent);
  let wetness = previous.wetness;
  let cold = previous.cold;

  if (weather.isRain && !sheltered) {
    wetness += seconds * weather.wetnessRate * (warm ? 0.58 : 1);
  } else {
    wetness -= seconds * (sheltered ? 3.2 : warm ? 1.35 : 0.22);
  }

  const coldPressure = Math.max(0, 10 - Number(weather.temperature ?? 12));
  if (!sheltered && !warm && coldPressure > 0) {
    cold += seconds * (weather.coldRate + coldPressure * 0.09 + wetness * 0.01);
  } else {
    cold -= seconds * (sheltered ? 2.55 : warm ? 3.2 : 0.3);
  }

  wetness = Math.round(clamp(wetness) * 10) / 10;
  cold = Math.round(clamp(cold) * 10) / 10;
  const soaked = wetness >= 45;
  const chilled = cold >= 45;
  const stateDelta = {
    energy: -(soaked ? seconds * 0.024 : 0) - (chilled ? seconds * 0.032 : 0),
    stress: (soaked ? seconds * 0.032 : 0) + (chilled ? seconds * 0.045 : 0),
    health: cold >= 78 ? -seconds * 0.022 : 0,
  };

  return {
    exposure: { wetness, cold },
    sheltered,
    warm,
    tags: {
      soaked,
      chilled,
      warm,
      dry: sheltered && wetness <= 8,
    },
    stateDelta,
  };
}

export function relieveExposure(person, { wetness = 0, cold = 0 } = {}) {
  const current = getExposure(person);
  return {
    wetness: Math.round(clamp(current.wetness - wetness) * 10) / 10,
    cold: Math.round(clamp(current.cold - cold) * 10) / 10,
  };
}

export { EXPOSURE_KEY };
