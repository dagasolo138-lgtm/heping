import { createId } from '../../core/ids/createId.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { attachTaskCommitmentResponse } from './commitmentTaskResponse.js';
import { getBuildingType } from '../buildings/buildingCatalog.js';
import { buildingCenter, findInitialShelterPlacement, findStorageShedPlacement } from '../buildings/buildingPlacement.js';

const BUILD_ORDER = Object.freeze(['communalShelter', 'storageShed']);
const CONSTRUCTION_ACTION_CAPS = Object.freeze({
  [ACTION_TYPES.DELIVER_MATERIALS]: 1,
  [ACTION_TYPES.BUILD_SITE]: 2,
});

function createTask(type, destination, data, workDuration) {
  const meta = ACTION_META[type];
  return {
    id: createId('task'),
    type,
    label: meta.label,
    phaseLabel: meta.phaseLabel,
    destination,
    workDuration: workDuration ?? meta.workDuration,
    data,
  };
}

function hasActiveTask(actionCounts, type, limit) {
  return Number(actionCounts[type] ?? 0) >= limit;
}

function findPlacement(typeId, context) {
  const shared = { mapSystem: context.mapSystem, campAnchor: context.camp.anchor, buildings: context.buildingSystem.list() };
  if (typeId === 'communalShelter') return findInitialShelterPlacement(shared);
  if (typeId === 'storageShed') return findStorageShedPlacement(shared);
  return null;
}

function withStorageCommitment({ task, site, person, actionCounts, commitments, population }) {
  if (!task || site.typeId !== 'storageShed') return task;
  return attachTaskCommitmentResponse({
    task,
    person,
    source: 'construction-planner',
    target: { buildingId: site.id, buildingType: site.typeId },
    commitments,
    population,
    actionCounts,
    capacityByAction: { [task.type]: CONSTRUCTION_ACTION_CAPS[task.type] ?? 1 },
  });
}

export function ensureSettlementConstruction(context) {
  for (const typeId of BUILD_ORDER) {
    if (context.buildingSystem.completedByType(typeId)) continue;
    if (context.buildingSystem.activeByType(typeId)) return null;
    const anchor = findPlacement(typeId, context);
    if (!anchor) return null;
    return context.buildingSystem.startConstruction({ typeId, anchor });
  }
  return null;
}

export function ensureInitialShelter(context) {
  return ensureSettlementConstruction(context);
}

export function planConstructionAction({ person, camp, buildingSystem, actionCounts, commitments = null, population = null }) {
  const site = buildingSystem.list({ includeCompleted: false })[0] ?? null;
  if (!site) return null;
  const summary = buildingSystem.getConstructionSummary(site.id);
  if (!summary || summary.status === 'complete') return null;
  const buildingType = getBuildingType(site.typeId);

  const materialId = Object.keys(summary.materialNeed)
    .find((itemId) => Number(summary.materialNeed[itemId] ?? 0) > 0 && Number(camp.items[itemId] ?? 0) > 0);
  if (materialId && !hasActiveTask(actionCounts, ACTION_TYPES.DELIVER_MATERIALS, 1)) {
    const amount = Math.min(3, Number(summary.materialNeed[materialId]), Number(camp.items[materialId]));
    const reservation = buildingSystem.reserveMaterial(site.id, materialId, amount);
    if (!reservation) return null;
    const task = createTask(ACTION_TYPES.DELIVER_MATERIALS, camp.anchor, {
      stage: 'collect',
      siteId: site.id,
      buildingId: site.id,
      buildingType: site.typeId,
      reservationId: reservation.id,
      materialId: reservation.itemId,
      amount: reservation.amount,
      materialAmount: reservation.amount,
      storageProtection: Number(buildingType.effects?.storageProtection ?? 0),
      siteDestination: buildingCenter(site),
    }, ACTION_META[ACTION_TYPES.DELIVER_MATERIALS].workDuration);
    return withStorageCommitment({ task, site, person, actionCounts, commitments, population });
  }

  if (summary.materialsReady && !hasActiveTask(actionCounts, ACTION_TYPES.BUILD_SITE, 2)) {
    const skill = Number(person.work.skills?.building ?? 0);
    if (skill < 2) return null;
    const workAmount = 1 + skill * 0.22;
    const task = createTask(ACTION_TYPES.BUILD_SITE, buildingCenter(site), {
      siteId: site.id,
      buildingId: site.id,
      buildingType: site.typeId,
      workAmount,
      storageProtection: Number(buildingType.effects?.storageProtection ?? 0),
    }, ACTION_META[ACTION_TYPES.BUILD_SITE].workDuration);
    return withStorageCommitment({ task, site, person, actionCounts, commitments, population });
  }

  return null;
}
