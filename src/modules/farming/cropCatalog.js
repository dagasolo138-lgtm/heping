export const CROP_TYPES = Object.freeze({
  millet: {
    id: 'millet',
    label: '粟米',
    seedLabel: '粟种',
    itemId: 'millet',
    seedItemId: 'milletSeed',
    seedsPerPlanting: 1,
    seedShare: 0.15,
    minimumSeedReturn: 2,
    harvestYield: 8,
    growthRequiredMinutes: 1440,
    soilDepletion: 18,
  },
});

const WEATHER_GROWTH_MULTIPLIERS = Object.freeze({
  clear: 1,
  cloudy: 0.86,
  rain: 1.28,
  cold: 0.54,
  coldRain: 0.7,
});

export function getCropType(cropId) {
  const crop = CROP_TYPES[cropId];
  if (!crop) throw new Error(`未知作物：${cropId}`);
  return crop;
}

export function cropGrowthMultiplier(weather) {
  return Number(WEATHER_GROWTH_MULTIPLIERS[weather?.id] ?? 1);
}
