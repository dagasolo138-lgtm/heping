import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { planConstructionAction } from '../src/modules/actions/constructionPlanner.js';
import { planFarmAction } from '../src/modules/actions/farmPlanner.js';

function person(overrides = {}) {
  return {
    id: 'p1',
    location: { tileX: 0, tileY: 0 },
    state: { energy: 80, hunger: 0, thirst: 0, stress: 0, fatigue: 0, statusTags: [] },
    work: { occupation: 'unassigned', skills: { gathering: 2, building: 3 } },
    inventory: { items: {}, capacity: 20 },
    relations: {},
    family: {},
    ...overrides,
  };
}

function farmSystemFor(field, seedOverrides = {}) {
  return {
    nextWorkField: () => structuredClone(field),
    getFieldCenter: () => ({ x: 4, y: 4 }),
    getSeedPlan: () => ({
      cropId: 'millet',
      seedItemId: 'milletSeed',
      seedAmount: 1,
      target: 2,
      shortage: 0,
      availableAtCamp: 4,
      ...seedOverrides,
    }),
    canStartSowing: () => true,
  };
}

test('单个收获工位优先响应更高优先级承诺，不重复计算同一劳动', () => {
  const task = planFarmAction({
    person: person(),
    farmSystem: farmSystemFor({ id: 'field-1', status: 'mature', soil: { fertility: 70 } }),
    actionCounts: {},
    population: 10,
    commitments: [
      { id: 'harvest-window', type: 'harvest-millet-window', state: 'active', priority: 70, progress: 0 },
      { id: 'seed-shortage', type: 'restore-seed-reserve', state: 'active', priority: 90, progress: 0 },
    ],
  });

  assert.equal(task.type, ACTION_TYPES.HARVEST_MILLET);
  assert.equal(task.data.commitmentResponse.score, 16.2);
  assert.deepEqual(
    task.data.commitmentResponse.matches.map((entry) => entry.type),
    ['restore-seed-reserve'],
  );
  assert.equal(
    task.data.commitmentResponse.blocked.find((entry) => entry.type === 'harvest-millet-window')?.reason,
    'response-capacity-exhausted',
  );
});

test('雨天播种窗口进入合法播种任务的承诺注记', () => {
  const task = planFarmAction({
    person: person(),
    farmSystem: farmSystemFor({ id: 'field-1', status: 'readyToSow', soil: { fertility: 70 } }),
    actionCounts: {},
    population: 10,
    commitments: [
      { id: 'sowing-window', type: 'sow-millet-window', state: 'active', priority: 80, progress: 0 },
    ],
  });

  assert.equal(task.type, ACTION_TYPES.SOW_MILLET);
  assert.equal(task.data.commitmentResponse.score, 14.4);
  assert.equal(task.data.commitmentResponse.matches[0].type, 'sow-millet-window');
});

test('种子恢复承诺会暂缓消耗留种缓冲，缓冲充足后允许播种', () => {
  const commitment = {
    id: 'seed-shortage',
    type: 'restore-seed-reserve',
    state: 'active',
    priority: 90,
    progress: 0,
    goal: { metric: 'seed-stock', itemId: 'milletSeed', target: 3, unit: 'item' },
  };
  const blocked = planFarmAction({
    person: person(),
    farmSystem: farmSystemFor(
      { id: 'field-1', status: 'readyToSow', soil: { fertility: 70 } },
      { target: 3, availableAtCamp: 3 },
    ),
    actionCounts: {},
    commitments: [commitment],
  });
  const allowed = planFarmAction({
    person: person(),
    farmSystem: farmSystemFor(
      { id: 'field-1', status: 'readyToSow', soil: { fertility: 70 } },
      { target: 3, availableAtCamp: 4 },
    ),
    actionCounts: {},
    commitments: [commitment],
  });

  assert.equal(blocked, null);
  assert.equal(allowed.type, ACTION_TYPES.SOW_MILLET);
});

test('贫瘠田休耕与劳动积压会阻止对应的新农业任务', () => {
  const sowing = planFarmAction({
    person: person(),
    farmSystem: farmSystemFor({ id: 'field-1', status: 'readyToSow', soil: { fertility: 40 } }),
    actionCounts: {},
    commitments: [
      { id: 'soil', type: 'restore-soil-fertility', state: 'active', priority: 80, progress: 0 },
    ],
  });
  const clearing = planFarmAction({
    person: person(),
    farmSystem: farmSystemFor({ id: 'field-2', status: 'planned', soil: { fertility: 100 } }),
    actionCounts: {},
    commitments: [
      { id: 'backlog', type: 'reduce-labor-backlog', state: 'active', priority: 80, progress: 0 },
    ],
  });

  assert.equal(sowing, null);
  assert.equal(clearing, null);
});

test('储物棚建材运输与施工进入改善储存承诺响应', () => {
  const site = {
    id: 'storage-1',
    typeId: 'storageShed',
    status: 'planned',
    anchor: { x: 5, y: 5 },
    footprint: { width: 5, height: 4 },
  };
  const buildingSystem = {
    list: () => [structuredClone(site)],
    getConstructionSummary: () => ({
      ...structuredClone(site),
      status: 'planned',
      materialNeed: { wood: 2 },
      materialsReady: false,
    }),
    reserveMaterial: () => ({ id: 'reservation-1', itemId: 'wood', amount: 2 }),
  };
  const task = planConstructionAction({
    person: person(),
    camp: { anchor: { x: 0, y: 0 }, items: { wood: 3 } },
    buildingSystem,
    actionCounts: {},
    population: 10,
    commitments: [
      { id: 'storage', type: 'improve-storage', state: 'active', priority: 80, progress: 0 },
    ],
  });

  assert.equal(task.type, ACTION_TYPES.DELIVER_MATERIALS);
  assert.equal(task.data.buildingType, 'storageShed');
  assert.equal(task.data.commitmentResponse.score, 14.4);
  assert.equal(task.data.commitmentResponse.matches[0].type, 'improve-storage');
});
