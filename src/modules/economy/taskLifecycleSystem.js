export const TASK_LIFECYCLE_SCHEMA_VERSION = 1;

const DEFAULT_MAX_RECORDS = 5000;
const CLOSED_STATUSES = new Set(['completed', 'cancelled', 'failed']);
const SIMULATION_SECONDS_PER_WORLD_MINUTE = 1 / 6;

function clone(value) {
  return structuredClone(value);
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
}

function dayKey(time) {
  return `${Number(time?.year ?? 1)}:${Number(time?.day ?? 1)}`;
}

function dayOrdinal(time) {
  return (Math.max(1, Number(time?.year ?? 1)) - 1) * 360 + Math.max(1, Number(time?.day ?? 1));
}

function sameDay(first, second) {
  return dayOrdinal(first) === dayOrdinal(second);
}

function taskExpected(task) {
  return {
    seconds: round(task?.data?.laborCost?.expectedDuration ?? task?.workDuration ?? 0),
    energy: round(task?.data?.laborCost?.expectedEnergy ?? 0),
  };
}

function activeTaskId(person) {
  return person?.activity?.current?.id ?? null;
}

function emptyActionBucket() {
  return {
    started: 0,
    completed: 0,
    cancelled: 0,
    failed: 0,
    carriedIn: 0,
    carriedOut: 0,
    overdue: 0,
    expectedSeconds: 0,
    expectedEnergy: 0,
    actualSeconds: 0,
  };
}

