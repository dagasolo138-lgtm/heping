import { createId } from '../../core/ids/createId.js';

function clone(value) {
  return structuredClone(value);
}

export function createReservationLedger() {
  const reservations = new Map();

  function list(filter = {}) {
    return [...reservations.values()]
      .filter((entry) => !filter.type || entry.type === filter.type)
      .filter((entry) => !filter.key || entry.key === filter.key)
      .filter((entry) => !filter.taskId || entry.taskId === filter.taskId)
      .filter((entry) => !filter.ownerId || entry.ownerId === filter.ownerId)
      .map(clone);
  }

  function amount({ type, key } = {}) {
    return list({ type, key }).reduce((sum, entry) => sum + Number(entry.amount ?? 0), 0);
  }

  function count({ type, key } = {}) {
    return list({ type, key }).length;
  }

  function reserve({
    id = createId('reservation'),
    type,
    key,
    taskId = null,
    ownerId = null,
    amount: requestedAmount = 1,
    capacity = Infinity,
    metadata = {},
  } = {}) {
    if (!type || !key || reservations.has(id)) return null;
    const nextAmount = Math.max(0, Number(requestedAmount ?? 0));
    if (!nextAmount) return null;
    const used = amount({ type, key });
    if (used + nextAmount > Number(capacity)) return null;
    const entry = {
      id,
      type,
      key,
      taskId,
      ownerId,
      amount: nextAmount,
      metadata: clone(metadata),
    };
    reservations.set(id, entry);
    return clone(entry);
  }

  function release(id) {
    const entry = reservations.get(id);
    if (!entry) return null;
    reservations.delete(id);
    return clone(entry);
  }

  function releaseTask(taskId) {
    const released = [];
    [...reservations.values()].forEach((entry) => {
      if (entry.taskId !== taskId) return;
      released.push(release(entry.id));
    });
    return released.filter(Boolean);
  }

  function clear() {
    const released = list();
    reservations.clear();
    return released;
  }

  function createCheckpoint() {
    return { reservations: list() };
  }

  function restoreCheckpoint(snapshot) {
    reservations.clear();
    (snapshot?.reservations ?? []).forEach((entry) => {
      reservations.set(entry.id, clone(entry));
    });
    return list();
  }

  function getSummary() {
    const byType = {};
    reservations.forEach((entry) => {
      if (!byType[entry.type]) byType[entry.type] = { count: 0, amount: 0 };
      byType[entry.type].count += 1;
      byType[entry.type].amount += Number(entry.amount ?? 0);
    });
    return { total: reservations.size, byType };
  }

  return Object.freeze({
    reserve,
    release,
    releaseTask,
    clear,
    list,
    amount,
    count,
    createCheckpoint,
    restoreCheckpoint,
    getSummary,
  });
}
