export const MAP_V2_LAYER_CATALOG_VERSION = 1;

const LAYERS = [
  { id: 'terrain-base', order: 100, role: 'fact', source: 'map', description: '基础地表：水、泥土、草地、沙地与石地。' },
  { id: 'terrain-transitions', order: 200, role: 'render', source: 'derived', description: '河岸、地表边缘与自动拼接过渡。' },
  { id: 'roads', order: 300, role: 'fact', source: 'road-system', description: '道路事实与道路外观。' },
  { id: 'farmland', order: 400, role: 'fact', source: 'farm-system', description: '农田边界、土壤状态与作物阶段。' },
  { id: 'structures', order: 500, role: 'fact', source: 'building-system', description: '建筑、工地、营地设施与入口。' },
  { id: 'flora-low', order: 600, role: 'fact', source: 'map-features', description: '草、花、幼苗、灌木与低矮资源。' },
  { id: 'actors', order: 700, role: 'fact', source: 'people-and-fauna', description: '人物、动物与可移动世界实体。' },
  { id: 'flora-high', order: 800, role: 'render', source: 'map-features', description: '树冠、屋顶及其他前景遮挡。' },
  { id: 'weather-light', order: 900, role: 'render', source: 'environment', description: '昼夜、天气、火光与季节表现。' },
  { id: 'diagnostics', order: 1000, role: 'overlay', source: 'observer', description: '路线、占用、肥力、湿度和调试覆盖层。' },
];

function deepFreeze(value) {
  if (!value || typeof value !== 'object' || Object.isFrozen(value)) return value;
  Object.values(value).forEach(deepFreeze);
  return Object.freeze(value);
}

export function listMapV2Layers() {
  return deepFreeze(LAYERS.map((layer) => ({ ...layer })));
}

export function verifyMapV2LayerCatalog(layers = listMapV2Layers()) {
  const issues = [];
  const ids = new Set();
  let previousOrder = -Infinity;
  layers.forEach((layer, index) => {
    if (!layer?.id || ids.has(layer.id)) issues.push({ type: 'invalid-or-duplicate-layer-id', index, id: layer?.id ?? null });
    if (layer?.id) ids.add(layer.id);
    if (!Number.isInteger(layer?.order)) issues.push({ type: 'invalid-layer-order', id: layer?.id ?? null, order: layer?.order ?? null });
    if (Number(layer?.order) <= previousOrder) issues.push({ type: 'non-increasing-layer-order', id: layer?.id ?? null, order: layer?.order ?? null });
    previousOrder = Number(layer?.order);
    if (!['fact', 'render', 'overlay'].includes(layer?.role)) issues.push({ type: 'invalid-layer-role', id: layer?.id ?? null, role: layer?.role ?? null });
    if (!layer?.source) issues.push({ type: 'missing-layer-source', id: layer?.id ?? null });
  });
  return deepFreeze({ ok: issues.length === 0, version: MAP_V2_LAYER_CATALOG_VERSION, layers: layers.length, issues });
}
