import { listMapV2AssetCandidates, verifyMapV2AssetManifest } from './mapV2AssetManifest.js';
import { listMapV2Layers, verifyMapV2LayerCatalog } from './mapV2LayerCatalog.js';

export const MAP_V2_BOUNDARY_SCHEMA_VERSION = 1;
export const MAP_V2_DEFAULT_SEED = 'shengling-map-v2-preview-v1';
export const MAP_V2_DEFAULT_GENERATOR = 'procedural-valley-v2';

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function normalizeMapV2Seed(value, fallback = MAP_V2_DEFAULT_SEED) {
  const normalized = String(value ?? '').trim();
  return normalized || fallback;
}

export function createMapV2Boundary({ legacySeed = null } = {}) {
  const fallbackSeed = normalizeMapV2Seed(legacySeed);
  const layers = listMapV2Layers();
  const assets = listMapV2AssetCandidates();

  function createPreviewPlan({ seed = fallbackSeed, generatorId = MAP_V2_DEFAULT_GENERATOR } = {}) {
    return deepFreeze({
      schemaVersion: MAP_V2_BOUNDARY_SCHEMA_VERSION,
      status: 'planned',
      enabled: false,
      appliesToSimulation: false,
      generatorId: String(generatorId || MAP_V2_DEFAULT_GENERATOR),
      seed: normalizeMapV2Seed(seed, fallbackSeed),
      legacyFallback: true,
      simulationMapSource: 'legacy-map-system',
      rendererSource: 'legacy-canvas-map-view',
      layers,
      assetCandidates: assets,
    });
  }

  function verify() {
    const layerVerification = verifyMapV2LayerCatalog(layers);
    const assetVerification = verifyMapV2AssetManifest(assets);
    const issues = [
      ...layerVerification.issues.map((issue) => ({ scope: 'layers', ...issue })),
      ...assetVerification.issues.map((issue) => ({ scope: 'assets', ...issue })),
    ];
    return deepFreeze({
      ok: issues.length === 0,
      schemaVersion: MAP_V2_BOUNDARY_SCHEMA_VERSION,
      activeMode: 'legacy',
      previewEnabled: false,
      saveSchemaChanged: false,
      simulationBehaviorChanged: false,
      layerVerification,
      assetVerification,
      issues,
    });
  }

  return Object.freeze({
    getState: () => deepFreeze({
      schemaVersion: MAP_V2_BOUNDARY_SCHEMA_VERSION,
      activeMode: 'legacy',
      previewEnabled: false,
      fallbackSeed,
      saveSchemaChanged: false,
      simulationBehaviorChanged: false,
    }),
    getLayers: () => layers,
    getAssetCandidates: () => assets,
    createPreviewPlan,
    verify,
  });
}
