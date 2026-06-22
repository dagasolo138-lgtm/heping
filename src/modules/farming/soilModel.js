export const SOIL_LIMITS = Object.freeze({
  min: 0,
  max: 100,
  initialFertility: 78,
  recoveryPerWorldMinute: 0.0015,
  harvestDepletion: 18,
});

function clamp(value) {
  return Math.max(SOIL_LIMITS.min, Math.min(SOIL_LIMITS.max, Number(value) || 0));
}

export function createSoil(tick = 0) {
  return {
    fertility: SOIL_LIMITS.initialFertility,
    lastTick: Number(tick) || 0,
    harvests: 0,
  };
}

export function soilBand(fertility) {
  const value = clamp(fertility);
  if (value >= 80) return { id: 'rich', label: '肥沃' };
  if (value >= 55) return { id: 'steady', label: '尚可' };
  if (value >= 30) return { id: 'poor', label: '贫瘠' };
  return { id: 'thin', label: '瘠薄' };
}

export function describeSoil(soil) {
  const fertility = Math.round(clamp(soil?.fertility));
  return {
    fertility,
    harvests: Number(soil?.harvests ?? 0),
    ...soilBand(fertility),
  };
}

export function soilGrowthMultiplier(soil) {
  const fertility = clamp(soil?.fertility);
  if (fertility >= 80) return 1.06;
  if (fertility >= 55) return 0.96;
  if (fertility >= 30) return 0.78;
  return 0.6;
}

export function soilYieldMultiplier(soil) {
  const fertility = clamp(soil?.fertility);
  if (fertility >= 80) return 1.12;
  if (fertility >= 55) return 1;
  if (fertility >= 30) return 0.8;
  return 0.62;
}

export function recoverSoil(soil, elapsedMinutes, canRecover) {
  if (!soil) return false;
  const elapsed = Math.max(0, Number(elapsedMinutes) || 0);
  const before = clamp(soil.fertility);
  const next = canRecover ? clamp(before + elapsed * SOIL_LIMITS.recoveryPerWorldMinute) : before;
  soil.fertility = next;
  return Math.floor(before) !== Math.floor(next);
}

export function depleteSoil(soil, amount = SOIL_LIMITS.harvestDepletion) {
  if (!soil) return describeSoil(null);
  soil.fertility = clamp(soil.fertility - Math.max(0, Number(amount) || 0));
  soil.harvests = Number(soil.harvests ?? 0) + 1;
  return describeSoil(soil);
}
