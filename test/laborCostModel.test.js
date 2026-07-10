import test from 'node:test';
import assert from 'node:assert/strict';

import { TERRAIN } from '../src/data/constants/terrain.js';
import { ACTION_META, ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { createRuntimeTask, advanceRuntimeTask } from '../src/modules/actions/actionExecutor.js';
import { buildLaborCostProfile, movementLaborMultiplier } from '../src/modules/actions/laborCostModel.js';

function person({ energy = 90, skill = 4, items = {} } = {}) {
  return {
    id: 'person-1',
    identity: { alive: true },
    location: { tileX: 0, tileY: 0 },
    state: { energy },
    work: { skills: { woodcutting: skill, gathering: skill, fishing: skill, building: skill } },
    inventory: { items },
  };
}

function task(type = ACTION_TYPES.CHOP_TREE, destination = { x: 10, y: 0 }) {
  return {
    id: 'task-1',
    type,
    label: ACTION_META[type].label,
    phaseLabel: ACTION_META[type].phaseLabel,
    destination,
    workDuration: ACTION_META[type].workDuration,
    data: {},
  };
}

function mapWith(terrain) {
  return {
    isWalkable: (x, y) => x >= 0 && y >= 0 && x <= 20 && y <= 20,
    getTile: (x, y) => ({ x, y, terrain, elevation: 50 }),
  };
}

const clear = { movementMultiplier: 1, workMultiplier: 1, key: 'clear' };
const coldRain = { movementMultiplier: 0.72, workMultiplier: 0.64, key: 'cold-rain' };

function profile(options = {}) {
  const worker = options.person ?? person();
  const planned = options.task ?? task();
  return buildLaborCostProfile({
    person: worker,
    task: planned,
    position: { x: 0, y: 0 },
    route: [{ x: 5, y: 0 }, planned.destination],
    mapSystem: options.mapSystem ?? mapWith(TERRAIN.GRASS),
    roadSystem: options.roadSystem ?? { getMovementMultiplierAt: () => 1 },
    weather: options.weather ?? clear,
  });
}

test('重载与困难地形同时提高耗时和能耗', () => {
  const light = profile({ person: person({ items: {} }), mapSystem: mapWith(TERRAIN.GRASS) });
  const heavy = profile({ person: person({ items: { wood: 5, water: 2 } }), mapSystem: mapWith(TERRAIN.SAND) });
  assert.ok(heavy.loadWeight > light.loadWeight);
  assert.ok(heavy.factors.terrain < light.factors.terrain);
  assert.ok(heavy.expectedDuration > light.expectedDuration);
  assert.ok(heavy.expectedEnergy > light.expectedEnergy);
});

test('道路降低预计通勤时间与能耗', () => {
  const withoutRoad = profile({ roadSystem: { getMovementMultiplierAt: () => 1 } });
  const dirtRoad = profile({ roadSystem: { getMovementMultiplierAt: () => 1.16 } });
  assert.ok(dirtRoad.factors.road > withoutRoad.factors.road);
  assert.ok(dirtRoad.travelSeconds < withoutRoad.travelSeconds);
  assert.ok(dirtRoad.expectedEnergy < withoutRoad.expectedEnergy);
});

test('恶劣天气与低精力提高劳动成本', () => {
  const normal = profile({ person: person({ energy: 90 }), weather: clear });
  const exhausted = profile({ person: person({ energy: 25 }), weather: coldRain });
  assert.ok(exhausted.factors.fatigueWork > normal.factors.fatigueWork);
  assert.ok(exhausted.expectedDuration > normal.expectedDuration);
  assert.ok(exhausted.expectedEnergy > normal.expectedEnergy);
});

test('更高技能降低同类劳动的额外能耗', () => {
  const novice = profile({ person: person({ skill: 0 }) });
  const expert = profile({ person: person({ skill: 10 }) });
  assert.ok(expert.factors.skillEnergy < novice.factors.skillEnergy);
  assert.ok(expert.expectedEnergy < novice.expectedEnergy);
});

test('运行时移动倍率读取地形、道路和负重', () => {
  const worker = person({ items: { wood: 4 } });
  const planned = { ...task(ACTION_TYPES.HAUL_TO_CAMP), data: { laborCost: { loadWeight: 5.6 } } };
  const poor = movementLaborMultiplier({
    person: worker,
    task: planned,
    agent: { x: 2, y: 2 },
    mapSystem: mapWith(TERRAIN.SAND),
    roadSystem: { getMovementMultiplierAt: () => 1 },
  });
  const improved = movementLaborMultiplier({
    person: worker,
    task: planned,
    agent: { x: 2, y: 2 },
    mapSystem: mapWith(TERRAIN.DIRT),
    roadSystem: { getMovementMultiplierAt: () => 1.16 },
  });
  assert.ok(poor < 1);
  assert.ok(improved > poor);
});

test('任务执行保存劳动快照并结算额外精力', () => {
  const originalRuntime = globalThis.shengling;
  const worker = person({ energy: 100, skill: 0, items: { wood: 5 } });
  const mapSystem = mapWith(TERRAIN.SAND);
  const peopleSystem = {
    getRuntime: () => structuredClone(worker),
    patchState: (_id, patch) => {
      worker.state.energy = patch.energy;
      return structuredClone(worker);
    },
  };
  globalThis.shengling = {
    peopleSystem,
    mapSystem,
    roadSystem: { getMovementMultiplierAt: () => 1 },
    weatherSystem: { get: () => structuredClone(coldRain) },
  };
  try {
    const agent = { personId: worker.id, x: 0, y: 0, task: null };
    agent.task = createRuntimeTask(task(ACTION_TYPES.CHOP_TREE, { x: 2, y: 0 }), agent, mapSystem);
    assert.ok(agent.task.data.laborCost);
    assert.ok(agent.task.workDuration >= ACTION_META[ACTION_TYPES.CHOP_TREE].workDuration);
    for (let index = 0; index < 120 && agent.task; index += 1) {
      const result = advanceRuntimeTask(agent, 0.25, 0.8);
      if (result?.kind === 'completed') break;
    }
    assert.ok(agent.task.laborEnergySpent > 0);
    assert.ok(worker.state.energy < 100);
  } finally {
    globalThis.shengling = originalRuntime;
  }
});
