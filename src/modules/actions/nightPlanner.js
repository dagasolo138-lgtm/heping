import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { buildingCenter } from '../buildings/buildingPlacement.js';
import { minutesUntilDawn, nightKey } from '../environment/dayCycle.js';

function createTask(destination, data, workDuration) {
  const meta = ACTION_META[ACTION_TYPES.SLEEP];
  return {
    id: crypto.randomUUID?.() ?? `sleep-${Date.now()}-${Math.random()}`,
    type: ACTION_TYPES.SLEEP,
    label: meta.label,
    phaseLabel: meta.phaseLabel,
    destination,
    workDuration,
    data,
  };
}

export function planNightSleep({ person, camp, buildingSystem, time, worldMinutesPerSecond }) {
  const residence = buildingSystem.getResidenceFor(person.id);
  const sheltered = Boolean(residence);
  const destination = sheltered ? buildingCenter(residence) : camp.anchor;
  const remainingMinutes = Math.max(30, minutesUntilDawn(time));
  const workDuration = Math.max(2, remainingMinutes / Math.max(1, worldMinutesPerSecond));

  return createTask(destination, {
    nightKey: nightKey(time),
    sheltered,
    shelterId: residence?.id ?? null,
    shelterLabel: residence?.label ?? '营地露宿处',
  }, workDuration);
}
