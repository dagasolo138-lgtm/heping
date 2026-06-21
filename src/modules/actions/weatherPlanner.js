import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { getExposure } from '../environment/exposureSystem.js';

function createTask(type, destination, data = {}, duration) {
  const meta = ACTION_META[type];
  return {
    id: crypto.randomUUID?.() ?? `weather-${Date.now()}-${Math.random()}`,
    type,
    label: meta.label,
    phaseLabel: meta.phaseLabel,
    destination,
    workDuration: duration ?? meta.workDuration,
    data,
  };
}

export function planFireTask({ camp, fireSystem, weather, phase, actionCounts }) {
  const fire = fireSystem.get();
  const needed = fireSystem.needsFuel()
    && Number(camp.items.wood ?? 0) >= 1
    && (phase.isNight || weather.requiresFire);
  if (!needed || Number(actionCounts[ACTION_TYPES.TEND_FIRE] ?? 0) >= 1) return null;
  return createTask(ACTION_TYPES.TEND_FIRE, fire.position, { woodAmount: 1, fireId: fire.id });
}

export function planWarmingTask({ person, fireSystem, actionCounts }) {
  const exposure = getExposure(person);
  const fire = fireSystem.get();
  const needed = exposure.cold >= 50 || exposure.wetness >= 58;
  if (!needed || !fire.lit || Number(actionCounts[ACTION_TYPES.WARM_BY_FIRE] ?? 0) >= 2) return null;
  return createTask(ACTION_TYPES.WARM_BY_FIRE, fire.position, {
    recovery: { wetness: 22, cold: 38 },
    fireId: fire.id,
  }, 4.5);
}
