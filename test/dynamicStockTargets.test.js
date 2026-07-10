import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { buildPlanningStockTargets, planNextAction } from '../src/modules/actions/actionPlanner.js';
import { buildDynamicStockTargets } from '../src/modules/actions/stockTargetModel.js';

function person(overrides = {}) {
  return {
    id: overrides.id ?? 'person-1',
    identity: { alive: true, name: '测试村民' },
    location: { tileX: 1, tileY: 1 },
    inventory: { items: {} },
    state: { hunger: 20, thirst: 20, energy: 100, health: 100, stress: 0 },
    work: { occupation: 'gatherer', skills: { gathering: 5, fishing: 5, woodcutting: 5 }, preferences: [] },
    traits: [],
    relations: {},
    ...overrides,
  };
}

function fullTargets() {
  return {
    horizonDays: 3,
    goals: { water: 10, food: 10, wood: 10 },
    rawGoals: { water: 10, food: 10, wood: 10 },
    amounts: { effective: { water: 10, food: 10, wood: 10 } },
    shortageUnits: { water: 0, food: 0, wood: 0 },
    shortage: { water: 0, food: 0, wood: 0 },
    capacity: { constrained: false },
  };
}

test('初始 24 容量会把三日自然目标压缩到可实现预算', () => {
  const targets = buildDynamicStockTargets({
    population: 10,
    camp: { items: {}, storage: { capacity: 24 } },
    storage: { capacity: 24, protection: 0 },
    seasonId: 'spring',
    weather: { id: 'clear', temperature: 18 },
  });

  assert.deepEqual(targets.rawGoals, { water: 27, food: 23, wood: 12 });
  assert.deepEqual(targets.goals, { water: 10, food: 8, wood: 4 });
  assert.equal(Object.values(targets.goals).reduce((sum, value) => sum + value, 0), 22);
  assert.equal(targets.capacity.constrained, true);
});

test('冬季、冷雨、低保护和未预留建造需求会提高粮食与木材目标', () => {
  const spring = buildDynamicStockTargets({
    population: 10,
    camp: { items: {} },
    storage: { capacity: 200, protection: 0.5 },
    seasonId: 'spring',
    weather: { id: 'clear', temperature: 18 },
  });
  const winter = buildDynamicStockTargets({
    population: 10,
    camp: { items: {} },
    storage: { capacity: 200, protection: 0.5 },
    seasonId: 'winter',
    weather: { id: 'coldRain', temperature: 4 },
    constructionNeed: { wood: 12 },
  });

  assert.equal(winter.goals.food, 32);
  assert.equal(winter.goals.wood, 40);
  assert.ok(winter.goals.food > spring.goals.food);
  assert.ok(winter.goals.wood > spring.goals.wood);
  assert.equal(winter.drivers.unreservedConstructionWood, 12);
});

test('有效库存只计算现货、背包和在途资源，并扣除已承诺物资', () => {
  const targets = buildDynamicStockTargets({
    population: 10,
    camp: { items: { water: 5, berries: 4, millet: 2, wood: 7 } },
    storage: { capacity: 200, protection: 0.5 },
    seasonId: 'spring',
    weather: { id: 'clear', temperature: 18 },
    carried: { water: 2, berries: 1, wood: 3 },
    incoming: { water: 3, food: 2, wood: 5 },
    committed: { water: 1, millet: 1, wood: 4 },
  });

  assert.deepEqual(targets.amounts.onHand, { water: 5, food: 6, wood: 7 });
  assert.deepEqual(targets.amounts.carried, { water: 2, food: 1, wood: 3 });
  assert.deepEqual(targets.amounts.incoming, { water: 3, food: 2, wood: 5 });
  assert.deepEqual(targets.amounts.committed, { water: 1, food: 1, wood: 4 });
  assert.deepEqual(targets.amounts.effective, { water: 9, food: 8, wood: 11 });
});

test('规划上下文会把人物背包、执行中采集、工地预留和添柴承诺纳入缺口', () => {
  const originalRuntime = globalThis.shengling;
  globalThis.shengling = {
    seasonSystem: { get: () => ({ id: 'spring' }) },
    weatherSystem: { get: () => ({ id: 'clear', temperature: 18 }) },
    buildingSystem: {
      list: () => [{
        id: 'site-1',
        materials: { reservations: [{ itemId: 'wood', amount: 2, state: 'reserved' }] },
      }],
      getMaterialNeed: () => ({ wood: 4 }),
    },
  };

  try {
    const targets = buildPlanningStockTargets({
      population: 2,
      camp: { items: { water: 2, berries: 2, wood: 4 }, storage: { capacity: 100 } },
      storage: { capacity: 100, protection: 0 },
      people: [person({ inventory: { items: { water: 1, millet: 2, wood: 3 } } })],
      actionCounts: {
        [ACTION_TYPES.FETCH_WATER]: 2,
        [ACTION_TYPES.GATHER_BERRIES]: 1,
        [ACTION_TYPES.CHOP_TREE]: 1,
        [ACTION_TYPES.TEND_FIRE]: 1,
      },
    });

    assert.deepEqual(targets.amounts.carried, { water: 1, food: 2, wood: 3 });
    assert.deepEqual(targets.amounts.incoming, { water: 6, food: 3, wood: 5 });
    assert.deepEqual(targets.amounts.committed, { water: 0, food: 0, wood: 3 });
    assert.deepEqual(targets.amounts.effective, { water: 9, food: 7, wood: 9 });
    assert.equal(targets.drivers.unreservedConstructionWood, 4);
  } finally {
    globalThis.shengling = originalRuntime;
  }
});

test('库存目标已满足时，非紧急村民不会继续创建采集任务', () => {
  let waterQueries = 0;
  let featureQueries = 0;
  const task = planNextAction({
    person: person(),
    camp: { id: 'starting-camp', anchor: { x: 1, y: 1 }, items: { water: 10, berries: 10, wood: 10 } },
    population: 1,
    people: [person()],
    storage: { capacity: 100, available: 70 },
    mapSystem: {
      findNearestWaterAccess() { waterQueries += 1; return { x: 2, y: 2 }; },
      findNearestFeature() { featureQueries += 1; return { id: 'resource', x: 2, y: 2, resource: { berries: 3, wood: 5 } }; },
      findNearestWalkableNeighbor() { return { x: 2, y: 2 }; },
    },
    actionCounts: {},
    reservedFeatureIds: new Set(),
    stockTargets: fullTargets(),
  });

  assert.equal(task, null);
  assert.equal(waterQueries, 0);
  assert.equal(featureQueries, 0);
});
