export const DAILY_ECONOMY_SCHEMA_VERSION = 1;

const RESOURCE_ITEMS = Object.freeze(['wood', 'berries', 'millet', 'milletSeed', 'water', 'stone']);
const OUTFLOW_CATEGORIES = new Set(['consumption', 'fuel', 'construction', 'planting', 'repair', 'replacement', 'spoilage']);

function clone(value) {
  return structuredClone(value);
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function dayKey(time) {
  return `${Number(time?.year ?? 1)}:${Number(time?.day ?? 1)}`;
}

function emptyItems() {
  return Object.fromEntries(RESOURCE_ITEMS.map((itemId) => [itemId, 0]));
}

function inventorySnapshot(runtime = {}) {
  const byItem = emptyItems();
  const byAccount = {};
  const addAccount = (account, items = {}) => {
    const normalized = {};
    Object.entries(items).forEach(([itemId, amount]) => {
      const value = round(amount);
      normalized[itemId] = value;
      byItem[itemId] = round((byItem[itemId] ?? 0) + value);
    });
    byAccount[account] = normalized;
  };

  (runtime.peopleSystem?.list?.() ?? []).forEach((person) => {
    addAccount(`person:${person.id}`, person.inventory?.items);
  });
  (runtime.campStore?.list?.() ?? []).forEach((camp) => {
    addAccount(`camp:${camp.id}`, camp.items);
  });

  return { byItem, byAccount };
}

function emptyLabor() {
  return {
    assigned: 0,
    completed: 0,
    expectedSeconds: 0,
    expectedEnergy: 0,
    byAction: {},
  };
}

function emptyDenials() {
  return { total: 0, food: 0, water: 0, other: 0, byReason: {} };
}

function createDraft(time, runtime) {
  const openingInventory = inventorySnapshot(runtime);
  return {
    schemaVersion: DAILY_ECONOMY_SCHEMA_VERSION,
    year: Number(time.year),
    day: Number(time.day),
    openedAt: clone(time),
    openingInventory,
    labor: emptyLabor(),
    denials: emptyDenials(),
    simulationErrors: [],
  };
}

function addLabor(draft, task, kind) {
  if (!task?.type) return;
  const actionType = task.type;
  if (!draft.labor.byAction[actionType]) {
    draft.labor.byAction[actionType] = { assigned: 0, completed: 0, expectedSeconds: 0, expectedEnergy: 0 };
  }
  const bucket = draft.labor.byAction[actionType];
  if (kind === 'assigned') {
    const seconds = round(task.data?.laborCost?.expectedDuration ?? 0);
    const energy = round(task.data?.laborCost?.expectedEnergy ?? 0);
    draft.labor.assigned += 1;
    draft.labor.expectedSeconds = round(draft.labor.expectedSeconds + seconds);
    draft.labor.expectedEnergy = round(draft.labor.expectedEnergy + energy);
    bucket.assigned += 1;
    bucket.expectedSeconds = round(bucket.expectedSeconds + seconds);
    bucket.expectedEnergy = round(bucket.expectedEnergy + energy);
  } else if (kind === 'completed') {
    draft.labor.completed += 1;
    bucket.completed += 1;
  }
}

function flowSummary(entries) {
  const byCategory = {};
  const byItem = {};
  entries.forEach((entry) => {
    byCategory[entry.category] = round((byCategory[entry.category] ?? 0) + entry.amount);
    if (!byItem[entry.itemId]) {
      byItem[entry.itemId] = {
        production: 0,
        consumption: 0,
        fuel: 0,
        construction: 0,
        planting: 0,
        spoilage: 0,
        transfer: 0,
        wear: 0,
        repair: 0,
        replacement: 0,
      };
    }
    byItem[entry.itemId][entry.category] = round((byItem[entry.itemId][entry.category] ?? 0) + entry.amount);
  });
  return { totalEntries: entries.length, byCategory, byItem };
}

function stockTargetSnapshot(runtime = {}) {
  try {
    return runtime.stockTargetSystem?.get?.() ?? null;
  } catch {
    return null;
  }
}

function stockGaps(targets) {
  if (!targets) return {};
  const result = {};
  ['water', 'food', 'wood'].forEach((itemId) => {
    const goal = Number(targets.goals?.[itemId] ?? 0);
    const effective = Number(targets.amounts?.effective?.[itemId] ?? 0);
    result[itemId] = round(Math.max(0, goal - effective));
  });
  return result;
}

function buildBalances(opening, closing, summary) {
  const itemIds = new Set([
    ...Object.keys(opening.byItem ?? {}),
    ...Object.keys(closing.byItem ?? {}),
    ...Object.keys(summary.byItem ?? {}),
  ]);
  const balances = {};
  itemIds.forEach((itemId) => {
    if (itemId.startsWith('durability:')) return;
    const flow = summary.byItem[itemId] ?? {};
    const production = round(flow.production);
    const repair = round(flow.repair);
    const replacement = round(flow.replacement);
    const outflow = round([...OUTFLOW_CATEGORIES].reduce((total, category) => total + Number(flow[category] ?? 0), 0));
    const expectedDelta = round(production - outflow);
    const actualDelta = round(Number(closing.byItem?.[itemId] ?? 0) - Number(opening.byItem?.[itemId] ?? 0));
    balances[itemId] = {
      opening: round(opening.byItem?.[itemId]),
      closing: round(closing.byItem?.[itemId]),
      production,
      consumption: round(flow.consumption),
      fuel: round(flow.fuel),
      construction: round(flow.construction),
      planting: round(flow.planting),
      ...(repair > 0 ? { repair } : {}),
      ...(replacement > 0 ? { replacement } : {}),
      spoilage: round(flow.spoilage),
      internalTransfer: round(flow.transfer),
      expectedDelta,
      actualDelta,
      discrepancy: round(actualDelta - expectedDelta),
    };
  });
  return balances;
}

function detectBottlenecks({ flow, labor, denials, stockTargets, balances }) {
  const bottlenecks = [];
  if (denials.total > 0) {
    bottlenecks.push({ type: 'survival-shortage', severity: 'high', value: denials.total, label: `生存物资请求被拒 ${denials.total} 次` });
  }

  Object.entries(stockGaps(stockTargets)).forEach(([itemId, gap]) => {
    if (gap > 0.01) bottlenecks.push({ type: 'stock-gap', severity: gap >= 5 ? 'high' : 'medium', itemId, value: gap, label: `${itemId} 距三日目标仍差 ${gap}` });
  });

  const spoilage = Number(flow.byCategory.spoilage ?? 0);
  const production = Number(flow.byCategory.production ?? 0);
  if (spoilage > 0 && spoilage / Math.max(1, production) >= 0.2) {
    bottlenecks.push({ type: 'spoilage-pressure', severity: 'medium', value: round(spoilage), label: `腐败损失达到当日生产的 ${Math.round(spoilage / Math.max(1, production) * 100)}%` });
  }

  const backlog = Math.max(0, labor.assigned - labor.completed);
  if (backlog >= 3) bottlenecks.push({ type: 'labor-backlog', severity: backlog >= 8 ? 'high' : 'medium', value: backlog, label: `当日仍有 ${backlog} 个劳动任务未完成` });

  Object.entries(balances).forEach(([itemId, balance]) => {
    if (Math.abs(balance.discrepancy) > 0.01) {
      bottlenecks.push({ type: 'inventory-mismatch', severity: 'high', itemId, value: balance.discrepancy, label: `${itemId} 账实差异 ${balance.discrepancy}` });
    }
  });

  return bottlenecks;
}

export function createDailyEconomySystem({ eventBus, gameTime, resourceFlowSystem, getRuntime = () => globalThis.shengling } = {}) {
  const reports = new Map();
  let current = createDraft(gameTime.stamp(), getRuntime?.() ?? {});
  let rollingOver = false;

  function ensureCurrent() {
    const now = gameTime.stamp();
    if (dayKey(now) !== dayKey(current)) rollover(now);
    return current;
  }

  function buildReport(draft = current, closedAt = gameTime.stamp()) {
    const runtime = getRuntime?.() ?? {};
    const entries = resourceFlowSystem?.list?.({ day: draft.day }) ?? [];
    const flow = flowSummary(entries.filter((entry) => Number(entry.time?.year ?? draft.year) === draft.year));
    const closingInventory = inventorySnapshot(runtime);
    const targets = stockTargetSnapshot(runtime);
    const balances = buildBalances(draft.openingInventory, closingInventory, flow);
    const report = {
      schemaVersion: DAILY_ECONOMY_SCHEMA_VERSION,
      year: draft.year,
      day: draft.day,
      openedAt: clone(draft.openedAt),
      closedAt: clone(closedAt),
      openingInventory: clone(draft.openingInventory),
      closingInventory,
      flow,
      balances,
      labor: clone(draft.labor),
      denials: clone(draft.denials),
      stockTargets: clone(targets),
      stockGaps: stockGaps(targets),
      simulationErrors: clone(draft.simulationErrors),
    };
    report.bottlenecks = detectBottlenecks(report);
    report.ok = report.simulationErrors.length === 0
      && Object.values(report.balances).every((balance) => Math.abs(balance.discrepancy) <= 0.01);
    return report;
  }

  function finalizeCurrent(closedAt = gameTime.stamp()) {
    const report = buildReport(current, closedAt);
    reports.set(dayKey(report), clone(report));
    eventBus?.emit?.('daily-economy:finalized', { report: clone(report), time: clone(closedAt) });
    return clone(report);
  }

  function rollover(now = gameTime.stamp()) {
    if (dayKey(now) === dayKey(current) || rollingOver) return null;
    rollingOver = true;
    try {
      const report = finalizeCurrent(now);
      current = createDraft(now, getRuntime?.() ?? {});
      eventBus?.emit?.('daily-economy:opened', { year: current.year, day: current.day, openingInventory: clone(current.openingInventory), time: clone(now) });
      return report;
    } finally {
      rollingOver = false;
    }
  }

  function observe(eventName, payload = {}) {
    if (rollingOver && eventName.startsWith('daily-economy:')) return;
    if (eventName === 'simulation:pre-tick') {
      rollover(gameTime.stamp());
      return;
    }
    ensureCurrent();
    if (eventName === 'actions:assigned') addLabor(current, payload.task, 'assigned');
    else if (eventName === 'actions:completed') addLabor(current, payload.task, 'completed');
    else if (eventName === 'survival:resource-denied') {
      const need = payload.need === 'food' || payload.need === 'water' ? payload.need : 'other';
      const reason = payload.deniedReason ?? 'unknown';
      current.denials.total += 1;
      current.denials[need] += 1;
      current.denials.byReason[reason] = (current.denials.byReason[reason] ?? 0) + 1;
    } else if (eventName === 'simulation:error') {
      current.simulationErrors.push({ message: payload.error?.message ?? String(payload.error ?? 'unknown'), time: clone(gameTime.stamp()) });
    }
  }

  function getReport(year, day) {
    const key = `${Number(year)}:${Number(day)}`;
    if (key === dayKey(current)) return buildReport(current);
    const report = reports.get(key);
    return report ? clone(report) : null;
  }

  function getCurrentReport() {
    ensureCurrent();
    return buildReport(current);
  }

  function listReports({ includeCurrent = true, limit = 0 } = {}) {
    const result = [...reports.values()]
      .sort((first, second) => first.year - second.year || first.day - second.day)
      .map(clone);
    if (includeCurrent) result.push(getCurrentReport());
    return limit > 0 ? result.slice(-limit) : result;
  }

  function verify() {
    const issues = [];
    listReports().forEach((report) => {
      Object.entries(report.balances).forEach(([itemId, balance]) => {
        if (Math.abs(balance.discrepancy) > 0.01) issues.push({ type: 'inventory-mismatch', year: report.year, day: report.day, itemId, discrepancy: balance.discrepancy });
        if (balance.closing < -0.001) issues.push({ type: 'negative-closing-inventory', year: report.year, day: report.day, itemId, amount: balance.closing });
      });
      report.simulationErrors.forEach((error) => issues.push({ type: 'simulation-error', year: report.year, day: report.day, error }));
    });
    const flowVerification = resourceFlowSystem?.verify?.() ?? { ok: true, issues: [] };
    if (!flowVerification.ok) issues.push(...flowVerification.issues.map((issue) => ({ type: 'resource-flow', issue })));
    return { ok: issues.length === 0, issues, reports: reports.size, currentDay: { year: current.year, day: current.day } };
  }

  function exportState() {
    return {
      schemaVersion: DAILY_ECONOMY_SCHEMA_VERSION,
      exportedAt: clone(gameTime.stamp()),
      reports: [...reports.values()].map(clone),
      current: clone(current),
    };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== DAILY_ECONOMY_SCHEMA_VERSION || !Array.isArray(snapshot.reports)) {
      throw new Error('每日经济摘要存档格式不兼容。');
    }
    reports.clear();
    snapshot.reports.forEach((report) => {
      if (!Number.isFinite(Number(report?.year)) || !Number.isFinite(Number(report?.day))) throw new Error('每日经济摘要包含无效日期。');
      reports.set(dayKey(report), clone(report));
    });
    current = snapshot.current ? clone(snapshot.current) : createDraft(gameTime.stamp(), getRuntime?.() ?? {});
    eventBus?.emit?.('daily-economy:hydrated', { reports: reports.size, currentDay: { year: current.year, day: current.day }, time: clone(gameTime.stamp()) });
    return exportState();
  }

  function reset() {
    reports.clear();
    current = createDraft(gameTime.stamp(), getRuntime?.() ?? {});
    eventBus?.emit?.('daily-economy:reset', { time: clone(gameTime.stamp()) });
    return exportState();
  }

  function createCheckpoint() {
    return exportState();
  }

  function restoreCheckpoint(snapshot) {
    return importState(snapshot);
  }

  return Object.freeze({
    observe,
    rollover,
    finalizeCurrent,
    getReport,
    getCurrentReport,
    listReports,
    verify,
    exportState,
    importState,
    reset,
    createCheckpoint,
    restoreCheckpoint,
  });
}
