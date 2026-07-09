const DEFAULT_GOALS = Object.freeze({ waterPerPerson: 3, foodPerPerson: 2, woodPerPerson: 2.5 });

function amount(items, itemId) {
  return Number(items?.[itemId] ?? 0);
}

function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function currentSeasonId() {
  return globalThis.shengling?.seasonSystem?.get?.().id ?? 'spring';
}

function seasonalGoalMultiplier(resource) {
  const seasonId = currentSeasonId();
  if (seasonId !== 'winter') return 1;
  if (resource === 'food') return 1.35;
  if (resource === 'wood') return 1.55;
  return 1;
}

function shortage(current, goal) {
  return goal <= 0 ? 0 : clamp01((goal - current) / goal);
}

export function campScarcity({ camp, population }) {
  const items = camp?.items ?? {};
  const waterGoal = Math.max(12, population * DEFAULT_GOALS.waterPerPerson);
  const foodGoal = Math.max(10, population * DEFAULT_GOALS.foodPerPerson * seasonalGoalMultiplier('food'));
  const woodGoal = Math.max(18, population * DEFAULT_GOALS.woodPerPerson * seasonalGoalMultiplier('wood'));
  const food = amount(items, 'berries') + amount(items, 'millet');

  return Object.freeze({
    seasonId: currentSeasonId(),
    goals: Object.freeze({ water: waterGoal, food: foodGoal, wood: woodGoal }),
    amounts: Object.freeze({ water: amount(items, 'water'), food, wood: amount(items, 'wood') }),
    shortage: Object.freeze({
      water: shortage(amount(items, 'water'), waterGoal),
      food: shortage(food, foodGoal),
      wood: shortage(amount(items, 'wood'), woodGoal),
    }),
  });
}

export function scarcityForAction(type, scarcity) {
  if (type === 'fetchWater') return scarcity.shortage.water;
  if (type === 'gatherBerries') return scarcity.shortage.food;
  if (type === 'chopTree') return scarcity.shortage.wood;
  if (type === 'haulToCamp') return Math.max(scarcity.shortage.water, scarcity.shortage.food, scarcity.shortage.wood) * 0.35;
  return 0;
}
