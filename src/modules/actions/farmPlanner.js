import { createId } from '../../core/ids/createId.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';

function createTask(type, destination, data = {}, duration = ACTION_META[type].workDuration) {
  const meta = ACTION_META[type];
  return {
    id: createId('task'),
    type,
    label: meta.label,
    phaseLabel: meta.phaseLabel,
    destination,
    workDuration: duration,
    data,
  };
}

function workerDuration(person, baseDuration) {
  const gathering = Number(person.work.skills?.gathering ?? 0);
  return baseDuration * Math.max(0.58, 1 - gathering * 0.045);
}

function active(actionCounts, type, limit) {
  return Number(actionCounts[type] ?? 0) >= limit;
}

export function planFarmAction({ person, farmSystem, actionCounts }) {
  const field = farmSystem.nextWorkField();
  if (!field) return null;
  const destination = farmSystem.getFieldCenter(field);

  if ((field.status === 'planned' || field.status === 'clearing') && !active(actionCounts, ACTION_TYPES.CLEAR_FIELD, 2)) {
    const workAmount = 1 + Number(person.work.skills?.gathering ?? 0) * 0.2;
    return createTask(ACTION_TYPES.CLEAR_FIELD, destination, { fieldId: field.id, workAmount }, workerDuration(person, ACTION_META[ACTION_TYPES.CLEAR_FIELD].workDuration));
  }

  if (field.status === 'readyToSow' && !active(actionCounts, ACTION_TYPES.SOW_MILLET, 1)) {
    const seedPlan = farmSystem.getSeedPlan(field.id);
    if (!seedPlan || !farmSystem.canStartSowing({ person, fieldId: field.id })) return null;
    return createTask(ACTION_TYPES.SOW_MILLET, destination, {
      fieldId: field.id,
      cropId: seedPlan.cropId,
      seedItemId: seedPlan.seedItemId,
      seedAmount: seedPlan.seedAmount,
      seedSourceCampId: 'starting-camp',
      seedTarget: seedPlan.target,
      seedShortage: seedPlan.shortage,
    }, workerDuration(person, ACTION_META[ACTION_TYPES.SOW_MILLET].workDuration));
  }

  if (field.status === 'mature' && !active(actionCounts, ACTION_TYPES.HARVEST_MILLET, 1)) {
    return createTask(ACTION_TYPES.HARVEST_MILLET, destination, { fieldId: field.id }, workerDuration(person, ACTION_META[ACTION_TYPES.HARVEST_MILLET].workDuration));
  }

  return null;
}
