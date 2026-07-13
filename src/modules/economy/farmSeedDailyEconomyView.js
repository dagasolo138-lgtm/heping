function clone(value) {
  return structuredClone(value);
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function decorateBalance(balance, planting) {
  const next = clone(balance ?? {});
  const planted = round(planting);
  const previousPlanting = round(next.planting);
  const additionalPlanting = round(planted - previousPlanting);
  const expectedDelta = round(Number(next.expectedDelta ?? 0) - additionalPlanting);
  const actualDelta = round(next.actualDelta);
  return {
    ...next,
    ...(planted > 0 ? { planting: planted } : {}),
    expectedDelta,
    discrepancy: round(actualDelta - expectedDelta),
  };
}

function decorateBottlenecks(report) {
  const bottlenecks = (report.bottlenecks ?? [])
    .filter((entry) => entry.type !== 'inventory-mismatch')
    .map(clone);
  Object.entries(report.balances ?? {}).forEach(([itemId, balance]) => {
    if (Math.abs(Number(balance.discrepancy ?? 0)) <= 0.01) return;
    bottlenecks.push({
      type: 'inventory-mismatch',
      severity: 'high',
      itemId,
      value: Number(balance.discrepancy),
      label: `${itemId} 账实差异 ${balance.discrepancy}`,
    });
  });
  return bottlenecks;
}

export function decorateFarmSeedEconomy(report) {
  if (!report) return null;
  const next = clone(report);
  const seedFlow = next.flow?.byItem?.milletSeed ?? {};
  const planting = round(seedFlow.planting);
  const existing = next.balances?.milletSeed ?? {
    opening: 0,
    closing: 0,
    production: 0,
    consumption: 0,
    fuel: 0,
    construction: 0,
    spoilage: 0,
    internalTransfer: 0,
    expectedDelta: 0,
    actualDelta: 0,
    discrepancy: 0,
  };
  next.balances = { ...(next.balances ?? {}), milletSeed: decorateBalance(existing, planting) };
  next.bottlenecks = decorateBottlenecks(next);
  next.ok = (next.simulationErrors ?? []).length === 0
    && Object.values(next.balances).every((balance) => Math.abs(Number(balance.discrepancy ?? 0)) <= 0.01);
  return next;
}

export function createFarmSeedDailyEconomyView({ dailyEconomySystem } = {}) {
  if (!dailyEconomySystem) throw new Error('粟种每日经济视图缺少底层系统。');

  function verify() {
    const base = dailyEconomySystem.verify();
    const issues = (base.issues ?? [])
      .filter((issue) => !(issue.type === 'inventory-mismatch' && issue.itemId === 'milletSeed'))
      .map(clone);
    const reports = listReports();
    reports.forEach((report) => {
      Object.entries(report.balances ?? {}).forEach(([itemId, balance]) => {
        if (Math.abs(Number(balance.discrepancy ?? 0)) > 0.01) {
          issues.push({
            type: 'inventory-mismatch',
            year: report.year,
            day: report.day,
            itemId,
            discrepancy: Number(balance.discrepancy),
          });
        }
        if (Number(balance.closing ?? 0) < -0.001) {
          issues.push({ type: 'negative-closing-inventory', year: report.year, day: report.day, itemId, amount: balance.closing });
        }
      });
    });
    return { ...base, ok: issues.length === 0, issues };
  }

  function listReports(...args) {
    return dailyEconomySystem.listReports(...args).map(decorateFarmSeedEconomy);
  }

  return Object.freeze({
    ...dailyEconomySystem,
    rollover: (...args) => decorateFarmSeedEconomy(dailyEconomySystem.rollover(...args)),
    finalizeCurrent: (...args) => decorateFarmSeedEconomy(dailyEconomySystem.finalizeCurrent(...args)),
    getReport: (...args) => decorateFarmSeedEconomy(dailyEconomySystem.getReport(...args)),
    getCurrentReport: () => decorateFarmSeedEconomy(dailyEconomySystem.getCurrentReport()),
    listReports,
    verify,
  });
}
