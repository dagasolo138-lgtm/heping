import { MAP_SCHEMA_VERSION } from './mapSchema.js';
import { generateStartingValley } from './startingValleyGenerator.js';
import { addFeature, removeFeature, setTerrainAt } from './mapMutations.js';
import { findNearestFeature, findNearestWalkableNeighbor, findNearestWaterAccess, getChunkAt, getFeaturesAt, getTile, isWalkable } from './mapQueries.js';

function clone(value) {
  return structuredClone(value);
}

function serializeMap(map) {
  return { ...clone(map), terrain: Array.from(map.terrain), elevation: Array.from(map.elevation) };
}

function hydrateMap(snapshot) {
  if (snapshot?.schemaVersion !== MAP_SCHEMA_VERSION) throw new Error('地图存档格式不兼容。');
  const expected = snapshot.geometry.width * snapshot.geometry.height;
  if (snapshot.terrain?.length !== expected || snapshot.elevation?.length !== expected) throw new Error('地图格子数量与尺寸不一致。');
  return { ...clone(snapshot), terrain: Uint8Array.from(snapshot.terrain), elevation: Uint8Array.from(snapshot.elevation) };
}

export function createMapSystem({ eventBus, gameTime }) {
  let map = null;

  function stamp() { return gameTime.stamp(); }
  function requireMap() {
    if (!map) throw new Error('地图尚未初始化。');
    return map;
  }
  function commit(reason) {
    requireMap().updatedAt = stamp();
    eventBus.emit('map:changed', { reason, map: get() });
  }
  function createStartingValley(options = {}) {
    map = generateStartingValley({ ...options, createdAt: stamp() });
    eventBus.emit('map:created', { map: get() });
    return get();
  }
  function get() { return map ? clone(map) : null; }
  function exportState() { return map ? serializeMap(map) : null; }
  function importState(snapshot) {
    map = hydrateMap(snapshot);
    eventBus.emit('map:hydrated', { map: get() });
    return get();
  }
  function setTerrainBatch(tiles, terrainId, reason = 'terrain:batch') {
    const current = requireMap();
    tiles.forEach(({ x, y }) => setTerrainAt(current, x, y, terrainId));
    commit(reason);
  }

  return Object.freeze({
    createStartingValley,
    get,
    exportState,
    importState,
    getTile: (x, y) => map ? clone(getTile(map, x, y)) : null,
    getFeaturesAt: (x, y) => map ? clone(getFeaturesAt(map, x, y)) : [],
    getChunkAt: (x, y) => map ? getChunkAt(map, x, y) : null,
    getSpawnPoint: () => map ? clone(map.spawnPoint) : null,
    isWalkable: (x, y) => map ? isWalkable(map, x, y) : false,
    findNearestFeature: (options) => map ? clone(findNearestFeature(map, options)) : null,
    findNearestWalkableNeighbor: (targetX, targetY, fromX, fromY) => map ? findNearestWalkableNeighbor(map, targetX, targetY, fromX, fromY) : null,
    findNearestWaterAccess: (fromX, fromY) => map ? findNearestWaterAccess(map, fromX, fromY) : null,
    setTerrain: (x, y, terrainId) => { setTerrainAt(requireMap(), x, y, terrainId); commit('terrain:set'); },
    setTerrainBatch,
    addFeature: (feature) => { addFeature(requireMap(), feature); commit('feature:add'); return clone(feature); },
    removeFeature: (featureId) => {
      const removed = removeFeature(requireMap(), featureId);
      if (!removed) return null;
      commit('feature:remove');
      eventBus.emit('map:feature-removed', { feature: clone(removed), time: stamp() });
      return removed;
    },
  });
}
