import test from 'node:test';
import assert from 'node:assert/strict';

import {
  MAP_V2_DEFAULT_SEED,
  createMapV2Boundary,
  normalizeMapV2Seed,
} from '../src/modules/map-v2/mapV2Boundary.js';
import { verifyMapV2AssetManifest } from '../src/modules/map-v2/mapV2AssetManifest.js';
import { verifyMapV2LayerCatalog } from '../src/modules/map-v2/mapV2LayerCatalog.js';

test('Map V2 默认保持旧地图、旧渲染器和旧模拟行为', () => {
  const boundary = createMapV2Boundary({ legacySeed: 'shengling-starting-valley-v1' });
  const state = boundary.getState();
  const plan = boundary.createPreviewPlan();

  assert.equal(state.activeMode, 'legacy');
  assert.equal(state.previewEnabled, false);
  assert.equal(state.saveSchemaChanged, false);
  assert.equal(state.simulationBehaviorChanged, false);
  assert.equal(plan.enabled, false);
  assert.equal(plan.appliesToSimulation, false);
  assert.equal(plan.legacyFallback, true);
  assert.equal(plan.simulationMapSource, 'legacy-map-system');
  assert.equal(plan.rendererSource, 'legacy-canvas-map-view');
});

test('Map V2 种子入口会去除空白并提供稳定回退', () => {
  assert.equal(normalizeMapV2Seed('  valley-42  '), 'valley-42');
  assert.equal(normalizeMapV2Seed(''), MAP_V2_DEFAULT_SEED);
  assert.equal(normalizeMapV2Seed(null), MAP_V2_DEFAULT_SEED);

  const boundary = createMapV2Boundary({ legacySeed: 'legacy-seed' });
  assert.equal(boundary.createPreviewPlan({ seed: '  ' }).seed, 'legacy-seed');
  assert.equal(boundary.createPreviewPlan({ seed: 'new-seed' }).seed, 'new-seed');
});

test('Map V2 图层目录顺序唯一、角色合法并且完全冻结', () => {
  const boundary = createMapV2Boundary();
  const layers = boundary.getLayers();
  const verification = verifyMapV2LayerCatalog(layers);

  assert.equal(verification.ok, true, JSON.stringify(verification.issues));
  assert.equal(new Set(layers.map((layer) => layer.id)).size, layers.length);
  assert.deepEqual([...layers].sort((a, b) => a.order - b.order), layers);
  assert.equal(Object.isFrozen(layers), true);
  layers.forEach((layer) => assert.equal(Object.isFrozen(layer), true));
});

test('候选素材默认不打包，混合许可素材保持阻断', () => {
  const boundary = createMapV2Boundary();
  const assets = boundary.getAssetCandidates();
  const verification = verifyMapV2AssetManifest(assets);
  const lpc = assets.find((entry) => entry.id === 'universal-lpc');

  assert.equal(verification.ok, true, JSON.stringify(verification.issues));
  assert.equal(verification.bundled, 0);
  assert.equal(lpc.reviewStatus, 'blocked');
  assert.equal(lpc.bundled, false);
  assert.equal(boundary.verify().simulationBehaviorChanged, false);
});
