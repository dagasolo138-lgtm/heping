import { isInBounds, tileIndex } from './mapQueries.js';

export function setTerrainAt(map, x, y, terrainId) {
  if (!isInBounds(map, x, y)) throw new Error(`地块越界：${x}, ${y}`);
  map.terrain[tileIndex(map, x, y)] = terrainId;
}

export function setElevationAt(map, x, y, value) {
  if (!isInBounds(map, x, y)) throw new Error(`地块越界：${x}, ${y}`);
  map.elevation[tileIndex(map, x, y)] = Math.max(0, Math.min(100, Math.round(value)));
}

export function addFeature(map, feature) {
  if (!feature?.id || !feature?.kind || !isInBounds(map, feature.x, feature.y)) {
    throw new Error('地图物件缺少合法 id、kind 或坐标。');
  }
  if (map.features.some((item) => item.id === feature.id)) throw new Error(`地图物件 id 重复：${feature.id}`);
  map.features.push(structuredClone(feature));
}

export function removeFeature(map, featureId) {
  const feature = map.features.find((item) => item.id === featureId);
  if (!feature) return null;
  map.features = map.features.filter((item) => item.id !== featureId);
  return structuredClone(feature);
}
