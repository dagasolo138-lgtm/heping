export const TRAITS = Object.freeze({
  diligent: { label: '勤勉', effects: { workSpeed: 0.1 } },
  generous: { label: '慷慨', effects: { relationGain: 0.1 } },
  curious: { label: '好奇', effects: { learning: 0.1 } },
  patient: { label: '耐心', effects: { stressLoss: 0.1 } },
  stubborn: { label: '固执', effects: { opinionResistance: 0.12 } },
  cautious: { label: '谨慎', effects: { dangerAvoidance: 0.1 } },
  lively: { label: '活跃', effects: { socialEnergy: 0.1 } },
  frugal: { label: '节俭', effects: { consumeRate: -0.08 } },
  brave: { label: '勇敢', effects: { courage: 0.12 } },
  calm: { label: '沉稳', effects: { stressGain: -0.1 } },
});

export function traitLabel(key) {
  return TRAITS[key]?.label ?? key;
}
