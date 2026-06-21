export const SKILL_KEYS = Object.freeze([
  'woodcutting', 'building', 'gathering', 'fishing', 'cooking',
  'stoneworking', 'trading', 'fighting', 'social', 'crafting',
]);

export const SKILL_LABELS = Object.freeze({
  woodcutting: '伐木',
  building: '建造',
  gathering: '采集',
  fishing: '捕鱼',
  cooking: '烹饪',
  stoneworking: '采石',
  trading: '交易',
  fighting: '战斗',
  social: '社交',
  crafting: '制作',
});

export function createSkillSet(seed = {}) {
  return Object.fromEntries(SKILL_KEYS.map((key) => [key, Number(seed[key] ?? 0)]));
}
