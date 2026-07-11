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

test('采集和伐木通过运行时生态系统登记资源再生', () => {
  const previousRuntime = globalThis.shengling;
  const depleted = [];
  globalThis.shengling = {
    ecologySystem: {
      registerDepletion: (feature) => {
        depleted.push(structuredClone(feature));
        return { regrowAtTick: 4321 };
      },
    },
  };

  try {
    const scenarios = [
      { type: ACTION_TYPES.GATHER_BERRIES, feature: { id: 'berries-1', kind: 'berryBush' }, itemId: 'berries', yield: 2 },
      { type: ACTION_TYPES.CHOP_TREE, feature: { id: 'tree-1', kind: 'tree' }, itemId: 'wood', yield: 4 },
    ];

    scenarios.forEach(({ type, feature, itemId, yield: amount }, index) => {
      const peopleSystem = createPeopleSystem();
      const result = completeAction({
        agent: { personId: 'person-1', x: index + 2, y: index + 3 },
        task: {
          id: `task-${index + 1}`,
          type,
          label: type,
          data: { featureId: feature.id, yield: amount },
        },
        peopleSystem,
        mapSystem: { removeFeature: (featureId) => featureId === feature.id ? structuredClone(feature) : null },
        campStore: null,
        gameTime: { stamp: () => ({ year: 1, day: 1, minute: 600, tick: 120 }) },
        campId: 'starting-camp',
      });

      assert.ok(result);
      assert.deepEqual(peopleSystem.itemChanges, [{ personId: 'person-1', itemId, amount }]);
      assert.equal(peopleSystem.lifeEvents[0].event.details.renewalAtTick, 4321);
    });

    assert.deepEqual(depleted.map((feature) => feature.id), ['berries-1', 'tree-1']);
  } finally {
    globalThis.shengling = previousRuntime;
  }
});
