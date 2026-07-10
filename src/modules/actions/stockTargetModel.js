export const STOCK_TARGET_HORIZON_DAYS = 3;

const TARGET_KEYS = Object.freeze(['water', 'food', 'wood']);
const DAILY_CONSUMPTION = Object.freeze({ water: 0.9, food: 0.72 });
const SEASON_MULTIPLIER = Object.freeze({
  spring: { food: 1, wood: 1 },
  summer: { food: 1, wood: 0.9 },
  autumn: { food: 1.12, wood: 1.18 },
  winter: { food: 1.3, wood: 1.75 },
});
const WEATHER_FOOD_RISK = Object.freeze({ clear: 0.04, cloudy: 0.1, rain: 0.22, cold: 0.02, coldRain: 0.26 });
const WEATHER_WOOD_DAILY = Object.freeze({ clear: 0, cloudy: 0.4, rain: 2, cold: 1.5, coldRain: 3 });

function amount(items, itemId) {
  return Math.max(0, Number(items?.[itemId] ?? 0));
}

function round(value, digits = 2) {
  const factor = 10 ** digits;
  return Math.round(Number(value || 0) * factor) / factor;
}

function resourceVector(input = {}) {
  return {
    water: amount(input, 'water'),
    food: amount(input, 'food') + amount(input, 'berries') + amount(input, 'millet'),
    wood: amount(input, 'wood'),
  };
}

function temperatureWaterMultiplier(temperature) {
  const value = Number(temperature ?? 18);
  if (value >= 28) return 1.28;
  if (value >= 22) return 1.14;
  if (value <= 2) return 1.05;
  return 1;
}

function foodSpoilageBuffer(weather, protection) {
  const risk = Number(WEATHER_FOOD_RISK[weather?.id] ?? 0.08);
  const exposedShare = 1 - Math.min(1, Math.max(0, Number(protection ?? 0)));
  return 1 + risk * exposedShare;
}

function fuelPerDay(seasonId, weather) {
  const season = SEASON_MULTIPLIER[seasonId] ?? SEASON_MULTIPLIER.spring;
  const baseNightFuel = 3.2 * Number(season.wood ?? 1);
  return baseNightFuel + Number(WEATHER_WOOD_DAILY[weather?.id] ?? 0.6);
}

function capacityBudget(camp, storage) {
  const capacity = Number(storage?.capacity ?? camp?.storage?.capacity ?? Infinity);
  if (!Number.isFinite(capacity)) return Infinity;
  const targetShare = Math.floor(Math.max(0, capacity) * 0.92);
  const targetItems = new Set(['water', 'berries', 'millet', 'wood']);
  const otherStored = Object.entries(camp?.items ?? {})
    .filter(([itemId]) => !targetItems.has(itemId))
    .reduce((total, [, value]) => total + Math.max(0, Number(value) || 0), 0);
  return Math.max(0, targetShare - otherStored);
}

function allocateWithinCapacity(rawGoals, budget) {
  const naturalTotal = TARGET_KEYS.reduce((total, key) => total + rawGoals[key], 0);
  if (!Number.isFinite(budget) || naturalTotal <= budget) return { goals: { ...rawGoals }, constrained: false, naturalTotal };
  if (budget <= 0 || naturalTotal <= 0) {
    return { goals: { water: 0, food: 0, wood: 0 }, constrained: naturalTotal > 0, naturalTotal };
  }

  const exact = TARGET_KEYS.map((key, priority) => {
    const value = rawGoals[key] * budget / naturalTotal;
    return { key, value, floor: Math.floor(value), fraction: value - Math.floor(value), priority };
  });
  const goals = Object.fromEntries(exact.map((entry) => [entry.key, entry.floor]));
  let remainder = Math.max(0, Math.floor(budget) - Object.values(goals).reduce((total, value) => total + value, 0));
  exact
    .sort((first, second) => second.fraction - first.fraction || first.priority - second.priority)
    .forEach((entry) => {
      if (remainder <= 0) return;
      goals[entry.key] += 1;
      remainder -= 1;
    });
  return { goals, constrained: true, naturalTotal };
}

