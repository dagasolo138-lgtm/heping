import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { scoreUtilityCandidates } from '../src/modules/actions/utilityScorer.js';
import { buildDesireModel } from '../src/modules/actions/desireModel.js';

function personFixture() {
  return {
    id: 'person-ab',
    identity: { alive: true },
    traits: [],
    state: { hunger: 20, thirst: 20, energy: 80, stress: 0, health: 100 },
    work: {
      occupation: 'gatherer',
      skills: { gathering: 2, fishing: 0, woodcutting: 0 },
      preferences: [],
    },
    location: { tileX: 0, tileY: 0 },
    relations: {},
    family: { spouseId: null, siblingIds: [], parentIds: [], childIds: [] },
  };
}

function candidate(type, x) {
  return {
    type,
    label: type,
    destination: { x, y: 0 },
    estimates: { distance: x, expectedDuration: 10, expectedEnergy: 2 },
  };
}

function runScenario(commitments) {
  let reads = 0;
  const previous = globalThis.shengling;
  globalThis.shengling = {
    worldDynamicsSystem: {
      listCommitments({ state }) {
        assert.equal(state, 'active');
        reads += 1;
        return structuredClone(commitments);
      },
    },
  };
  try {
    const person = personFixture();
    const candidates = [
      candidate(ACTION_TYPES.FETCH_WATER, 1),
      candidate(ACTION_TYPES.GATHER_BERRIES, 1),
    ];
    const scored = scoreUtilityCandidates({
      person,
      desire: buildDesireModel({ person }),
      candidates,
      camp: { items: {} },
      population: 10,
      actionCounts: {},
      allPeople: [],
      stockTargets: { shortage: { water: 0, food: 0, wood: 0 } },
    });
    return { reads, scored };
  } finally {
    globalThis.shengling = previous;
  }
}

test('共同承诺 A/B 只改变合法候选排序，不增加候选', () => {
  const control = runScenario([]);
  const treatment = runScenario([{
    id: 'commitment-water',
    type: 'restore-water-reserve',
    state: 'active',
    priority: 100,
    progress: 0,
  }]);

  assert.equal(control.reads, 1);
  assert.equal(treatment.reads, 1);
  assert.equal(control.scored.length, 2);
  assert.equal(treatment.scored.length, 2);
  assert.equal(control.scored[0].candidate.type, ACTION_TYPES.GATHER_BERRIES);
  assert.equal(treatment.scored[0].candidate.type, ACTION_TYPES.FETCH_WATER);
  assert.equal(control.scored.find((entry) => entry.candidate.type === ACTION_TYPES.FETCH_WATER).factors.communityCommitment, 0);
  assert.equal(treatment.scored.find((entry) => entry.candidate.type === ACTION_TYPES.FETCH_WATER).factors.communityCommitment, 18);
  assert.equal(treatment.scored.find((entry) => entry.candidate.type === ACTION_TYPES.GATHER_BERRIES).factors.communityCommitment, 0);
});