export function createTaskLifecycleSystem({
  eventBus,
  gameTime,
  getRuntime = () => globalThis.shengling,
  maxRecords = DEFAULT_MAX_RECORDS,
} = {}) {
  const active = new Map();
  const activeByPerson = new Map();
  const records = [];
  const pendingIdle = new Map();
  const daySnapshots = new Map();
  let sequence = 0;
  let observedDay = clone(gameTime?.stamp?.() ?? { year: 1, day: 1, tick: 0 });

  function stamp() {
    return clone(gameTime?.stamp?.() ?? { year: 1, day: 1, minute: 0, tick: 0, label: '未知时间' });
  }

  function append(record) {
    records.push(Object.freeze(clone(record)));
    if (records.length > maxRecords) records.splice(0, records.length - maxRecords);
  }

  function elapsedSeconds(record, closedAt = stamp()) {
    const elapsedTicks = Math.max(0, Number(closedAt?.tick ?? 0) - Number(record?.assignedAt?.tick ?? 0));
    return round(elapsedTicks * SIMULATION_SECONDS_PER_WORLD_MINUTE);
  }

  function isOverdue(record, at = stamp()) {
    const expected = Math.max(0, Number(record?.expected?.seconds ?? 0));
    return elapsedSeconds(record, at) > Math.max(30, expected * 2);
  }

  function closeRecord(taskId, status, reason, { details = null, closedAt: suppliedClosedAt = null } = {}) {
    const current = active.get(taskId);
    if (!current) return null;
    const closedAt = clone(suppliedClosedAt ?? stamp());
    const elapsedWorldMinutes = Math.max(0, Number(closedAt.tick ?? 0) - Number(current.assignedAt?.tick ?? 0));
    const record = {
      ...clone(current),
      sequence: ++sequence,
      status,
      outcome: { reason: reason ?? status, details: clone(details) },
      closedAt,
      elapsedWorldMinutes,
      actualSeconds: round(elapsedWorldMinutes * SIMULATION_SECONDS_PER_WORLD_MINUTE),
      spansDays: !sameDay(current.assignedAt, closedAt),
    };
    active.delete(taskId);
    if (activeByPerson.get(current.personId) === taskId) activeByPerson.delete(current.personId);
    pendingIdle.delete(current.personId);
    append(record);
    eventBus?.emit?.('task-lifecycle:closed', {
      record: clone(record),
      status,
      reason: record.outcome.reason,
      time: clone(closedAt),
    });
    return clone(record);
  }

  function startTask(payload = {}) {
    const task = payload.task;
    const personId = payload.personId ?? task?.personId ?? null;
    if (!task?.id || !personId) return null;

    const existingTaskId = activeByPerson.get(personId);
    if (existingTaskId && existingTaskId !== task.id) {
      closeRecord(existingTaskId, 'cancelled', 'superseded-by-new-task', {
        details: { replacementTaskId: task.id },
      });
    }
    if (active.has(task.id)) return clone(active.get(task.id));

    const assignedAt = stamp();
    const record = {
      schemaVersion: TASK_LIFECYCLE_SCHEMA_VERSION,
      taskId: task.id,
      personId,
      type: task.type ?? 'unknown',
      label: task.label ?? task.type ?? '未知任务',
      status: 'active',
      assignedAt,
      expected: taskExpected(task),
      stages: [{
        stage: task.data?.stage ?? task.phase ?? 'initial',
        phase: task.phase ?? null,
        at: assignedAt,
      }],
      metadata: {
        destination: clone(task.destination ?? null),
        source: task.data?.source ?? null,
      },
    };
    active.set(task.id, record);
    activeByPerson.set(personId, task.id);
    pendingIdle.delete(personId);
    eventBus?.emit?.('task-lifecycle:started', { record: clone(record), time: assignedAt });
    return clone(record);
  }

  function transitionTask(payload = {}) {
    const taskId = payload.taskId ?? payload.task?.id;
    const record = active.get(taskId);
    if (!record) return null;
    const at = stamp();
    const next = {
      ...clone(record),
      stages: [
        ...(record.stages ?? []).map(clone),
        {
          stage: payload.toStage ?? payload.task?.data?.stage ?? payload.task?.phase ?? 'next',
          phase: payload.task?.phase ?? null,
          at,
          reason: payload.reason ?? null,
        },
      ],
    };
    active.set(taskId, next);
    eventBus?.emit?.('task-lifecycle:transitioned', { record: clone(next), time: at });
    return clone(next);
  }

  function runtimePerson(personId) {
    const runtime = getRuntime?.() ?? {};
    return runtime.peopleSystem?.getRuntime?.(personId) ?? runtime.peopleSystem?.get?.(personId) ?? null;
  }

  function resolvePendingIdle(now = stamp()) {
    [...pendingIdle.entries()].forEach(([personId, pending]) => {
      if (Number(pending.observedAt?.tick ?? 0) >= Number(now.tick ?? 0)) return;
      const task = active.get(pending.taskId);
      if (!task) {
        pendingIdle.delete(personId);
        return;
      }
      if (activeTaskId(runtimePerson(personId)) === pending.taskId) {
        pendingIdle.delete(personId);
        return;
      }
      closeRecord(pending.taskId, pending.status, pending.reason, {
        details: { inferredFrom: 'people:changed' },
        closedAt: pending.observedAt,
      });
    });
  }

  function capturePreviousDay(now) {
    if (dayKey(now) === dayKey(observedDay)) return;
    const activeRecords = [...active.values()];
    const previousSnapshot = {
      year: Number(observedDay.year),
      day: Number(observedDay.day),
      capturedAt: clone(now),
      carriedOutTaskIds: activeRecords.map((record) => record.taskId),
      overdueTaskIds: activeRecords.filter((record) => isOverdue(record, now)).map((record) => record.taskId),
    };
    daySnapshots.set(dayKey(observedDay), previousSnapshot);
    const currentDay = { year: Number(now.year), day: Number(now.day) };
    observedDay = clone(now);
    eventBus?.emit?.('task-lifecycle:day-rolled', {
      previous: clone(previousSnapshot),
      current: currentDay,
      time: clone(now),
    });
  }

  function closeAll(status, reason) {
    return [...active.keys()].map((taskId) => closeRecord(taskId, status, reason)).filter(Boolean);
  }

  function observe(eventName, payload = {}) {
    if (eventName.startsWith('task-lifecycle:')) return;
    if (eventName === 'simulation:pre-tick') {
      const now = stamp();
      resolvePendingIdle(now);
      capturePreviousDay(now);
      return;
    }
    if (eventName === 'actions:assigned') {
      startTask(payload);
      return;
    }
    if (eventName === 'actions:stage-transition') {
      transitionTask(payload);
      return;
    }
    if (eventName === 'actions:completed') {
      closeRecord(payload.task?.id, 'completed', 'action-completed', {
        details: { result: payload.result ?? null },
      });
      return;
    }
    if (eventName === 'actions:cancelled') {
      closeRecord(payload.task?.id ?? payload.taskId, 'cancelled', payload.reason ?? 'action-cancelled', payload);
      return;
    }
    if (eventName === 'actions:failed') {
      closeRecord(payload.task?.id ?? payload.taskId, 'failed', payload.reason ?? 'action-failed', payload);
      return;
    }
    if (eventName === 'people:changed' && payload.person?.id) {
      const personId = payload.person.id;
      const taskId = activeByPerson.get(personId);
      if (!taskId) return;
      if (activeTaskId(payload.person) === taskId) {
        pendingIdle.delete(personId);
        return;
      }
      const alive = payload.person.identity?.alive !== false;
      pendingIdle.set(personId, {
        taskId,
        observedAt: stamp(),
        status: alive ? 'cancelled' : 'failed',
        reason: alive ? 'activity-cleared' : 'person-died',
      });
      return;
    }
    if (eventName === 'save:loaded') closeAll('cancelled', 'save-load-replan');
  }

  function allRecords({ includeActive = true } = {}) {
    const result = records.map(clone);
    if (includeActive) result.push(...[...active.values()].map(clone));
    return result;
  }

  function get(taskId) {
    const live = active.get(taskId);
    if (live) return clone(live);
    const record = [...records].reverse().find((entry) => entry.taskId === taskId);
    return record ? clone(record) : null;
  }

  function list({ status, personId, type, includeActive = true, limit = 0 } = {}) {
    const result = allRecords({ includeActive })
      .filter((record) => !status || record.status === status)
      .filter((record) => !personId || record.personId === personId)
      .filter((record) => !type || record.type === type)
      .sort((first, second) => Number(first.assignedAt?.tick ?? 0) - Number(second.assignedAt?.tick ?? 0));
    return limit > 0 ? result.slice(-limit) : result;
  }

  function getDailySummary(year, day, { at = stamp() } = {}) {
    const target = { year: Number(year), day: Number(day) };
    const targetOrdinal = dayOrdinal(target);
    const selected = allRecords();
    const started = selected.filter((record) => dayOrdinal(record.assignedAt) === targetOrdinal);
    const closed = records.filter((record) => dayOrdinal(record.closedAt) === targetOrdinal);
    const carriedIn = selected.filter((record) => {
      const assignedDay = dayOrdinal(record.assignedAt);
      const closedDay = record.closedAt ? dayOrdinal(record.closedAt) : Infinity;
      return assignedDay < targetOrdinal && closedDay >= targetOrdinal;
    });
    const storedSnapshot = daySnapshots.get(dayKey(target));
    const targetIsCurrent = dayKey(target) === dayKey(at);
    const carriedOutIds = storedSnapshot?.carriedOutTaskIds ?? (targetIsCurrent ? [...active.keys()] : []);
    const overdueIds = storedSnapshot?.overdueTaskIds
      ?? (targetIsCurrent
        ? [...active.values()].filter((record) => isOverdue(record, at)).map((record) => record.taskId)
        : []);
    const carriedOut = selected.filter((record) => carriedOutIds.includes(record.taskId));
    const overdue = selected.filter((record) => overdueIds.includes(record.taskId));
    const completed = closed.filter((record) => record.status === 'completed');
    const cancelled = closed.filter((record) => record.status === 'cancelled');
    const failed = closed.filter((record) => record.status === 'failed');
    const byAction = {};
    const bucketFor = (record) => {
      if (!byAction[record.type]) byAction[record.type] = emptyActionBucket();
      return byAction[record.type];
    };

    started.forEach((record) => {
      const bucket = bucketFor(record);
      bucket.started += 1;
      bucket.expectedSeconds = round(bucket.expectedSeconds + Number(record.expected?.seconds ?? 0));
      bucket.expectedEnergy = round(bucket.expectedEnergy + Number(record.expected?.energy ?? 0));
    });
    completed.forEach((record) => {
      const bucket = bucketFor(record);
      bucket.completed += 1;
      bucket.actualSeconds = round(bucket.actualSeconds + Number(record.actualSeconds ?? 0));
    });
    cancelled.forEach((record) => { bucketFor(record).cancelled += 1; });
    failed.forEach((record) => { bucketFor(record).failed += 1; });
    carriedIn.forEach((record) => { bucketFor(record).carriedIn += 1; });
    carriedOut.forEach((record) => { bucketFor(record).carriedOut += 1; });
    overdue.forEach((record) => { bucketFor(record).overdue += 1; });

    return {
      started: started.length,
      assigned: started.length,
      completed: completed.length,
      cancelled: cancelled.length,
      failed: failed.length,
      carriedIn: carriedIn.length,
      carriedOut: carriedOut.length,
      overdue: overdue.length,
      expectedSeconds: round(started.reduce((total, record) => total + Number(record.expected?.seconds ?? 0), 0)),
      expectedEnergy: round(started.reduce((total, record) => total + Number(record.expected?.energy ?? 0), 0)),
      actualSeconds: round(completed.reduce((total, record) => total + Number(record.actualSeconds ?? 0), 0)),
      byAction,
    };
  }

  function getSummary() {
    const counts = { active: active.size, completed: 0, cancelled: 0, failed: 0, totalClosed: records.length };
    records.forEach((record) => { counts[record.status] = (counts[record.status] ?? 0) + 1; });
    return counts;
  }

  function verify() {
    const issues = [];
    const taskIds = new Set();
    allRecords().forEach((record) => {
      if (!record.taskId || !record.personId) issues.push({ type: 'invalid-record', record: clone(record) });
      if (taskIds.has(record.taskId)) issues.push({ type: 'duplicate-task-id', taskId: record.taskId });
      taskIds.add(record.taskId);
      if (record.status !== 'active' && !CLOSED_STATUSES.has(record.status)) {
        issues.push({ type: 'invalid-status', taskId: record.taskId, status: record.status });
      }
      if (record.closedAt && Number(record.closedAt.tick ?? 0) < Number(record.assignedAt?.tick ?? 0)) {
        issues.push({ type: 'negative-duration', taskId: record.taskId });
      }
    });
    activeByPerson.forEach((taskId, personId) => {
      const record = active.get(taskId);
      if (!record || record.personId !== personId) {
        issues.push({ type: 'active-person-index-mismatch', personId, taskId });
      }
    });
    return { ok: issues.length === 0, issues, ...getSummary() };
  }

  function exportState() {
    return {
      schemaVersion: TASK_LIFECYCLE_SCHEMA_VERSION,
      exportedAt: stamp(),
      sequence,
      observedDay: clone(observedDay),
      records: records.map(clone),
      active: [...active.values()].map(clone),
      pendingIdle: [...pendingIdle.entries()].map(([personId, pending]) => ({ personId, ...clone(pending) })),
      daySnapshots: [...daySnapshots.values()].map(clone),
    };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== TASK_LIFECYCLE_SCHEMA_VERSION || !Array.isArray(snapshot.records) || !Array.isArray(snapshot.active)) {
      throw new Error('任务生命周期账本存档格式不兼容。');
    }
    records.length = 0;
    active.clear();
    activeByPerson.clear();
    pendingIdle.clear();
    daySnapshots.clear();
    snapshot.records.slice(-maxRecords).forEach((record) => append(record));
    snapshot.active.forEach((record) => {
      if (!record?.taskId || !record?.personId) throw new Error('任务生命周期账本包含无效活动任务。');
      active.set(record.taskId, clone(record));
      activeByPerson.set(record.personId, record.taskId);
    });
    (snapshot.pendingIdle ?? []).forEach(({ personId, ...pending }) => pendingIdle.set(personId, clone(pending)));
    (snapshot.daySnapshots ?? []).forEach((entry) => daySnapshots.set(dayKey(entry), clone(entry)));
    sequence = Math.max(Number(snapshot.sequence ?? 0), ...records.map((record) => Number(record.sequence ?? 0)), 0);
    observedDay = clone(snapshot.observedDay ?? stamp());
    eventBus?.emit?.('task-lifecycle:hydrated', { summary: getSummary(), time: stamp() });
    return exportState();
  }

  function reset() {
    active.clear();
    activeByPerson.clear();
    records.length = 0;
    pendingIdle.clear();
    daySnapshots.clear();
    sequence = 0;
    observedDay = stamp();
    eventBus?.emit?.('task-lifecycle:reset', { time: stamp() });
    return exportState();
  }

  return Object.freeze({
    observe,
    startTask,
    transitionTask,
    closeRecord,
    get,
    list,
    getDailySummary,
    getSummary,
    verify,
    exportState,
    importState,
    reset,
    createCheckpoint: exportState,
    restoreCheckpoint: importState,
  });
}
