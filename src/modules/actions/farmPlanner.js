import { createId } from '../../core/ids/createId.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { attachTaskCommitmentResponse } from './commitmentTaskResponse.js';

const FARM_ACTION_CAPS = Object.freeze({
  [ACTION_TYPES.CLEAR_FIELD]: 2,
  [ACTION_TYPES.SOW_MILLET]: 1,
  [ACTION_TYPES.HARVEST_MILLET]: 1,
});

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

function withCommitmentResponse({ task, field, person, actionCounts, commitments, population }) {
  if (!task) return null;
  return attachTaskCommitmentResponse({
    task,
    person,
    source: 'farm-planner',
    target: {
      fieldId: field.id,
      fieldStatus: field.status,
      fieldFertility: Number(field.soil?.fertility ?? 100),
    },
    commitments,
    population,
    actionCounts,
    capacityByAction: { [task.type]: FARM_ACTION_CAPS[task.type] ?? 1 },
  });
}

export function planFarmAction({ person, farmSystem, actionCounts, commitments = null, population = null }) {
  const field = farmSystem.nextWorkField();
  if (!field) return null;
  const destination = farmSystem.getFieldCenter(field);

  if ((field.status === 'planned' || field.status === 'clearing') && !active(actionCounts, ACTION_TYPES.CLEAR_FIELD, 2)) {
    const workAmount = 1 + Number(person.work.skills?.gathering ?? 0) * 0.2;
    const task = createTask(
      ACTION_TYPES.CLEAR_FIELD,
      destination,
      { fieldId: field.id, workAmount },
      workerDuration(person, ACTION_META[ACTION_TYPES.CLEAR_FIELD].workDuration),
    );
    return withCommitmentResponse({ task, field, person, actionCounts, commitments, population });
  }

  if (field.status === 'readyToSow' && !active(actionCounts, ACTION_TYPES.SOW_MILLET, 1)) {
    const seedPlan = farmSystem.getSeedPlan(field.id);
    if (!seedPlan || !farmSystem.canStartSowing({ person, fieldId: field.id })) return null;
    const task = createTask(ACTION_TYPES.SOW_MILLET, destination, {
      fieldId: field.id,
      cropId: seedPlan.cropId,
      seedItemId: seedPlan.seedItemId,
      seedAmount: seedPlan.seedAmount,
      seedSourceCampId: 'starting-camp',
      seedTarget: seedPlan.target,
      seedShortage: seedPlan.shortage,
    }, workerDuration(person, ACTION_META[ACTION_TYPES.SOW_MILLET].workDuration));
    return withCommitmentResponse({ task, field, person, actionCounts, commitments, population });
  }

  if (field.status === 'mature' && !active(actionCounts, ACTION_TYPES.HARVEST_MILLET, 1)) {
    const task = createTask(
      ACTION_TYPES.HARVEST_MILLET,
      destination,
      { fieldId: field.id },
      workerDuration(person, ACTION_META[ACTION_TYPES.HARVEST_MILLET].workDuration),
    );
    return withCommitmentResponse({ task, field, person, actionCounts, commitments, population });
  }

  return null;
}
