import { TERRAIN } from '../../data/constants/terrain.js';

export const MAP_SCHEMA_VERSION = 1;

export function createBlankMap({
  regionId = 'starting-valley',
  width = 160,
  height = 120,
  tileSizeMeters = 1,
  chunkSize = 16,
  seed = 'shengling-starting-valley',
  createdAt = null,
} = {}) {
  const tileCount = width * height;
  return {
    schemaVersion: MAP_SCHEMA_VERSION,
    regionId,
    seed,
    geometry: {
      width,
      height,
      tileSizeMeters,
      chunkSize,
      chunkColumns: Math.ceil(width / chunkSize),
      chunkRows: Math.ceil(height / chunkSize),
    },
    terrain: new Uint8Array(tileCount).fill(TERRAIN.GRASS),
    elevation: new Uint8Array(tileCount).fill(50),
    features: [],
    buildings: [],
    claims: [],
    spawnPoint: { x: Math.floor(width / 2), y: Math.floor(height / 2) },
    createdAt,
    updatedAt: createdAt,
  };
}
