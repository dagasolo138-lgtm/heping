import { TERRAIN_META } from '../../data/constants/terrain.js';

export function isInBounds(map, x, y) {
  return Number.isInteger(x) && Number.isInteger(y)
    && x >= 0 && y >= 0
    && x < map.geometry.width && y < map.geometry.height;
}

export function tileIndex(map, x, y) {
  if (!isInBounds(map, x, y)) return -1;
  return y * map.geometry.width + x;
}

export function getTerrainAt(map, x, y) {
  const index = tileIndex(map, x, y);
  return index === -1 ? null : map.terrain[index];
}

export function getTile(map, x, y) {
  const terrain = getTerrainAt(map, x, y);
  if (terrain === null) return null;
  return {
    x,
    y,
    terrain,
    elevation: map.elevation[tileIndex(map, x, y)],
    features: getFeaturesAt(map, x, y),
  };
}

export function getFeaturesAt(map, x, y) {
  return map.features.filter((feature) => feature.x === x && feature.y === y);
}

export function getChunkAt(map, x, y) {
  if (!isInBounds(map, x, y)) return null;
  const size = map.geometry.chunkSize;
  return {
    column: Math.floor(x / size),
    row: Math.floor(y / size),
    startX: Math.floor(x / size) * size,
    startY: Math.floor(y / size) * size,
  };
}

export function isWalkable(map, x, y) {
  const terrain = getTerrainAt(map, x, y);
  if (terrain === null || !TERRAIN_META[terrain]?.walkable) return false;
  return !map.features.some((feature) => feature.x === x && feature.y === y && feature.blocking);
}
