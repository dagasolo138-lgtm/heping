import test from 'node:test';
import assert from 'node:assert/strict';

import { ACTION_TYPES } from '../src/modules/actions/actionTypes.js';
import {
  commitmentAffectsAction,
  commitmentResponseMode,
  commitmentUsesLabor,
  listCommitmentResponseProfiles,
} from '../src/modules/actions/commitmentResponses.js';

test('农业、储存与政策承诺都有正式响应目录', () => {
  const profiles = new Map(listCommitmentResponseProfiles().map((entry) => [entry.type, entry]));

  assert.deepEqual(profiles.get('restore-seed-reserve').actions, [ACTION_TYPES.HARVEST_MILLET]);
  assert.deepEqual(profiles.get('restore-seed-reserve').policyActions, [ACTION_TYPES.SOW_MILLET]);
  assert.deepEqual(profiles.get('sow-millet-window').actions, [ACTION_TYPES.SOW_MILLET]);
  assert.deepEqual(profiles.get('harvest-millet-window').actions, [ACTION_TYPES.HARVEST_MILLET]);
  assert.deepEqual(profiles.get('improve-storage').actions, [
    ACTION_TYPES.DELIVER_MATERIALS,
    ACTION_TYPES.BUILD_SITE,
  ]);
  assert.equal(commitmentAffectsAction('improve-storage', ACTION_TYPES.CHOP_TREE), false);
  assert.equal(commitmentResponseMode('restore-soil-fertility'), 'policy');
  assert.equal(commitmentResponseMode('reduce-labor-backlog'), 'policy');
  assert.equal(commitmentUsesLabor('restore-soil-fertility'), false);
  assert.equal(commitmentUsesLabor('restore-seed-reserve'), true);
  assert.equal(commitmentAffectsAction('restore-seed-reserve', ACTION_TYPES.SOW_MILLET), true);
  assert.equal(commitmentAffectsAction('restore-soil-fertility', ACTION_TYPES.SOW_MILLET), true);
  assert.equal(commitmentAffectsAction('reduce-labor-backlog', ACTION_TYPES.CLEAR_FIELD), true);
});
