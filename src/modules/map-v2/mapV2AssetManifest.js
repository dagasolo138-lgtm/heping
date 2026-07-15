export const MAP_V2_ASSET_MANIFEST_VERSION = 1;

const CANDIDATES = [
  {
    id: 'mapgen4', category: 'generator-reference', repository: 'redblobgames/mapgen4',
    license: 'Apache-2.0', reviewStatus: 'candidate', bundled: false, attributionRequired: true,
    note: '只参考水文、生态区与地图数据分层；不直接替换现有 1 米网格。',
  },
  {
    id: 'simplex-noise', category: 'generator-library', repository: 'jwagner/simplex-noise.js',
    license: 'MIT', reviewStatus: 'candidate', bundled: false, attributionRequired: true,
    note: '计划用于确定性海拔、湿度、肥力、温度与崎岖度场。',
  },
  {
    id: 'poisson-sampling', category: 'distribution-library', repository: 'kchapelier/fast-2d-poisson-disk-sampling',
    license: 'MIT', reviewStatus: 'candidate', bundled: false, attributionRequired: true,
    note: '计划用于树木、岩石、植物、动物与建筑点位分布。',
  },
  {
    id: 'pixijs', category: 'renderer-library', repository: 'pixijs/pixijs',
    license: 'MIT', reviewStatus: 'candidate', bundled: false, attributionRequired: true,
    note: '计划作为 Map V2 分层渲染底座。',
  },
  {
    id: 'pixi-tilemap', category: 'renderer-library', repository: 'pixijs-userland/tilemap',
    license: 'MIT', reviewStatus: 'candidate', bundled: false, attributionRequired: true,
    note: '计划用于大批量矩形瓦片渲染。',
  },
  {
    id: 'wave-function-collapse', category: 'layout-reference', repository: 'mxgmn/WaveFunctionCollapse',
    license: 'MIT-code-only', reviewStatus: 'candidate', bundled: false, attributionRequired: true,
    note: '仅考虑算法代码；示例图片与瓦片必须单独审核。',
  },
  {
    id: 'universal-lpc', category: 'character-assets', repository: 'LiberatedPixelCup/Universal-LPC-Spritesheet-Character-Generator',
    license: 'mixed-per-asset', reviewStatus: 'blocked', bundled: false, attributionRequired: true,
    note: '必须逐项筛选作者、许可与署名；禁止整仓导入。',
  },
];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function listMapV2AssetCandidates() {
  return deepFreeze(CANDIDATES.map((entry) => ({ ...entry })));
}

export function verifyMapV2AssetManifest(entries = listMapV2AssetCandidates()) {
  const issues = [];
  const ids = new Set();
  entries.forEach((entry, index) => {
    if (!entry?.id || ids.has(entry.id)) issues.push({ type: 'invalid-or-duplicate-asset-id', index, id: entry?.id ?? null });
    if (entry?.id) ids.add(entry.id);
    if (!entry?.repository) issues.push({ type: 'missing-repository', id: entry?.id ?? null });
    if (!entry?.license) issues.push({ type: 'missing-license', id: entry?.id ?? null });
    if (!['candidate', 'approved', 'blocked', 'rejected'].includes(entry?.reviewStatus)) {
      issues.push({ type: 'invalid-review-status', id: entry?.id ?? null, reviewStatus: entry?.reviewStatus ?? null });
    }
    if (entry?.bundled && entry.reviewStatus !== 'approved') issues.push({ type: 'unapproved-bundled-asset', id: entry?.id ?? null });
  });
  return deepFreeze({
    ok: issues.length === 0,
    version: MAP_V2_ASSET_MANIFEST_VERSION,
    entries: entries.length,
    bundled: entries.filter((entry) => entry.bundled).length,
    approved: entries.filter((entry) => entry.reviewStatus === 'approved').length,
    issues,
  });
}
