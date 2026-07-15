import { createMapV2Boundary } from '../modules/map-v2/mapV2Boundary.js';

export function attachMapV2Runtime() {
  const runtime = globalThis.shengling;
  if (!runtime) throw new Error('Map V2 隔离层启动失败：世界运行时尚未初始化。');
  if (runtime.mapV2Runtime) return runtime.mapV2Runtime;

  const legacySeed = runtime.mapSystem?.get?.()?.seed ?? null;
  const boundary = createMapV2Boundary({ legacySeed });
  const verification = boundary.verify();
  if (!verification.ok) throw new Error(`Map V2 隔离层校验失败：${JSON.stringify(verification.issues)}`);

  const api = Object.freeze({
    getState: boundary.getState,
    getLayers: boundary.getLayers,
    getAssetCandidates: boundary.getAssetCandidates,
    createPreviewPlan: boundary.createPreviewPlan,
    verify: boundary.verify,
  });

  globalThis.shengling = Object.freeze({ ...runtime, mapV2Runtime: api });
  return api;
}
