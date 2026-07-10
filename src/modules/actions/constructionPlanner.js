import { createId } from '../../core/ids/createId.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { buildingCenter, findInitialShelterPlacement, findStorageShedPlacement } from '../buildings/buildingPlacement.js';

const BUILD_ORDER = Object.freeze(['communalShelter', 'storageShed']);

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

export function planConstructionAction({ person, camp, buildingSystem, actionCounts }) {
  const site = buildingSystem.list({ includeCompleted: false })[0] ?? null;
  if (!site) return null;
  const summary = buildingSystem.getConstructionSummary(site.id);
  if (!summary || summary.status === 'complete') return null;

  const materialId = Object.keys(summary.materialNeed)
    .find((itemId) => Number(summary.materialNeed[itemId] ?? 0) > 0 && Number(camp.items[itemId] ?? 0) > 0);
  if (materialId && !hasActiveTask(actionCounts, ACTION_TYPES.DELIVER_MATERIALS, 1)) {
    const amount = Math.min(3, Number(summary.materialNeed[materialId]), Number(camp.items[materialId]));
    const reservation = buildingSystem.reserveMaterial(site.id, materialId, amount);
    if (!reservation) return null;
    return createTask(ACTION_TYPES.DELIVER_MATERIALS, camp.anchor, {
      stage: 'collect',
      siteId: site.id,
      reservationId: reservation.id,
      materialId: reservation.itemId,
      amount: reservation.amount,
      siteDestination: buildingCenter(site),
    }, ACTION_META[ACTION_TYPES.DELIVER_MATERIALS].workDuration);
  }

  if (summary.materialsReady && !hasActiveTask(actionCounts, ACTION_TYPES.BUILD_SITE, 2)) {
    const skill = Number(person.work.skills?.building ?? 0);
    if (skill < 2) return null;
    const workAmount = 1 + skill * 0.22;
    return createTask(ACTION_TYPES.BUILD_SITE, buildingCenter(site), {
      siteId: site.id,
      workAmount,
    }, ACTION_META[ACTION_TYPES.BUILD_SITE].workDuration);
  }

  return null;
}
