import { ACTION_TYPES } from '../actions/actionTypes.js';

export const TOOL_SCHEMA_VERSION = 1;

export const TOOL_TYPES = Object.freeze({
  STONE_AXE: 'stoneAxe',
  CARRYING_BASKET: 'carryingBasket',
  SIMPLE_FARM_TOOL: 'simpleFarmTool',
  STONE_PICK: 'stonePick',
});

export const TOOL_DEFINITIONS = Object.freeze({
  [TOOL_TYPES.STONE_AXE]: Object.freeze({
    typeId: TOOL_TYPES.STONE_AXE,
    label: '石斧',
    maxDurability: 72,
    supportedActions: Object.freeze([ACTION_TYPES.CHOP_TREE]),
    effects: Object.freeze({ workDurationMultiplier: 0.7, energyMultiplier: 0.82, loadWeightMultiplier: 1 }),
    wear: Object.freeze({ [ACTION_TYPES.CHOP_TREE]: 2.4 }),
  }),
  [TOOL_TYPES.CARRYING_BASKET]: Object.freeze({
    typeId: TOOL_TYPES.CARRYING_BASKET,
    label: '搬运篮',
    maxDurability: 90,
    supportedActions: Object.freeze([ACTION_TYPES.HAUL_TO_CAMP, ACTION_TYPES.DELIVER_MATERIALS]),
    effects: Object.freeze({ workDurationMultiplier: 0.92, energyMultiplier: 0.8, loadWeightMultiplier: 0.64 }),
    wear: Object.freeze({ [ACTION_TYPES.HAUL_TO_CAMP]: 0.8, [ACTION_TYPES.DELIVER_MATERIALS]: 0.9 }),
  }),
  [TOOL_TYPES.SIMPLE_FARM_TOOL]: Object.freeze({
    typeId: TOOL_TYPES.SIMPLE_FARM_TOOL,
    label: '简易农具',
    maxDurability: 84,
    supportedActions: Object.freeze([ACTION_TYPES.CLEAR_FIELD, ACTION_TYPES.SOW_MILLET, ACTION_TYPES.HARVEST_MILLET]),
    effects: Object.freeze({ workDurationMultiplier: 0.76, energyMultiplier: 0.86, loadWeightMultiplier: 1 }),
    wear: Object.freeze({
      [ACTION_TYPES.CLEAR_FIELD]: 1.8,
      [ACTION_TYPES.SOW_MILLET]: 0.7,
      [ACTION_TYPES.HARVEST_MILLET]: 1.2,
    }),
  }),
  [TOOL_TYPES.STONE_PICK]: Object.freeze({
    typeId: TOOL_TYPES.STONE_PICK,
    label: '石镐',
    maxDurability: 100,
    supportedActions: Object.freeze([]),
    effects: Object.freeze({ workDurationMultiplier: 0.72, energyMultiplier: 0.84, loadWeightMultiplier: 1 }),
    wear: Object.freeze({}),
  }),
});

export const INITIAL_TOOL_BLUEPRINTS = Object.freeze([
  Object.freeze({ id: 'tool-stone-axe-1', typeId: TOOL_TYPES.STONE_AXE }),
  Object.freeze({ id: 'tool-carrying-basket-1', typeId: TOOL_TYPES.CARRYING_BASKET }),
  Object.freeze({ id: 'tool-simple-farm-tool-1', typeId: TOOL_TYPES.SIMPLE_FARM_TOOL }),
  Object.freeze({ id: 'tool-stone-pick-1', typeId: TOOL_TYPES.STONE_PICK }),
]);

export function createToolInstance({ id, typeId, ownerId = 'starting-camp' } = {}) {
  const definition = TOOL_DEFINITIONS[typeId];
  if (!id || !definition) throw new Error('工具蓝图无效。');
  return {
    schemaVersion: TOOL_SCHEMA_VERSION,
    id,
    typeId,
    label: definition.label,
    durability: definition.maxDurability,
    maxDurability: definition.maxDurability,
    status: 'usable',
    owner: { type: 'camp', id: ownerId },
    location: { type: 'camp', id: ownerId },
    repairedCount: 0,
    totalWear: 0,
  };
}

export function toolDefinition(typeId) {
  return TOOL_DEFINITIONS[typeId] ?? null;
}
