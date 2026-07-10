import { buildDynamicStockTargets } from './stockTargetModel.js';

function currentSeasonId() {
  return globalThis.shengling?.seasonSystem?.get?.().id ?? 'spring';
}

export function campScarcity({ camp, population, stockTargets = null, storage = null, weather = null }) {
  if (stockTargets) return stockTargets;
  return buildDynamicStockTargets({
    camp,
    population,
    storage,
    weather,
    seasonId: currentSeasonId(),
  });
}

export function scarcityForAction(type, scarcity) {
  if (type === 'fetchWater') return scarcity.shortage.water;
  if (type === 'gatherBerries') return scarcity.shortage.food;
  if (type === 'chopTree') return scarcity.shortage.wood;
  if (type === 'haulToCamp') return Math.max(scarcity.shortage.water, scarcity.shortage.food, scarcity.shortage.wood) * 0.35;
  return 0;
}
