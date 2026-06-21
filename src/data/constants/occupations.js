export const OCCUPATIONS = Object.freeze({
  unassigned: { label: '未分工', preferredSkills: [] },
  woodcutter: { label: '伐木者', preferredSkills: ['woodcutting'] },
  gatherer: { label: '采集者', preferredSkills: ['gathering'] },
  fisher: { label: '渔者', preferredSkills: ['fishing'] },
  builder: { label: '建造者', preferredSkills: ['building'] },
  cook: { label: '炊事者', preferredSkills: ['cooking'] },
  stoneworker: { label: '采石者', preferredSkills: ['stoneworking'] },
  trader: { label: '行商', preferredSkills: ['trading'] },
});

export function occupationLabel(key) {
  return OCCUPATIONS[key]?.label ?? key;
}
