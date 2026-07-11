import test from 'node:test';
import assert from 'node:assert/strict';

import { completeAction } from '../src/modules/actions/actionEffects.js';
import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';

function createPeopleSystem() {
  const itemChanges = [];
  const lifeEvents = [];
  let person = {
    id: 'person-1',
    identity: { name: '阿禾', alive: true },
    inventory: { items: {} },
    state: { energy: 80, stress: 10 },
    activity: { completedCount: 0 },
  };
  return {
    itemChanges,
    lifeEvents,
    get: () => structuredClone(person),
    changeItem: (personId, itemId, amount) => {
      itemChanges.push({ personId, itemId, amount });
      person.inventory.items[itemId] = Number(person.inventory.items[itemId] ?? 0) + amount;
    },
    setLocation: (_personId, location) => { person.location = { ...location }; },
    addLifeEvent: (personId, event) => lifeEvents.push({ personId, event: structuredClone(event) }),
    setActivity: (_personId, activity) => { person.activity = { ...person.activity, ...activity }; },
    patchState: (_personId, patch) => { person.state = { ...person.state, ...patch }; },
  };
}

function runResourceAction({ type, feature, itemId, ecologySystem }) {
  const peopleSystem = createPeopleSystem();
  const result = completeAction({
    agent: { personId: 'person-1', x: 2, y: 3 },
    task: {
      id: `task-${feature.id}`,
      type,
      label: type,
      data: { featureId: feature.id, yield: 2 },
    },
    peopleSystem,
    mapSystem: { removeFeature: (featureId) => featureId === feature.id ? structuredClone(feature) : null },
    campStore: null,
    ecologySystem,
    gameTime: { stamp: () => ({ year: 1, day: 1, minute: 600, tick: 120 }) },
    campId: 'starting-camp',
  });
  assert.ok(result);
  assert.deepEqual(peopleSystem.itemChanges, [{ personId: 'person-1', itemId, amount: 2 }]);
  assert.equal(peopleSystem.lifeEvents[0].event.details.renewalAtTick, 4321);
}

test('采集和伐木优先使用显式生态系统登记资源再生', () => {
  const depleted = [];
  const ecologySystem = {
    registerDepletion(feature) {
      depleted.push(structuredClone(feature));
      return { regrowAtTick: 4321 };
    },
  };

  runResourceAction({
    type: ACTION_TYPES.GATHER_BERRIES,
    feature: { id: 'berries-explicit', kind: 'berryBush' },
    itemId: 'berries',
    ecologySystem,
  });
  runResourceAction({
    type: ACTION_TYPES.CHOP_TREE,
    feature: { id: 'tree-explicit', kind: 'tree' },
    itemId: 'wood',
    ecologySystem,
  });

  assert.deepEqual(depleted.map((feature) => feature.id), ['berries-explicit', 'tree-explicit']);
});

test('行动主循环未显式传入生态系统时使用运行时生态系统', () => {
  const previousRuntime = globalThis.shengling;
  const depleted = [];
  globalThis.shengling = {
    ecologySystem: {
      registerDepletion(feature) {
        depleted.push(structuredClone(feature));
        return { regrowAtTick: 4321 };
      },
    },
  };

  try {
    runResourceAction({
      type: ACTION_TYPES.GATHER_BERRIES,
      feature: { id: 'berries-runtime', kind: 'berryBush' },
      itemId: 'berries',
      ecologySystem: undefined,
    });
    runResourceAction({
      type: ACTION_TYPES.CHOP_TREE,
      feature: { id: 'tree-runtime', kind: 'tree' },
      itemId: 'wood',
      ecologySystem: undefined,
    });
    assert.deepEqual(depleted.map((feature) => feature.id), ['berries-runtime', 'tree-runtime']);
  } finally {
    globalThis.shengling = previousRuntime;
  }
});
