function clone(value) {
  return structuredClone(value);
}

function decorateReport(report, taskLifecycleSystem) {
  if (!report) return null;
  const labor = taskLifecycleSystem.getDailySummary(report.year, report.day);
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

export function createTaskLifecycleEconomyView({ dailyEconomySystem, taskLifecycleSystem } = {}) {
  if (!dailyEconomySystem || !taskLifecycleSystem) throw new Error('任务生命周期经济视图缺少依赖。');

  function exportState() {
    return {
      ...dailyEconomySystem.exportState(),
      taskLifecycle: taskLifecycleSystem.exportState(),
    };
  }

  function importState(snapshot) {
    const dailySnapshot = clone(snapshot ?? {});
    const lifecycleSnapshot = dailySnapshot.taskLifecycle;
    delete dailySnapshot.taskLifecycle;
    if (lifecycleSnapshot) taskLifecycleSystem.importState(lifecycleSnapshot);
    else taskLifecycleSystem.reset();
    dailyEconomySystem.importState(dailySnapshot);
    return exportState();
  }

  function reset() {
    taskLifecycleSystem.reset();
    dailyEconomySystem.reset();
    return exportState();
  }

  function createCheckpoint() {
    return {
      dailyEconomy: dailyEconomySystem.createCheckpoint(),
      taskLifecycle: taskLifecycleSystem.createCheckpoint(),
    };
  }

  function restoreCheckpoint(snapshot) {
    taskLifecycleSystem.restoreCheckpoint(snapshot?.taskLifecycle ?? snapshot?.taskLifecycleState);
    dailyEconomySystem.restoreCheckpoint(snapshot?.dailyEconomy ?? snapshot);
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
    };
  }

  return Object.freeze({
    observe: (...args) => dailyEconomySystem.observe(...args),
    rollover: (...args) => decorateReport(dailyEconomySystem.rollover(...args), taskLifecycleSystem),
    finalizeCurrent: (...args) => decorateReport(dailyEconomySystem.finalizeCurrent(...args), taskLifecycleSystem),
    getReport: (...args) => decorateReport(dailyEconomySystem.getReport(...args), taskLifecycleSystem),
    getCurrentReport: () => decorateReport(dailyEconomySystem.getCurrentReport(), taskLifecycleSystem),
    listReports: (...args) => dailyEconomySystem.listReports(...args).map((report) => decorateReport(report, taskLifecycleSystem)),
    verify,
    exportState,
    importState,
    reset,
    createCheckpoint,
    restoreCheckpoint,
  });
}
