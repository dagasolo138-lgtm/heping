function clone(value) {
  return structuredClone(value);
}

function dayKey(value) {
  return `${Number(value?.year ?? 1)}:${Number(value?.day ?? 1)}`;
}

function decorateReport(report, taskLifecycleSystem, laborSnapshots) {
  if (!report) return null;
  const key = dayKey(report);
  const labor = laborSnapshots.has(key)
    ? clone(laborSnapshots.get(key))
    : taskLifecycleSystem.getDailySummary(report.year, report.day);
  const bottlenecks = (report.bottlenecks ?? [])
    .filter((entry) => entry.type !== 'labor-backlog')
    .map(clone);
  if (labor.overdue > 0) {
    bottlenecks.push({
      type: 'labor-overdue',
      severity: labor.overdue >= 3 ? 'high' : 'medium',
      value: labor.overdue,
      label: `${labor.overdue} 个任务耗时超过预计值两倍`,
    });
  }
  return {
    ...clone(report),
    labor,
    bottlenecks,
  };
}

export function createTaskLifecycleEconomyView({
  dailyEconomySystem,
  taskLifecycleSystem,
  eventBus = globalThis.__shenglingEventBus ?? null,
} = {}) {
  if (!dailyEconomySystem || !taskLifecycleSystem) throw new Error('任务生命周期经济视图缺少依赖。');
  const laborSnapshots = new Map();
  let observedDay = (() => {
    const current = dailyEconomySystem.getCurrentReport();
    return { year: Number(current.year), day: Number(current.day) };
  })();

  function captureClosedDay(nextTime) {
    if (!nextTime || dayKey(nextTime) === dayKey(observedDay)) return null;
    const key = dayKey(observedDay);
    if (!laborSnapshots.has(key)) {
      laborSnapshots.set(key, clone(taskLifecycleSystem.getDailySummary(
        observedDay.year,
        observedDay.day,
        { at: nextTime },
      )));
    }
    const captured = clone(laborSnapshots.get(key));
    observedDay = { year: Number(nextTime.year), day: Number(nextTime.day) };
    return captured;
  }

  function syncObservedDay() {
    const current = dailyEconomySystem.getCurrentReport();
    observedDay = { year: Number(current.year), day: Number(current.day) };
  }

  function exportState() {
    return {
      ...dailyEconomySystem.exportState(),
      taskLifecycle: taskLifecycleSystem.exportState(),
      taskLifecycleLaborSnapshots: [...laborSnapshots.entries()].map(([key, labor]) => ({
        key,
        labor: clone(labor),
      })),
    };
  }

  function importState(snapshot) {
    const dailySnapshot = clone(snapshot ?? {});
    const lifecycleSnapshot = dailySnapshot.taskLifecycle;
    const incomingLaborSnapshots = dailySnapshot.taskLifecycleLaborSnapshots ?? [];
    delete dailySnapshot.taskLifecycle;
    delete dailySnapshot.taskLifecycleLaborSnapshots;
    if (lifecycleSnapshot) taskLifecycleSystem.importState(lifecycleSnapshot);
    else taskLifecycleSystem.reset();
    dailyEconomySystem.importState(dailySnapshot);
    laborSnapshots.clear();
    incomingLaborSnapshots.forEach((entry) => {
      if (entry?.key && entry?.labor) laborSnapshots.set(String(entry.key), clone(entry.labor));
    });
    syncObservedDay();
    return exportState();
  }

  function reset() {
    laborSnapshots.clear();
    taskLifecycleSystem.reset();
    dailyEconomySystem.reset();
    syncObservedDay();
    return exportState();
  }

  function createCheckpoint() {
    return {
      dailyEconomy: dailyEconomySystem.createCheckpoint(),
      taskLifecycle: taskLifecycleSystem.createCheckpoint(),
      taskLifecycleLaborSnapshots: [...laborSnapshots.entries()].map(([key, labor]) => ({
        key,
        labor: clone(labor),
      })),
      observedDay: clone(observedDay),
    };
  }

  function restoreCheckpoint(snapshot) {
    taskLifecycleSystem.restoreCheckpoint(snapshot?.taskLifecycle ?? snapshot?.taskLifecycleState);
    dailyEconomySystem.restoreCheckpoint(snapshot?.dailyEconomy ?? snapshot);
    laborSnapshots.clear();
    (snapshot?.taskLifecycleLaborSnapshots ?? []).forEach((entry) => {
      if (entry?.key && entry?.labor) laborSnapshots.set(String(entry.key), clone(entry.labor));
    });
    observedDay = clone(snapshot?.observedDay ?? observedDay);
    syncObservedDay();
    return createCheckpoint();
  }

  function verify() {
    const economy = dailyEconomySystem.verify();
    const lifecycle = taskLifecycleSystem.verify();
    return {
      ok: economy.ok && lifecycle.ok,
      issues: [
        ...(economy.issues ?? []).map((issue) => ({ source: 'daily-economy', ...clone(issue) })),
        ...(lifecycle.issues ?? []).map((issue) => ({ source: 'task-lifecycle', ...clone(issue) })),
      ],
      reports: economy.reports,
      currentDay: clone(economy.currentDay),
      lifecycle: taskLifecycleSystem.getSummary(),
      frozenLaborDays: laborSnapshots.size,
    };
  }

  function observe(eventName, payload = {}) {
    if (eventName === 'simulation:pre-tick') captureClosedDay(payload.time);
    return dailyEconomySystem.observe(eventName, payload);
  }

  function rollover(...args) {
    captureClosedDay(args[0]);
    return decorateReport(dailyEconomySystem.rollover(...args), taskLifecycleSystem, laborSnapshots);
  }

  eventBus?.on?.('simulation:pre-tick', ({ time } = {}) => captureClosedDay(time));

  return Object.freeze({
    observe,
    rollover,
    finalizeCurrent: (...args) => decorateReport(dailyEconomySystem.finalizeCurrent(...args), taskLifecycleSystem, laborSnapshots),
    getReport: (...args) => decorateReport(dailyEconomySystem.getReport(...args), taskLifecycleSystem, laborSnapshots),
    getCurrentReport: () => decorateReport(dailyEconomySystem.getCurrentReport(), taskLifecycleSystem, laborSnapshots),
    listReports: (...args) => dailyEconomySystem.listReports(...args)
      .map((report) => decorateReport(report, taskLifecycleSystem, laborSnapshots)),
    verify,
    exportState,
    importState,
    reset,
    createCheckpoint,
    restoreCheckpoint,
  });
}
