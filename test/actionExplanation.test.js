import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import { buildActionExplanation } from '../src/modules/actions/actionExplanation.js';

function task(type, data = {}) {
  return {
    id: 'task-1',
    type,
    label: type,
    destination: { x: 0, y: 0 },
    workDuration: 1,
    data,
  };
}

test('效用行动解释保留促成因素、共同承诺与被阻断候选', () => {
  const explanation = buildActionExplanation(task(ACTION_TYPES.FETCH_WATER, {
    utility: {
      planner: 'utility',
      score: 52.4,
      reason: '动态库存缺口、共同承诺、技能适配',
      factors: {
        campScarcity: 28,
        communityCommitment: 13.5,
        skillFit: 8.4,
        distance: -2.1,
      },
      candidates: [],
    },
    explanationContext: {
      commitmentTargets: [{
        id: 'water-1',
        type: 'restore-water-reserve',
        score: 13.5,
        desiredWorkers: 3,
        currentResponders: 1,
        remainingDemand: 2,
        effects: [{ metric: 'effective-stock', subjectId: 'water', direction: 'increase', amount: 3 }],
      }],
      commitmentBlocked: [{
        id: 'food-1',
        type: 'restore-food-reserve',
        reason: 'no-useful-effect',
      }],
      candidates: [
        { type: ACTION_TYPES.FETCH_WATER, label: '取水', score: 52.4, reason: '库存缺口' },
        {
          type: ACTION_TYPES.SOW_MILLET,
          label: '播种粟米',
          score: -10000,
          reason: 'preserve-seed-buffer',
          blocked: true,
          blockReasons: ['preserve-seed-buffer'],
        },
      ],
    },
  }));

  assert.equal(explanation.planner, 'utility');
  assert.equal(explanation.plannerLabel, '综合效用');
  assert.equal(explanation.score, 52.4);
  assert.deepEqual(explanation.factors.map((entry) => entry.key), [
    'campScarcity',
    'communityCommitment',
    'skillFit',
    'distance',
  ]);
  assert.equal(explanation.commitments[0].type, 'restore-water-reserve');
  assert.equal(explanation.commitments[0].effects[0].subjectId, 'water');
  assert.equal(explanation.blockedCommitments[0].reason, 'no-useful-effect');
  assert.equal(explanation.alternatives[1].blocked, true);
  assert.deepEqual(explanation.alternatives[1].blockReasons, ['preserve-seed-buffer']);
  assert.equal(Object.isFrozen(explanation), true);
});

test('农业解释显示真实承诺响应与被跳过贫瘠田的休耕约束', () => {
  const explanation = buildActionExplanation(task(ACTION_TYPES.SOW_MILLET, {
    fieldId: 'healthy-field',
    seedTarget: 3,
    seedAvailableAtCamp: 5,
    commitmentResponse: {
      score: 14.4,
      matches: [{
        id: 'rain-window',
        type: 'sow-millet-window',
        score: 14.4,
        effects: [{ metric: 'planted-fields', subjectId: 'millet', direction: 'increase', amount: 1 }],
      }],
      blocked: [],
      policy: { matches: [] },
    },
    explanationContext: {
      planner: 'farm-planner',
      skipped: [{
        fieldId: 'poor-field',
        actionType: ACTION_TYPES.SOW_MILLET,
        policy: {
          matches: [{
            id: 'soil-1',
            type: 'restore-soil-fertility',
            reason: 'soil-fallow-required',
            blocked: true,
            penalty: 0,
            details: { fertility: 40, threshold: 55 },
          }],
        },
      }],
    },
  }));

  assert.equal(explanation.plannerLabel, '农业调度');
  assert.equal(explanation.commitments[0].type, 'sow-millet-window');
  assert.equal(explanation.policies[0].reason, 'soil-fallow-required');
  assert.equal(explanation.policies[0].details.fieldId, 'poor-field');
  assert.ok(explanation.hardRules.includes('农业顺序：成熟收获 → 播种 → 开垦'));
  assert.ok(explanation.hardRules.includes('播种后必须保留种子安全缓冲'));
});

test('睡眠、篝火与工具维护行动拥有明确硬规则解释', () => {
  const sleep = buildActionExplanation(task(ACTION_TYPES.SLEEP, {
    sheltered: true,
    shelterLabel: '集体草棚',
  }));
  const fire = buildActionExplanation(task(ACTION_TYPES.TEND_FIRE, { woodAmount: 1 }));
  const replacement = buildActionExplanation(task(ACTION_TYPES.REPLACE_TOOL, {
    toolLabel: '公共石斧',
    guaranteeGap: true,
    utility: {
      planner: 'tool-maintenance',
      score: 100,
      reason: '公共石斧已退出关键生产，必须恢复最低公共工具保障',
      factors: { minimumGuarantee: 80, replacementNeed: 34 },
      candidates: [],
    },
  }));

  assert.equal(sleep.planner, 'night-sleep');
  assert.ok(sleep.hardRules.includes('优先使用已分配住所'));
  assert.equal(fire.plannerLabel, '篝火安全');
  assert.ok(fire.hardRules.includes('篝火任务单人并发上限'));
  assert.equal(replacement.plannerLabel, '工具维护');
  assert.ok(replacement.hardRules.includes('最低公共工具保障优先'));
  assert.equal(replacement.factors[0].key, 'minimumGuarantee');
});

test('无任务时不生成伪造解释', () => {
  assert.equal(buildActionExplanation(null), null);
  assert.equal(buildActionExplanation({}), null);
});
