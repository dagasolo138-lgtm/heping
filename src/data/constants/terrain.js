export const TERRAIN = Object.freeze({
  GRASS: 0,
  TALL_GRASS: 1,
  FOREST_FLOOR: 2,
  DIRT: 3,
  SAND: 4,
  SHALLOW_WATER: 5,
  DEEP_WATER: 6,
  STONE_GROUND: 7,
  FARMLAND: 8,
});

export const TERRAIN_META = Object.freeze({
  [TERRAIN.GRASS]: { label: '草地', walkable: true, color: '#527b52' },
  [TERRAIN.TALL_GRASS]: { label: '高草', walkable: true, color: '#426b47' },
  [TERRAIN.FOREST_FLOOR]: { label: '林地', walkable: true, color: '#355c42' },
  [TERRAIN.DIRT]: { label: '泥土', walkable: true, color: '#896b45' },
  [TERRAIN.SAND]: { label: '沙岸', walkable: true, color: '#bda971' },
  [TERRAIN.SHALLOW_WATER]: { label: '浅水', walkable: false, color: '#4f94a1' },
  [TERRAIN.DEEP_WATER]: { label: '深水', walkable: false, color: '#2e667d' },
  [TERRAIN.STONE_GROUND]: { label: '石滩', walkable: true, color: '#74776b' },
  [TERRAIN.FARMLAND]: { label: '农地', walkable: true, color: '#7f6d36' },
});

export function terrainLabel(id) {
  return TERRAIN_META[id]?.label ?? '未知地形';
}
