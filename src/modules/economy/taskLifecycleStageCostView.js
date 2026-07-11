export const TASK_STAGE_COST_SCHEMA_VERSION = 1;

const DEFAULT_MAX_STAGE_COSTS = 5000;
const SIMULATION_SECONDS_PER_WORLD_MINUTE = 1 / 6;

function clone(value) {
  return structuredClone(value);
}

function round(value, digits = 3) {
  const factor = 10 ** digits;
  return Math.round((Number(value) || 0) * factor) / factor;
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

function addExpected(first = {}, second = {}) {
  return {
    seconds: round(Number(first.seconds ?? 0) + Number(second.seconds ?? 0)),
    energy: round(Number(first.energy ?? 0) + Number(second.energy ?? 0)),
  };
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

export function createTaskLifecycleStageCostView({
  taskLifecycleSystem,
  gameTime,
  maxStageCosts = DEFAULT_MAX_STAGE_COSTS,
} = {}) {
  if (!taskLifecycleSystem) throw new Error('多阶段劳动成本视图缺少任务生命周期账本。');
  const stageCosts = [];

  function stamp() {
    return clone(gameTime?.stamp?.() ?? { year: 1, day: 1, minute: 0, tick: 0, label: '未知时间' });
  }

  function costsFor(taskId) {
    return stageCosts
      .filter((entry) => entry.taskId === taskId)
      .sort((first, second) => Number(first.at?.tick ?? 0) - Number(second.at?.tick ?? 0))
      .map(clone);
  }

  function recordTransition(payload = {}) {
    const taskId = payload.taskId ?? payload.task?.id;
    const current = taskLifecycleSystem.get(taskId);
    if (!taskId || current?.status !== 'active') return null;
    const task = payload.task ?? {};
    const at = clone(payload.time ?? stamp());
    const stage = payload.toStage ?? task.data?.stage ?? task.phase ?? 'next';
    const transitionId = payload.transitionId ?? `${taskId}:${stage}:${Number(at.tick ?? 0)}`;
    if (stageCosts.some((entry) => entry.transitionId === transitionId)) return null;
    const entry = {
      schemaVersion: TASK_STAGE_COST_SCHEMA_VERSION,
      transitionId,
      taskId,
      personId: payload.personId ?? current.personId ?? null,
      type: task.type ?? current.type ?? 'unknown',
      fromStage: payload.fromStage ?? null,
      stage,
      reason: payload.reason ?? null,
      at,
      expected: taskExpected(task),
      destination: clone(task.destination ?? null),
      toolId: task.data?.laborCost?.tool?.id ?? task.data?.toolId ?? null,
      carriedAmount: Math.max(0, Number(task.data?.carriedAmount ?? 0)),
    };
    stageCosts.push(Object.freeze(clone(entry)));
    if (stageCosts.length > maxStageCosts) stageCosts.splice(0, stageCosts.length - maxStageCosts);
    return clone(entry);
  }

  function decorateRecord(record) {
    if (!record) return null;
    const extras = costsFor(record.taskId);
    const initialExpected = clone(record.expected ?? { seconds: 0, energy: 0 });
    const expected = extras.reduce((total, entry) => addExpected(total, entry.expected), initialExpected);
    const stages = (record.stages ?? []).map((stage, index) => ({
      ...clone(stage),
      expected: index === 0 ? clone(initialExpected) : clone(extras[index - 1]?.expected ?? null),
    }));
    const stageCostBreakdown = [
      {
        source: 'assignment',
        stage: stages[0]?.stage ?? 'initial',
        at: clone(record.assignedAt),
        expected: clone(initialExpected),
      },
      ...extras.map((entry) => ({
        source: 'transition',
        transitionId: entry.transitionId,
        fromStage: entry.fromStage,
        stage: entry.stage,
        at: clone(entry.at),
        expected: clone(entry.expected),
        toolId: entry.toolId,
        carriedAmount: entry.carriedAmount,
      })),
    ];
    return {
      ...clone(record),
      expected,
      stages,
      stageCostBreakdown,
    };
  }

  function ensureActionBucket(summary, type) {
    summary.byAction = summary.byAction ?? {};
    if (!summary.byAction[type]) summary.byAction[type] = emptyActionBucket();
    return summary.byAction[type];
  }

  function correctCurrentOverdue(summary, year, day, at) {
    if (!sameDay({ year, day }, at)) return summary;
    Object.values(summary.byAction ?? {}).forEach((bucket) => { bucket.overdue = 0; });
    const overdue = taskLifecycleSystem.list({ status: 'active' })
      .map(decorateRecord)
      .filter((record) => {
        const elapsedTicks = Math.max(0, Number(at.tick ?? 0) - Number(record.assignedAt?.tick ?? 0));
        const actualSeconds = elapsedTicks * SIMULATION_SECONDS_PER_WORLD_MINUTE;
        return actualSeconds > Math.max(30, Number(record.expected?.seconds ?? 0) * 2);
      });
    summary.overdue = overdue.length;
    overdue.forEach((record) => { ensureActionBucket(summary, record.type).overdue += 1; });
    return summary;
  }

  function getDailySummary(year, day, options = {}) {
    const at = clone(options.at ?? stamp());
    const summary = clone(taskLifecycleSystem.getDailySummary(year, day, { ...options, at }));
    const targetOrdinal = dayOrdinal({ year, day });
    const transitions = stageCosts.filter((entry) => dayOrdinal(entry.at) === targetOrdinal);
    transitions.forEach((entry) => {
      summary.expectedSeconds = round(Number(summary.expectedSeconds ?? 0) + Number(entry.expected?.seconds ?? 0));
      summary.expectedEnergy = round(Number(summary.expectedEnergy ?? 0) + Number(entry.expected?.energy ?? 0));
      const bucket = ensureActionBucket(summary, entry.type);
      bucket.expectedSeconds = round(Number(bucket.expectedSeconds ?? 0) + Number(entry.expected?.seconds ?? 0));
      bucket.expectedEnergy = round(Number(bucket.expectedEnergy ?? 0) + Number(entry.expected?.energy ?? 0));
    });
    summary.stageTransitions = transitions.length;
    return correctCurrentOverdue(summary, year, day, at);
  }

  function observe(eventName, payload = {}) {
    if (eventName === 'actions:stage-transition') recordTransition(payload);
    return taskLifecycleSystem.observe(eventName, payload);
  }

  function transitionTask(payload = {}) {
    recordTransition(payload);
    return decorateRecord(taskLifecycleSystem.transitionTask(payload));
  }

  function exportState() {
    return {
      ...taskLifecycleSystem.exportState(),
      stageCostSchemaVersion: TASK_STAGE_COST_SCHEMA_VERSION,
      stageCosts: stageCosts.map(clone),
    };
  }

  function importState(snapshot) {
    const incoming = Array.isArray(snapshot?.stageCosts) ? snapshot.stageCosts.map(clone) : [];
    taskLifecycleSystem.importState(snapshot);
    stageCosts.length = 0;
    incoming.slice(-maxStageCosts).forEach((entry) => stageCosts.push(Object.freeze(clone(entry))));
    return exportState();
  }

  function reset() {
    stageCosts.length = 0;
    taskLifecycleSystem.reset();
    return exportState();
  }

  function verify() {
    const base = taskLifecycleSystem.verify();
    const issues = [...(base.issues ?? []).map(clone)];
    const ids = new Set();
    stageCosts.forEach((entry) => {
      if (!entry.transitionId || !entry.taskId || !entry.at) issues.push({ type: 'invalid-stage-cost', entry: clone(entry) });
      if (ids.has(entry.transitionId)) issues.push({ type: 'duplicate-stage-transition', transitionId: entry.transitionId });
      ids.add(entry.transitionId);
      if (Number(entry.expected?.seconds ?? 0) < 0 || Number(entry.expected?.energy ?? 0) < 0) {
        issues.push({ type: 'negative-stage-cost', transitionId: entry.transitionId });
      }
    });
    return {
      ...base,
      ok: base.ok && issues.length === 0,
      issues,
      stageTransitions: stageCosts.length,
    };
  }

  return Object.freeze({
    observe,
    startTask: (...args) => decorateRecord(taskLifecycleSystem.startTask(...args)),
    transitionTask,
    closeRecord: (...args) => decorateRecord(taskLifecycleSystem.closeRecord(...args)),
    get: (taskId) => decorateRecord(taskLifecycleSystem.get(taskId)),
    list: (...args) => taskLifecycleSystem.list(...args).map(decorateRecord),
    getDailySummary,
    getSummary: () => ({ ...taskLifecycleSystem.getSummary(), stageTransitions: stageCosts.length }),
    verify,
    exportState,
    importState,
    reset,
    createCheckpoint: exportState,
    restoreCheckpoint: importState,
  });
}
