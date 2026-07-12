import { ACTION_TYPES } from './actionTypes.js';
import { materialReservationKey } from './toolMaintenancePlanner.js';

function clone(value) {
  return structuredClone(value);
}

function positiveMaterials(materials = {}) {
  return Object.fromEntries(Object.entries(materials)
    .map(([itemId, amount]) => [itemId, Math.max(0, Number(amount) || 0)])
    .filter(([, amount]) => amount > 0));
}

export function createToolMaintenanceRuntime({
  eventBus,
  reservationLedger,
  campStore,
  toolSystem,
  gameTime,
  getRuntime = () => globalThis.shengling,
} = {}) {
  const reservations = new Map();
  const failures = new Map();

  function stamp() {
    return gameTime?.stamp?.() ?? null;
  }

  function emit(reason, payload = {}) {
    eventBus?.emit?.('tool-maintenance:changed', {
      reason,
      ...clone(payload),
      reservations: listReservations(),
      failures: listFailures(),
      time: stamp(),
    });
  }

  function releaseIds(ids = []) {
    return ids.map((id) => reservationLedger?.release?.(id)).filter(Boolean);
  }

  function failReservation(task, personId, reason, details = {}) {
    const failure = {
      taskId: task?.id ?? null,
      personId: personId ?? null,
      demandId: task?.data?.demandId ?? null,
      toolId: task?.data?.toolId ?? null,
      reason,
      details: clone(details),
      time: stamp(),
    };
    if (failure.taskId) failures.set(failure.taskId, failure);
    emit('maintenance:reservation-failed', { failure });
    return null;
  }

  function reserveForTask({ task, personId } = {}) {
    if (task?.type !== ACTION_TYPES.REPAIR_TOOL || !task.id) return null;
    if (reservations.has(task.id)) return clone(reservations.get(task.id));

    const demand = toolSystem?.getMaintenanceDemand?.(task.data?.toolId);
    if (!demand || demand.id !== task.data?.demandId) {
      return failReservation(task, personId, 'maintenance-demand-stale');
    }
    const campId = task.data?.campId ?? 'starting-camp';
    const camp = campStore?.get?.(campId);
    if (!camp) return failReservation(task, personId, 'maintenance-camp-missing', { campId });

    const acquired = [];
    const reserve = (input) => {
      const entry = reservationLedger?.reserve?.({ ...input, taskId: task.id, ownerId: personId ?? null });
      if (entry) acquired.push(entry.id);
      return entry;
    };

    const targetReservation = reserve({
      id: `${task.id}:maintenance-tool`,
      type: 'tool',
      key: demand.toolId,
      amount: 1,
      capacity: 1,
      metadata: {
        actionType: ACTION_TYPES.REPAIR_TOOL,
        role: 'maintenance-target',
        toolId: demand.toolId,
        demandId: demand.id,
      },
    });
    if (!targetReservation) return failReservation(task, personId, 'maintenance-tool-reserved', { toolId: demand.toolId });

    const materialReservations = [];
    for (const [itemId, amount] of Object.entries(positiveMaterials(demand.materials))) {
      const reservation = reserve({
        id: `${task.id}:maintenance-material:${itemId}`,
        type: 'camp-item',
        key: materialReservationKey(campId, itemId),
        amount,
        capacity: Math.max(0, Number(camp.items?.[itemId] ?? 0)),
        metadata: {
          actionType: ACTION_TYPES.REPAIR_TOOL,
          role: 'maintenance-material',
          campId,
          itemId,
          toolId: demand.toolId,
          demandId: demand.id,
        },
      });
      if (!reservation) {
        releaseIds(acquired);
        return failReservation(task, personId, 'maintenance-material-unavailable', {
          campId,
          itemId,
          required: amount,
          available: Number(camp.items?.[itemId] ?? 0),
        });
      }
      materialReservations.push(reservation);
    }

    const bundle = {
      taskId: task.id,
      personId: personId ?? null,
      demandId: demand.id,
      toolId: demand.toolId,
      campId,
      reservationIds: [...acquired],
      targetReservationId: targetReservation.id,
      materialReservations: materialReservations.map((entry) => ({
        reservationId: entry.id,
        itemId: entry.metadata.itemId,
        amount: Number(entry.amount),
      })),
      assignedAt: stamp(),
    };
    reservations.set(task.id, bundle);
    failures.delete(task.id);
    emit('maintenance:reserved', { reservation: bundle });
    return clone(bundle);
  }

  function releaseTask(taskId, reason = 'maintenance:released') {
    const bundle = reservations.get(taskId);
    if (!bundle) {
      failures.delete(taskId);
      return null;
    }
    const released = releaseIds(bundle.reservationIds);
    reservations.delete(taskId);
    failures.delete(taskId);
    emit(reason, { reservation: bundle, released });
    return clone(bundle);
  }

  function releaseOwner(personId, reason = 'maintenance:owner-released') {
    const released = [];
    [...reservations.values()].forEach((bundle) => {
      if (bundle.personId !== personId) return;
      const entry = releaseTask(bundle.taskId, reason);
      if (entry) released.push(entry);
    });
    return released;
  }

  function clear(reason = 'maintenance:cleared') {
    const released = [];
    [...reservations.keys()].forEach((taskId) => {
      const entry = releaseTask(taskId, reason);
      if (entry) released.push(entry);
    });
    failures.clear();
    return released;
  }

  function getTaskReservation(taskId) {
    const bundle = reservations.get(taskId);
    return bundle ? clone(bundle) : null;
  }

  function getFailure(taskId) {
    const failure = failures.get(taskId);
    return failure ? clone(failure) : null;
  }

  function listReservations() {
    return [...reservations.values()].sort((first, second) => first.taskId.localeCompare(second.taskId)).map(clone);
  }

  function listFailures() {
    return [...failures.values()].sort((first, second) => String(first.taskId).localeCompare(String(second.taskId))).map(clone);
  }

  function createCheckpoint() {
    return {
      reservations: listReservations(),
      failures: listFailures(),
    };
  }

  function restoreCheckpoint(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.reservations) || !Array.isArray(snapshot.failures ?? [])) {
      throw new Error('维修运行时检查点无效。');
    }
    reservations.clear();
    snapshot.reservations.forEach((bundle) => {
      if (!bundle?.taskId || !bundle?.toolId || !Array.isArray(bundle.reservationIds)) {
        throw new Error('维修运行时检查点包含无效预留。');
      }
      reservations.set(bundle.taskId, clone(bundle));
    });
    failures.clear();
    (snapshot.failures ?? []).forEach((failure) => {
      if (!failure?.taskId || !failure?.reason) throw new Error('维修运行时检查点包含无效失败记录。');
      failures.set(failure.taskId, clone(failure));
    });
    emit('maintenance:checkpoint-restored');
    return createCheckpoint();
  }

  function verify() {
    const issues = [];
    const ledgerEntries = reservationLedger?.list?.() ?? [];
    const activeTaskIds = new Set((getRuntime?.()?.actionSystem?.getRenderPeople?.() ?? [])
      .map((person) => person.activity?.current?.id)
      .filter(Boolean));
    const targetToolIds = new Set();

    reservations.forEach((bundle) => {
      if (!activeTaskIds.has(bundle.taskId)) issues.push({ type: 'orphan-maintenance-runtime', taskId: bundle.taskId });
      bundle.reservationIds.forEach((id) => {
        if (!ledgerEntries.some((entry) => entry.id === id && entry.taskId === bundle.taskId)) {
          issues.push({ type: 'missing-maintenance-reservation', taskId: bundle.taskId, reservationId: id });
        }
      });
      if (targetToolIds.has(bundle.toolId)) issues.push({ type: 'duplicate-maintenance-target', toolId: bundle.toolId });
      targetToolIds.add(bundle.toolId);
    });

    ledgerEntries
      .filter((entry) => entry.metadata?.actionType === ACTION_TYPES.REPAIR_TOOL)
      .forEach((entry) => {
        if (!reservations.has(entry.taskId)) issues.push({ type: 'orphan-maintenance-ledger-entry', reservationId: entry.id });
      });

    return Object.freeze({
      ok: issues.length === 0,
      issues: Object.freeze(issues.map(clone)),
      active: reservations.size,
      failedReservations: failures.size,
    });
  }

  eventBus?.on?.('actions:assigned', ({ personId, task }) => {
    if (task?.type === ACTION_TYPES.REPAIR_TOOL) reserveForTask({ personId, task });
  });
  ['actions:completed', 'actions:failed', 'actions:cancelled'].forEach((eventName) => {
    eventBus?.on?.(eventName, ({ task, taskId }) => releaseTask(task?.id ?? taskId, `maintenance:${eventName.split(':')[1]}`));
  });
  eventBus?.on?.('people:changed', ({ reason, person }) => {
    if (reason === 'activity:set' && !person?.activity?.current) releaseOwner(person.id);
  });
  eventBus?.on?.('save:loaded', () => clear('maintenance:save-loaded'));

  return Object.freeze({
    reserveForTask,
    releaseTask,
    releaseOwner,
    clear,
    getTaskReservation,
    getFailure,
    listReservations,
    listFailures,
    createCheckpoint,
    restoreCheckpoint,
    verify,
  });
}
