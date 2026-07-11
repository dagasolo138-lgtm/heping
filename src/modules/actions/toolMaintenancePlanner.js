import { createId } from '../../core/ids/createId.js';
import { WORLD_MINUTES_PER_REAL_SECOND } from '../../core/simulation/fixedStepClock.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';

const CAMP_ID = 'starting-camp';
const MAX_ACTIVE_MAINTENANCE = 1;

function clone(value) {
  return structuredClone(value);
}

function materialReservationKey(campId, itemId) {
  return `${campId}:${itemId}`;
}

function availableMaterial({ camp, reservationLedger, itemId }) {
  const stock = Math.max(0, Number(camp?.items?.[itemId] ?? 0));
  const reserved = Math.max(0, Number(reservationLedger?.amount?.({
    type: 'camp-item',
    key: materialReservationKey(camp?.id ?? CAMP_ID, itemId),
  }) ?? 0));
  return Math.max(0, stock - reserved);
}

function workerFactor(person, skill) {
  const level = Math.max(0, Number(person?.work?.skills?.[skill] ?? 0));
  return Math.max(0.62, 1 - level * 0.05);
}

export function evaluateMaintenanceDemand({ demand, camp, reservationLedger } = {}) {
  const reasons = [];
  if (!demand?.id || !demand.toolId) reasons.push('invalid-demand');
  if (!camp?.id || !camp?.anchor) reasons.push('missing-camp');
  if (demand?.toolId && Number(reservationLedger?.count?.({ type: 'tool', key: demand.toolId }) ?? 0) > 0) {
    reasons.push('tool-reserved');
  }
  Object.entries(demand?.materials ?? {}).forEach(([itemId, requested]) => {
    const required = Math.max(0, Number(requested) || 0);
    if (required <= 0) return;
    if (availableMaterial({ camp, reservationLedger, itemId }) < required) reasons.push(`material-shortage:${itemId}`);
  });
  return Object.freeze({ ready: reasons.length === 0, reasons: Object.freeze(reasons) });
}

export function planToolMaintenanceAction({ person, camp, actionCounts = {} } = {}) {
  if (!person?.identity?.alive || !camp?.anchor) return null;
  if (Number(actionCounts[ACTION_TYPES.REPAIR_TOOL] ?? 0) >= MAX_ACTIVE_MAINTENANCE) return null;

  const runtime = globalThis.shengling ?? {};
  const toolSystem = runtime.toolSystem;
  const reservationLedger = runtime.reservationLedger;
  const demands = toolSystem?.listMaintenanceDemands?.() ?? [];

  for (const demand of demands) {
    const availability = evaluateMaintenanceDemand({ demand, camp, reservationLedger });
    if (!availability.ready) continue;
    const skillFactor = workerFactor(person, demand.skill);
    const workDuration = Math.max(
      0.5,
      Number(demand.workMinutes ?? 0) / Math.max(1, WORLD_MINUTES_PER_REAL_SECOND) * skillFactor,
    );
    const score = demand.priority === 'high' ? 96 : 58;
    const reason = demand.priority === 'high'
      ? `${demand.label}已严重磨损，必须尽快恢复生产能力`
      : `${demand.label}耐久偏低，安排预防性维修`;
    return {
      id: createId('task'),
      type: ACTION_TYPES.REPAIR_TOOL,
      label: ACTION_META[ACTION_TYPES.REPAIR_TOOL].label,
      phaseLabel: ACTION_META[ACTION_TYPES.REPAIR_TOOL].phaseLabel,
      destination: clone(camp.anchor),
      workDuration,
      data: {
        campId: camp.id,
        demandId: demand.id,
        toolId: demand.toolId,
        toolTypeId: demand.typeId,
        toolLabel: demand.label,
        condition: demand.condition,
        priority: demand.priority,
        currentDurability: Number(demand.currentDurability),
        targetDurability: Number(demand.targetDurability),
        materials: clone(demand.materials),
        workMinutes: Number(demand.workMinutes),
        skill: demand.skill,
        utility: {
          planner: 'tool-maintenance',
          score,
          reason,
          factors: {
            maintenanceUrgency: demand.priority === 'high' ? 70 : 32,
            productionContinuity: demand.priority === 'high' ? 26 : 20,
            skillFit: Math.round((1 - skillFactor) * 100),
          },
          candidates: [],
          socialTargets: [],
        },
      },
    };
  }
  return null;
}

export { materialReservationKey };
