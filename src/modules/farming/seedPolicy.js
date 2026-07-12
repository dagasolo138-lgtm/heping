export const MILLET_SEED_ITEM_ID = 'milletSeed';
export const SEED_BUFFER_PLANTINGS = 1;

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

export function splitMilletHarvest(totalAmount, { seedShare = 0.15, minimumSeedReturn = 1 } = {}) {
  const total = Math.max(0, Math.floor(Number(totalAmount) || 0));
  if (total <= 0) return { totalAmount: 0, foodAmount: 0, seedAmount: 0 };
  if (total === 1) return { totalAmount: 1, foodAmount: 0, seedAmount: 1 };

  const requestedSeeds = Math.max(
    Math.max(0, Math.floor(Number(minimumSeedReturn) || 0)),
    Math.round(total * Math.max(0, Number(seedShare) || 0)),
  );
  const seedAmount = Math.min(total - 1, requestedSeeds);
  return {
    totalAmount: total,
    foodAmount: total - seedAmount,
    seedAmount,
  };
}

export function buildSeedStockTarget({ fields = [], campAmount = 0, carriedAmount = 0, inTransitAmount = 0, bufferPlantings = SEED_BUFFER_PLANTINGS } = {}) {
  const fieldCount = fields.filter((field) => field && field.status !== 'abandoned').length;
  const requiredPlantings = Math.max(0, fieldCount);
  const buffer = Math.max(0, Math.floor(Number(bufferPlantings) || 0));
  const target = requiredPlantings + buffer;
  const camp = round(Math.max(0, Number(campAmount) || 0));
  const carried = round(Math.max(0, Number(carriedAmount) || 0));
  const inTransit = round(Math.max(0, Number(inTransitAmount) || 0));
  const onHand = round(camp + carried);
  return {
    itemId: MILLET_SEED_ITEM_ID,
    requiredPlantings,
    buffer,
    target,
    camp,
    carried,
    inTransit,
    onHand,
    availableAtCamp: camp,
    shortage: round(Math.max(0, target - onHand)),
  };
}

export function verifyHarvestSplit(result) {
  const issues = [];
  const total = Number(result?.totalAmount ?? 0);
  const food = Number(result?.foodAmount ?? 0);
  const seeds = Number(result?.seedAmount ?? 0);
  if (total < 0 || food < 0 || seeds < 0) issues.push({ type: 'negative-harvest-split', result });
  if (Math.abs(total - food - seeds) > 0.001) issues.push({ type: 'harvest-split-mismatch', result });
  return { ok: issues.length === 0, issues };
}
