export const BUILDING_TYPES = Object.freeze({
  communalShelter: {
    id: 'communalShelter',
    label: '集体草棚',
    description: '可容纳十二人的第一处遮蔽所。',
    footprint: { width: 8, height: 6 },
    materials: { wood: 12 },
    workRequired: 10,
    capacity: 12,
    effects: { sleepRecovery: 0.18, rainProtection: 0.55 },
  },
  storageShed: {
    id: 'storageShed',
    label: '简易储物棚',
    description: '让共享物资有明确的存放地点。',
    footprint: { width: 5, height: 4 },
    materials: { wood: 8 },
    workRequired: 6,
    capacity: 0,
    effects: { storageProtection: 0.4 },
  },
});

export function getBuildingType(typeId) {
  const type = BUILDING_TYPES[typeId];
  if (!type) throw new Error(`未知建筑类型：${typeId}`);
  return type;
}
