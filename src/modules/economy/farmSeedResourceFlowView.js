function clone(value) {
  return structuredClone(value);
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function correctedEntry(entry) {
  if (entry?.itemId !== 'milletSeed') return clone(entry);
  const draft = clone(entry);
  const reason = String(draft.reason ?? '');
  const actionType = draft.metadata?.actionType ?? null;

  if (reason.includes('farm-seed-pickup')) {
    return {
      ...draft,
      to: 'seed-transit:millet',
      category: 'transfer',
      metadata: { ...(draft.metadata ?? {}), seedPhase: 'pickup' },
    };
  }

  if (actionType === 'sowMillet' && String(draft.from).startsWith('world:')) {
    return {
      ...draft,
      from: 'seed-transit:millet',
      category: 'transfer',
      metadata: { ...(draft.metadata ?? {}), seedPhase: 'pickup' },
    };
  }

  if (actionType === 'sowMillet' && String(draft.from).startsWith('person:')) {
    return {
      ...draft,
      to: 'farm:planting',
      category: 'planting',
      metadata: { ...(draft.metadata ?? {}), seedPhase: 'planted' },
    };
  }

  if (reason.includes('farm-seed-bootstrap') || reason.includes('farm-seed-migration')) {
    return {
      ...draft,
      from: 'world:initial',
      category: 'production',
      metadata: { ...(draft.metadata ?? {}), seedPhase: reason.includes('migration') ? 'migration' : 'bootstrap' },
    };
  }

  return draft;
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

export function createFarmSeedResourceFlowView({ resourceFlowSystem } = {}) {
  if (!resourceFlowSystem) throw new Error('粟种资源流水视图缺少底层系统。');

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
    list({ category: 'planting' }).forEach((entry) => {
      if (entry.itemId !== 'milletSeed') issues.push({ type: 'planting-flow-invalid-item', id: entry.id, itemId: entry.itemId });
      if (!entry.taskId) issues.push({ type: 'planting-flow-missing-task', id: entry.id });
      if (!entry.personId) issues.push({ type: 'planting-flow-missing-person', id: entry.id });
      if (entry.metadata?.actionType !== 'sowMillet') issues.push({ type: 'planting-flow-action-mismatch', id: entry.id });
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
