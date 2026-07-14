import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import {
  CANDIDATE_EFFECT_SCHEMA_VERSION,
  candidateEffectProfile,
  describeCandidateEffects,
  listCandidateEffectProfiles,
  verifyCandidateEffectCatalog,
} from '../src/modules/actions/candidateEffects.js';

test('效果目录覆盖全部行动类型并通过结构校验', () => {
  const verification = verifyCandidateEffectCatalog();
  const profiles = listCandidateEffectProfiles();

  assert.equal(verification.ok, true, JSON.stringify(verification.issues));
  assert.equal(verification.actionTypes, Object.values(ACTION_TYPES).length);
  assert.equal(verification.profiles, Object.values(ACTION_TYPES).length);
  assert.ok(verification.effects >= Object.values(ACTION_TYPES).length);
  assert.deepEqual(profiles.map((entry) => entry.actionType), Object.values(ACTION_TYPES));
  profiles.forEach((entry) => assert.ok(entry.effects.length > 0, entry.actionType));
});

test('收获行动可同时描述食物、返种和成熟农田变化', () => {
  const result = describeCandidateEffects({
    candidate: {
      type: ACTION_TYPES.HARVEST_MILLET,
      fieldId: 'field-7',
    },
    estimates: {
      foodAmount: 8,
      seedReturn: 2,
      matureFields: 1,
    },
  });

  assert.equal(result.schemaVersion, CANDIDATE_EFFECT_SCHEMA_VERSION);
  assert.equal(result.actionType, ACTION_TYPES.HARVEST_MILLET);
  assert.deepEqual(result.effects.map((entry) => ({
    metric: entry.metric,
    subjectId: entry.subjectId,
    direction: entry.direction,
    amount: entry.amount,
  })), [
    { metric: 'effective-stock', subjectId: 'food', direction: 'increase', amount: 8 },
    { metric: 'seed-stock', subjectId: 'milletSeed', direction: 'increase', amount: 2 },
    { metric: 'mature-fields', subjectId: 'field-7', direction: 'decrease', amount: 1 },
  ]);
  assert.equal(Object.isFrozen(result), true);
  assert.equal(Object.isFrozen(result.effects), true);
  result.effects.forEach((entry) => assert.equal(Object.isFrozen(entry), true));
});

test('动态目标可从候选、候选数据或显式 subjects 中解析', () => {
  const haul = describeCandidateEffects({
    candidate: { type: ACTION_TYPES.HAUL_TO_CAMP, data: { itemId: 'berries' } },
    estimates: { deliveredAmount: 3 },
  });
  const building = describeCandidateEffects({
    candidate: { type: ACTION_TYPES.BUILD_SITE, buildingId: 'storage-shed-1' },
    subjects: { buildingId: 'storage-shed-override' },
    estimates: { workAmount: 4, storageProtection: 0.2 },
  });

  assert.deepEqual(haul.effects.map((entry) => entry.subjectId), ['berries', 'berries']);
  assert.equal(haul.effects[0].amount, 3);
  assert.deepEqual(building.effects.map((entry) => entry.subjectId), ['storage-shed-override', 'storage-shed-override']);
  assert.deepEqual(building.effects.map((entry) => entry.amount), [4, 0.2]);
});

test('候选 effectEstimates 可提供估算，非法数量归零且未知行动返回空效果', () => {
  const rest = describeCandidateEffects({
    candidate: {
      type: ACTION_TYPES.REST,
      personId: 'p1',
      effectEstimates: { fatigueReduction: 3, energyRecovery: -2 },
    },
  });
  const unknown = describeCandidateEffects({ candidate: { type: 'unknown-action' } });
  const missing = describeCandidateEffects();

  assert.deepEqual(rest.effects.map((entry) => entry.amount), [3, 0]);
  assert.deepEqual(rest.effects.map((entry) => entry.subjectId), ['p1', 'p1']);
  assert.equal(candidateEffectProfile('unknown-action').length, 0);
  assert.deepEqual(unknown.effects, []);
  assert.equal(missing.actionType, null);
  assert.deepEqual(missing.effects, []);
});
