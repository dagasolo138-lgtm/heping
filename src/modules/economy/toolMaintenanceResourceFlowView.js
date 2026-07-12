function clone(value) {
  return structuredClone(value);
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function maintenanceContext(reason) {
  const parts = String(reason ?? '').split(':');
  if (parts[0] !== 'tool' || !['maintenance', 'maintenance-completed'].includes(parts[1])) return null;

  const phase = parts[1] === 'maintenance-completed' ? 'durability-restored' : 'material-consumed';
  const hasExplicitMode = ['repair', 'replace'].includes(parts[2]);
  if (hasExplicitMode) {
    if (!parts[3] || !parts[4]) return null;
    return {
      phase,
      mode: parts[2],
      taskId: parts[3],
      toolId: parts[4],
      personId: parts[5] ?? null,
    };
  }

  if (!parts[2] || !parts[3]) return null;
  return {
    phase,
    mode: 'repair',
    taskId: parts[2],
    toolId: parts[3],
    personId: parts[4] ?? null,
  };
}

function correctedEntry(entry) {
  const context = maintenanceContext(entry?.reason);
  if (!context) return clone(entry);
  const durability = String(entry.itemId ?? '').startsWith('durability:');
  const replacement = context.mode === 'replace';
  return {
    ...clone(entry),
    from: entry.from,
    to: durability
      ? entry.to
      : `${replacement ? 'replacement' : 'maintenance'}:tool:${context.toolId}`,
    category: replacement ? 'replacement' : 'repair',
    reason: context.phase === 'durability-restored'
      ? `tool:${replacement ? 'replacement' : 'maintenance'}-completed`
      : `tool:${replacement ? 'replacement' : 'maintenance'}`,
    taskId: context.taskId,
    personId: context.personId ?? entry.personId ?? null,
    metadata: {
      ...(clone(entry.metadata ?? {})),
      actionType: replacement ? 'replaceTool' : 'repairTool',
      toolId: context.toolId,
      maintenanceMode: context.mode,
      maintenancePhase: context.phase,
    },
  };
}

function summarize(entries, pending = 0) {
  const byItem = {};
  const byCategory = {};
  entries.forEach((entry) => {
    byItem[entry.itemId] = round((byItem[entry.itemId] ?? 0) + Number(entry.amount ?? 0));
    byCategory[entry.category] = round((byCategory[entry.category] ?? 0) + Number(entry.amount ?? 0));
  });
  return { totalEntries: entries.length, pending: Number(pending ?? 0), byItem, byCategory };
}

export function createToolMaintenanceResourceFlowView({ resourceFlowSystem } = {}) {
  if (!resourceFlowSystem) throw new Error('维修资源流水视图缺少底层系统。');

  function list(filter = {}) {
    const baseFilter = { ...filter };
    delete baseFilter.category;
    delete baseFilter.personId;
    delete baseFilter.limit;
    let selected = resourceFlowSystem.list(baseFilter).map(correctedEntry);
    if (filter.category) selected = selected.filter((entry) => entry.category === filter.category);
    if (filter.personId) selected = selected.filter((entry) => entry.personId === filter.personId);
    if (filter.limit) selected = selected.slice(-Math.max(0, Number(filter.limit)));
    return selected.map(clone);
  }

  function getSummary(filter = {}) {
    const selected = list(filter);
    const pending = resourceFlowSystem.getSummary({ skipFlush: true }).pending;
    return summarize(selected, pending);
  }

  function getDailySummary(yearOrDay, maybeDay) {
    if (yearOrDay && typeof yearOrDay === 'object') return getSummary(yearOrDay);
    if (maybeDay !== undefined) return getSummary({ year: yearOrDay, day: maybeDay });
    const current = globalThis.shengling?.gameTime?.now?.() ?? {};
    return getSummary({ year: Number(current.year ?? 1), day: Number(yearOrDay ?? current.day ?? 1) });
  }

  function verify() {
    const base = resourceFlowSystem.verify();
    const issues = [...(base.issues ?? [])];
    list().filter((entry) => entry.metadata?.maintenanceMode || entry.category === 'replacement').forEach((entry) => {
      if (!entry.taskId) issues.push({ type: 'tool-maintenance-flow-missing-task', id: entry.id });
      if (!entry.metadata?.toolId) issues.push({ type: 'tool-maintenance-flow-missing-tool', id: entry.id });
      if (!['repair', 'replace'].includes(entry.metadata?.maintenanceMode)) {
        issues.push({ type: 'tool-maintenance-flow-invalid-mode', id: entry.id, mode: entry.metadata?.maintenanceMode });
      }
      if (entry.category === 'replacement' && entry.metadata?.actionType !== 'replaceTool') {
        issues.push({ type: 'replacement-flow-action-mismatch', id: entry.id });
      }
    });
    return { ...base, ok: issues.length === 0, issues };
  }

  function exportState() {
    const state = resourceFlowSystem.exportState();
    return { ...state, entries: (state.entries ?? []).map(correctedEntry) };
  }

  function createCheckpoint() {
    const checkpoint = resourceFlowSystem.createCheckpoint();
    return {
      ...checkpoint,
      state: checkpoint?.state
        ? { ...checkpoint.state, entries: (checkpoint.state.entries ?? []).map(correctedEntry) }
        : checkpoint?.state,
    };
  }

  return Object.freeze({
    ...resourceFlowSystem,
    list,
    getSummary,
    getDailySummary,
    verify,
    exportState,
    createCheckpoint,
  });
}
