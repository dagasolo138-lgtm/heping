import { TERRAIN, TERRAIN_META } from '../../data/constants/terrain.js';

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

export function findNearestFeature(map, { x, y, kinds = [] } = {}) {
  const allowed = new Set(kinds);
  let best = null;
  map.features.forEach((feature) => {
    if (allowed.size && !allowed.has(feature.kind)) return;
    const distance = (feature.x - x) ** 2 + (feature.y - y) ** 2;
    if (!best || distance < best.distance) best = { feature, distance };
  });
  return best?.feature ?? null;
}

export function findNearestWalkableNeighbor(map, targetX, targetY, fromX = targetX, fromY = targetY) {
  const candidates = [];
  for (let y = targetY - 1; y <= targetY + 1; y += 1) {
    for (let x = targetX - 1; x <= targetX + 1; x += 1) {
      if (x === targetX && y === targetY) continue;
      if (!isWalkable(map, x, y)) continue;
      candidates.push({ x, y, distance: (x - fromX) ** 2 + (y - fromY) ** 2 });
    }
  }
  candidates.sort((first, second) => first.distance - second.distance);
  return candidates[0] ? { x: candidates[0].x, y: candidates[0].y } : null;
}

export function findNearestWaterAccess(map, fromX, fromY) {
  let best = null;
  for (let y = 1; y < map.geometry.height - 1; y += 1) {
    for (let x = 1; x < map.geometry.width - 1; x += 1) {
      if (!isWalkable(map, x, y)) continue;
      const neighbors = [
        getTerrainAt(map, x + 1, y), getTerrainAt(map, x - 1, y),
        getTerrainAt(map, x, y + 1), getTerrainAt(map, x, y - 1),
      ];
      if (!neighbors.some((terrain) => terrain === TERRAIN.SHALLOW_WATER || terrain === TERRAIN.DEEP_WATER)) continue;
      const distance = (x - fromX) ** 2 + (y - fromY) ** 2;
      if (!best || distance < best.distance) best = { x, y, distance };
    }
  }
  return best ? { x: best.x, y: best.y } : null;
}
