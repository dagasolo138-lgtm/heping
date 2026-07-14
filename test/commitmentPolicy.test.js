import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import {
  SOIL_FALLOW_FERTILITY_THRESHOLD,
  evaluateCommitmentPolicy,
} from '../src/modules/actions/commitmentPolicy.js';
import { scoreUtilityCandidates } from '../src/modules/actions/utilityScorer.js';

function policyCommitment(type, overrides = {}) {
  return {
    id: `${type}-1`,
    type,
    state: 'active',
    priority: 80,
    progress: 0,
    ...overrides,
  };
}

function candidate(type, overrides = {}) {
  return {
    type,
    target: {},
    estimates: { distance: 0, workDuration: 0, expectedDuration: 0, expectedEnergy: 0 },
    destination: { x: 0, y: 0 },
    ...overrides,
  };
}

test('土壤恢复承诺阻止贫瘠田继续播种，达到阈值后解除', () => {
  const commitment = policyCommitment('restore-soil-fertility');
  const blocked = evaluateCommitmentPolicy({
    candidate: candidate(ACTION_TYPES.SOW_MILLET, {
      target: { fieldId: 'field-1', fieldFertility: SOIL_FALLOW_FERTILITY_THRESHOLD - 1 },
    }),
    commitments: [commitment],
  });
  const allowed = evaluateCommitmentPolicy({
    candidate: candidate(ACTION_TYPES.SOW_MILLET, {
      target: { fieldId: 'field-1', fieldFertility: SOIL_FALLOW_FERTILITY_THRESHOLD },
    }),
    commitments: [commitment],
  });

  assert.equal(blocked.blocked, true);
  assert.equal(blocked.matches[0].reason, 'soil-fallow-required');
  assert.equal(blocked.matches[0].details.fieldId, 'field-1');
  assert.equal(allowed.blocked, false);
  assert.equal(allowed.matches.length, 0);
});

test('劳动积压承诺暂停新开垦，但不阻止收获', () => {
  const commitments = [policyCommitment('reduce-labor-backlog')];
  const clearing = evaluateCommitmentPolicy({ candidate: candidate(ACTION_TYPES.CLEAR_FIELD), commitments });
  const harvest = evaluateCommitmentPolicy({ candidate: candidate(ACTION_TYPES.HARVEST_MILLET), commitments });

  assert.equal(clearing.blocked, true);
  assert.equal(clearing.matches[0].reason, 'defer-field-expansion');
  assert.equal(harvest.blocked, false);
  assert.equal(harvest.matches.length, 0);
});

test('劳动积压对长耗时非紧急采集施加有限负分', () => {
  const commitments = [policyCommitment('reduce-labor-backlog', { priority: 100 })];
  const policy = evaluateCommitmentPolicy({
    candidate: candidate(ACTION_TYPES.CHOP_TREE, {
      estimates: { distance: 0, workDuration: 12, expectedDuration: 12, expectedEnergy: 0 },
    }),
    commitments,
  });

  assert.equal(policy.blocked, false);
  assert.equal(policy.penalty, -8);
  assert.equal(policy.matches[0].reason, 'long-discretionary-work-penalty');
});

test('效用评分纳入积压负分且不会把政策承诺当作劳动力目标', () => {
  const scored = scoreUtilityCandidates({
    person: { id: 'p1', work: { occupation: 'unassigned', skills: {} }, relations: {}, family: {} },
    desire: { needs: { thirst: 0, hunger: 0, fatigue: 0, stress: 0 }, traits: {} },
    candidates: [candidate(ACTION_TYPES.CHOP_TREE, {
      estimates: { distance: 0, workDuration: 12, expectedDuration: 12, expectedEnergy: 0 },
    })],
    camp: {},
    population: 10,
    actionCounts: {},
    stockTargets: { shortage: { water: 0, food: 0, wood: 0 } },
    commitments: [policyCommitment('reduce-labor-backlog', { priority: 100 })],
  });

  assert.equal(scored[0].factors.communityCommitment, 0);
  assert.equal(scored[0].factors.communityPolicy, -8);
  assert.equal(scored[0].commitmentTargets.length, 0);
  assert.equal(scored[0].commitmentPolicy.matches[0].type, 'reduce-labor-backlog');
});
