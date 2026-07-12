export const ACTION_TYPES = Object.freeze({
  FETCH_WATER: 'fetchWater',
  GATHER_BERRIES: 'gatherBerries',
  CHOP_TREE: 'chopTree',
  HAUL_TO_CAMP: 'haulToCamp',
  DELIVER_MATERIALS: 'deliverMaterials',
  BUILD_SITE: 'buildSite',
  CLEAR_FIELD: 'clearField',
  SOW_MILLET: 'sowMillet',
  HARVEST_MILLET: 'harvestMillet',
  REPAIR_TOOL: 'repairTool',
  REPLACE_TOOL: 'replaceTool',
  TEND_FIRE: 'tendFire',
  WARM_BY_FIRE: 'warmByFire',
  REST: 'rest',
  SLEEP: 'sleep',
});

export const ACTION_META = Object.freeze({
  [ACTION_TYPES.FETCH_WATER]: { label: '取水', workDuration: 1.4, phaseLabel: '汲水中' },
  [ACTION_TYPES.GATHER_BERRIES]: { label: '采集浆果', workDuration: 2.1, phaseLabel: '采集中' },
  [ACTION_TYPES.CHOP_TREE]: { label: '砍树', workDuration: 3.6, phaseLabel: '砍伐中' },
  [ACTION_TYPES.HAUL_TO_CAMP]: { label: '搬运资源', workDuration: 0.7, phaseLabel: '归还物资' },
  [ACTION_TYPES.DELIVER_MATERIALS]: { label: '运送建材', workDuration: 0.45, phaseLabel: '装载建材' },
  [ACTION_TYPES.BUILD_SITE]: { label: '施工', workDuration: 1.8, phaseLabel: '搭建中' },
  [ACTION_TYPES.CLEAR_FIELD]: { label: '开垦农田', workDuration: 2.4, phaseLabel: '翻整土地' },
  [ACTION_TYPES.SOW_MILLET]: { label: '播种粟米', workDuration: 1.5, phaseLabel: '播种中' },
  [ACTION_TYPES.HARVEST_MILLET]: { label: '收获粟米', workDuration: 2.7, phaseLabel: '收割中' },
  [ACTION_TYPES.REPAIR_TOOL]: { label: '维修工具', workDuration: 15, phaseLabel: '维修中' },
  [ACTION_TYPES.REPLACE_TOOL]: { label: '替换工具', workDuration: 30, phaseLabel: '制作替代工具' },
  [ACTION_TYPES.TEND_FIRE]: { label: '添柴', workDuration: 0.8, phaseLabel: '添柴中' },
  [ACTION_TYPES.WARM_BY_FIRE]: { label: '取暖', workDuration: 4.5, phaseLabel: '烤火中' },
  [ACTION_TYPES.REST]: { label: '休息', workDuration: 4.2, phaseLabel: '休息中' },
  [ACTION_TYPES.SLEEP]: { label: '睡眠', workDuration: 12, phaseLabel: '入睡中' },
});

export function actionLabel(type) {
  return ACTION_META[type]?.label ?? '待命';
}
