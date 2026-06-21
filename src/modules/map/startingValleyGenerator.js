import { createSeededRandom } from '../../core/random/seededRandom.js';
import { TERRAIN } from '../../data/constants/terrain.js';
import { createBlankMap } from './mapSchema.js';
import { addFeature, setElevationAt, setTerrainAt } from './mapMutations.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function riverCenterAt(y, width) {
  return Math.round(width - 32 + Math.sin(y * 0.075) * 5 + Math.sin(y * 0.021) * 7);
}

function isNear(point, target, radius) {
  const dx = point.x - target.x;
  const dy = point.y - target.y;
  return dx * dx + dy * dy <= radius * radius;
}

function makeFeature(kind, x, y, extra = {}) {
  return {
    id: `${kind}-${x}-${y}`,
    kind,
    x,
    y,
    blocking: kind === 'tree' || kind === 'stone',
    ...extra,
  };
}

export function generateStartingValley(options = {}) {
  const map = createBlankMap({
    width: 160,
    height: 120,
    tileSizeMeters: 1,
    chunkSize: 16,
    seed: 'shengling-starting-valley-v1',
    ...options,
  });
  const random = createSeededRandom(map.seed);
  const { width, height } = map.geometry;
  const spawnPoint = { x: 79, y: 74 };
  map.spawnPoint = spawnPoint;

  for (let y = 0; y < height; y += 1) {
    const river = riverCenterAt(y, width);
    for (let x = 0; x < width; x += 1) {
      const riverDistance = Math.abs(x - river);
      const northBias = clamp((52 - y) / 52, 0, 1);
      const westBias = clamp((42 - x) / 42, 0, 1);
      const noise = random();
      const elevation = clamp(40 + northBias * 12 + westBias * 10 + Math.sin(x * 0.11) * 5 + Math.cos(y * 0.08) * 4 + noise * 9, 0, 100);
      setElevationAt(map, x, y, elevation);

      if (riverDistance <= 3) setTerrainAt(map, x, y, TERRAIN.DEEP_WATER);
      else if (riverDistance <= 5) setTerrainAt(map, x, y, TERRAIN.SHALLOW_WATER);
      else if (riverDistance <= 7) setTerrainAt(map, x, y, TERRAIN.SAND);
      else if (x < 34 && y > 25 && y < 98 && noise > 0.17) setTerrainAt(map, x, y, TERRAIN.STONE_GROUND);
      else if (y < 45 && x < river - 8 && noise > 0.13) setTerrainAt(map, x, y, TERRAIN.FOREST_FLOOR);
      else if (noise > 0.74 && y > 34) setTerrainAt(map, x, y, TERRAIN.TALL_GRASS);
      else setTerrainAt(map, x, y, TERRAIN.GRASS);
    }
  }

  for (let y = spawnPoint.y - 10; y <= spawnPoint.y + 10; y += 1) {
    for (let x = spawnPoint.x - 12; x <= spawnPoint.x + 12; x += 1) {
      if (x < 0 || y < 0 || x >= width || y >= height) continue;
      if (isNear({ x, y }, spawnPoint, 10.5)) setTerrainAt(map, x, y, TERRAIN.DIRT);
    }
  }

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      const terrain = map.terrain[y * width + x];
      const nearSpawn = isNear({ x, y }, spawnPoint, 13);
      if (terrain === TERRAIN.FOREST_FLOOR && !nearSpawn && random() < 0.19) {
        addFeature(map, makeFeature('tree', x, y, { resource: { wood: 4 + Math.floor(random() * 5) } }));
      }
      if (terrain === TERRAIN.STONE_GROUND && random() < 0.11) {
        addFeature(map, makeFeature('stone', x, y, { resource: { stone: 3 + Math.floor(random() * 5) } }));
      }
      if ((terrain === TERRAIN.GRASS || terrain === TERRAIN.TALL_GRASS) && !nearSpawn && random() < 0.009) {
        addFeature(map, makeFeature('berryBush', x, y, { blocking: false, resource: { berries: 2 + Math.floor(random() * 4) } }));
      }
    }
  }

  addFeature(map, makeFeature('campfire', spawnPoint.x, spawnPoint.y, { blocking: false, persistent: true }));
  addFeature(map, makeFeature('supplyCrate', spawnPoint.x + 2, spawnPoint.y + 1, { blocking: true, persistent: true }));

  return map;
}