function freezeVector(vector) {
  return Object.freeze(Object.fromEntries(TARGET_KEYS.map((key) => [key, round(vector[key])])));
}

export function buildDynamicStockTargets({
  population = 0,
  camp = null,
  storage = null,
  seasonId = 'spring',
  weather = null,
  carried = {},
  incoming = {},
  committed = {},
  constructionNeed = {},
} = {}) {
  const people = Math.max(0, Number(population) || 0);
  const season = SEASON_MULTIPLIER[seasonId] ?? SEASON_MULTIPLIER.spring;
  const protection = Number(storage?.protection ?? camp?.storage?.protection ?? 0);
  const waterMultiplier = temperatureWaterMultiplier(weather?.temperature);
  const spoilageBuffer = foodSpoilageBuffer(weather, protection);
  const dailyFuel = fuelPerDay(seasonId, weather);
  const rawGoals = {
    water: Math.ceil(people * DAILY_CONSUMPTION.water * STOCK_TARGET_HORIZON_DAYS * waterMultiplier),
    food: Math.ceil(people * DAILY_CONSUMPTION.food * STOCK_TARGET_HORIZON_DAYS * Number(season.food ?? 1) * spoilageBuffer),
    wood: Math.ceil(dailyFuel * STOCK_TARGET_HORIZON_DAYS + amount(constructionNeed, 'wood') + people * 0.15),
  };
  const budget = capacityBudget(camp, storage);
  const allocation = allocateWithinCapacity(rawGoals, budget);
  const onHand = resourceVector(camp?.items ?? {});
  const carriedVector = resourceVector(carried);
  const incomingVector = resourceVector(incoming);
  const committedVector = resourceVector(committed);
  const effective = Object.fromEntries(TARGET_KEYS.map((key) => [
    key,
    Math.max(0, onHand[key] + carriedVector[key] + incomingVector[key] - committedVector[key]),
  ]));
  const shortageUnits = Object.fromEntries(TARGET_KEYS.map((key) => [key, Math.max(0, allocation.goals[key] - effective[key])]));
  const shortage = Object.fromEntries(TARGET_KEYS.map((key) => [
    key,
    allocation.goals[key] > 0 ? Math.min(1, shortageUnits[key] / allocation.goals[key]) : 0,
  ]));

  return Object.freeze({
    horizonDays: STOCK_TARGET_HORIZON_DAYS,
    seasonId,
    weatherId: weather?.id ?? null,
    goals: freezeVector(allocation.goals),
    rawGoals: freezeVector(rawGoals),
    amounts: Object.freeze({
      onHand: freezeVector(onHand),
      carried: freezeVector(carriedVector),
      incoming: freezeVector(incomingVector),
      committed: freezeVector(committedVector),
      effective: freezeVector(effective),
    }),
    shortageUnits: freezeVector(shortageUnits),
    shortage: freezeVector(shortage),
    capacity: Object.freeze({
      budget: Number.isFinite(budget) ? budget : null,
      naturalTotal: allocation.naturalTotal,
      constrained: allocation.constrained,
    }),
    drivers: Object.freeze({
      dailyWaterPerPerson: DAILY_CONSUMPTION.water,
      dailyFoodPerPerson: DAILY_CONSUMPTION.food,
      waterTemperatureMultiplier: round(waterMultiplier),
      foodSeasonMultiplier: Number(season.food ?? 1),
      foodSpoilageBuffer: round(spoilageBuffer),
      storageProtection: round(protection),
      fuelPerDay: round(dailyFuel),
      unreservedConstructionWood: amount(constructionNeed, 'wood'),
    }),
    hasShortage: TARGET_KEYS.some((key) => shortageUnits[key] > 0),
  });
}

export function stockResourceForAction(type) {
  if (type === 'fetchWater') return 'water';
  if (type === 'gatherBerries') return 'food';
  if (type === 'chopTree') return 'wood';
  return null;
}
