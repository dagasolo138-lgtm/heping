import { createId } from '../../core/ids/createId.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { resolveTaskCommitmentResponse } from './commitmentTaskResponse.js';

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

function orderedWorkFields(farmSystem) {
  const fields = farmSystem.listFields?.();
  if (!Array.isArray(fields) || fields.length === 0) {
    const field = farmSystem.nextWorkField?.();
    return field ? [field] : [];
  }
  const mature = fields.filter((field) => field.status === 'mature');
  const sowable = fields.filter((field) => field.status === 'readyToSow' && field.seasonal?.id !== 'waiting-spring');
  const clearing = fields.filter((field) => field.status === 'planned' || field.status === 'clearing');
  return [...mature, ...sowable, ...clearing];
}

function resolveCommitmentResponse({ task, field, person, actionCounts, commitments, population }) {
  return resolveTaskCommitmentResponse({
    task,
    person,
    source: 'farm-planner',
    target: {
      fieldId: field.id,
      fieldStatus: field.status,
      fieldFertility: Number(field.soil?.fertility ?? 100),
      seedAmount: Number(task.data?.seedAmount ?? 0),
      seedTarget: Number(task.data?.seedTarget ?? 0),
      seedAvailableAtCamp: Number(task.data?.seedAvailableAtCamp ?? 0),
    },
    commitments,
    population,
    actionCounts,
    capacityByAction: { [task.type]: FARM_ACTION_CAPS[task.type] ?? 1 },
  });
}

function planFieldAction({ field, person, farmSystem, actionCounts, commitments, population }) {
  const destination = farmSystem.getFieldCenter(field);

  if (field.status === 'mature') {
    if (active(actionCounts, ACTION_TYPES.HARVEST_MILLET, 1)) return { task: null, blocked: false };
    const task = createTask(
      ACTION_TYPES.HARVEST_MILLET,
      destination,
      { fieldId: field.id },
      workerDuration(person, ACTION_META[ACTION_TYPES.HARVEST_MILLET].workDuration),
    );
    return resolveCommitmentResponse({ task, field, person, actionCounts, commitments, population });
  }

  if (field.status === 'readyToSow') {
    if (active(actionCounts, ACTION_TYPES.SOW_MILLET, 1)) return { task: null, blocked: false };
    const seedPlan = farmSystem.getSeedPlan(field.id);
    if (!seedPlan || !farmSystem.canStartSowing({ person, fieldId: field.id })) return { task: null, blocked: false };
    const task = createTask(ACTION_TYPES.SOW_MILLET, destination, {
      fieldId: field.id,
      cropId: seedPlan.cropId,
      seedItemId: seedPlan.seedItemId,
      seedAmount: seedPlan.seedAmount,
      seedSourceCampId: 'starting-camp',
      seedTarget: seedPlan.target,
      seedShortage: seedPlan.shortage,
      seedAvailableAtCamp: seedPlan.availableAtCamp,
    }, workerDuration(person, ACTION_META[ACTION_TYPES.SOW_MILLET].workDuration));
    return resolveCommitmentResponse({ task, field, person, actionCounts, commitments, population });
  }

  if (field.status === 'planned' || field.status === 'clearing') {
    if (active(actionCounts, ACTION_TYPES.CLEAR_FIELD, 2)) return { task: null, blocked: false };
    const workAmount = 1 + Number(person.work.skills?.gathering ?? 0) * 0.2;
    const task = createTask(
      ACTION_TYPES.CLEAR_FIELD,
      destination,
      { fieldId: field.id, workAmount },
      workerDuration(person, ACTION_META[ACTION_TYPES.CLEAR_FIELD].workDuration),
    );
    return resolveCommitmentResponse({ task, field, person, actionCounts, commitments, population });
  }

  return { task: null, blocked: false };
}

function withSkippedConstraints(task, skipped) {
  if (!task || skipped.length === 0) return task;
  return {
    ...task,
    data: {
      ...(task.data ?? {}),
      explanationContext: {
        ...(task.data?.explanationContext ?? {}),
        planner: 'farm-planner',
        skipped,
      },
    },
  };
}

export function planFarmAction({ person, farmSystem, actionCounts, commitments = null, population = null }) {
  const fields = orderedWorkFields(farmSystem);
  const skipped = [];
  for (const field of fields) {
    const result = planFieldAction({ field, person, farmSystem, actionCounts, commitments, population });
    if (result.task) return withSkippedConstraints(result.task, skipped);
    if (result.blocked && result.response) {
      skipped.push({
        fieldId: field.id,
        actionType: result.response.candidate?.type ?? null,
        policy: result.response.policy,
        utility: result.response.utility,
      });
    }
    if (!result.blocked) return null;
  }
  return null;
}
