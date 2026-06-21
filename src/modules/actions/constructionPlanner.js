import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { buildingCenter, findInitialShelterPlacement } from '../buildings/buildingPlacement.js';

function createTask(type, destination, data, workDuration) {
  const meta = ACTION_META[type];
  return {
    id: crypto.randomUUID?.() ?? `construction-${Date.now()}-${Math.random()}`,
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

export function ensureInitialShelter({ buildingSystem, mapSystem, camp }) {
  if (buildingSystem.completedByType('communalShelter') || buildingSystem.activeByType('communalShelter')) return null;
  const anchor = findInitialShelterPlacement({ mapSystem, campAnchor: camp.anchor });
  if (!anchor) return null;
  return buildingSystem.startConstruction({ typeId: 'communalShelter', anchor });
}

export function planConstructionAction({ person, camp, buildingSystem, actionCounts }) {
  const site = buildingSystem.activeByType('communalShelter');
  if (!site) return null;
  const summary = buildingSystem.getConstructionSummary(site.id);
  if (!summary || summary.status === 'complete') return null;

  const woodNeed = Number(summary.materialNeed.wood ?? 0);
  if (woodNeed > 0 && Number(camp.items.wood ?? 0) > 0 && !hasActiveTask(actionCounts, ACTION_TYPES.DELIVER_MATERIALS, 2)) {
    const reservation = buildingSystem.reserveMaterial(site.id, 'wood', Math.min(3, woodNeed, Number(camp.items.wood ?? 0)));
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
