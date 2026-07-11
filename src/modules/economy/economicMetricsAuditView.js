const RESOURCE_LABELS = Object.freeze({
  water: '水',
  food: '食物',
  berries: '浆果',
  millet: '粟米',
  wood: '木材',
  stone: '石料',
});
const SEVERITY_RANK = Object.freeze({ high: 3, medium: 2, low: 1 });

function clone(value) {
  return structuredClone(value);
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function clampRatio(value) {
  return round(Math.max(0, Math.min(1, Number(value) || 0)));
}

function resourceLabel(itemId) {
  return RESOURCE_LABELS[itemId] ?? itemId;
}

function severityForRatio(ratio) {
  if (ratio >= 0.5) return 'high';
  if (ratio >= 0.2) return 'medium';
  return 'low';
}

function buildStockGapMetrics(report) {
  const targets = report.stockTargets ?? {};
  const result = {};
  ['water', 'food', 'wood'].forEach((itemId) => {
    const goal = Math.max(0, Number(targets.goals?.[itemId] ?? 0));
    const effective = Math.max(0, Number(targets.amounts?.effective?.[itemId] ?? 0));
    const gap = Math.max(0, Number(report.stockGaps?.[itemId] ?? goal - effective));
    const ratio = goal > 0 ? clampRatio(gap / goal) : 0;
    result[itemId] = Object.freeze({
      goal: round(goal),
      effective: round(effective),
      gap: round(gap),
      ratio,
      severity: gap > 0.01 ? severityForRatio(ratio) : null,
    });
  });
  return Object.freeze(result);
}

function buildSpoilagePressure(report) {
  const result = {};
  Object.entries(report.balances ?? {}).forEach(([itemId, balance]) => {
    const spoilage = Math.max(0, Number(balance.spoilage ?? 0));
    if (spoilage <= 0.01) return;
    const opening = Math.max(0, Number(balance.opening ?? 0));
    const production = Math.max(0, Number(balance.production ?? 0));
    const available = opening + production;
    const ratio = available > 0 ? clampRatio(spoilage / available) : 1;
    result[itemId] = Object.freeze({
      spoilage: round(spoilage),
      opening: round(opening),
      production: round(production),
      available: round(available),
      ratio,
      severity: ratio >= 0.35 ? 'high' : ratio >= 0.2 ? 'medium' : 'low',
    });
  });
  return Object.freeze(result);
}

function sortBottlenecks(entries) {
  return entries
    .map((entry, index) => ({ entry, index }))
    .sort((first, second) => {
      const severity = Number(SEVERITY_RANK[second.entry.severity] ?? 0) - Number(SEVERITY_RANK[first.entry.severity] ?? 0);
      return severity || first.index - second.index;
    })
    .map(({ entry }) => entry);
}

export function decorateEconomicMetrics(report) {
  if (!report) return null;
  const stockGapMetrics = buildStockGapMetrics(report);
  const spoilagePressure = buildSpoilagePressure(report);
  const bottlenecks = (report.bottlenecks ?? [])
    .filter((entry) => entry.type !== 'stock-gap' && entry.type !== 'spoilage-pressure')
    .map(clone);

  Object.entries(stockGapMetrics).forEach(([itemId, metric]) => {
    if (metric.gap <= 0.01) return;
    bottlenecks.push({
      type: 'stock-gap',
      severity: metric.severity,
      itemId,
      value: metric.gap,
      ratio: metric.ratio,
      goal: metric.goal,
      effective: metric.effective,
      label: `${resourceLabel(itemId)}库存仅达到三日目标的 ${Math.round((1 - metric.ratio) * 100)}%，仍差 ${metric.gap}`,
    });
  });

  Object.entries(spoilagePressure).forEach(([itemId, metric]) => {
    if (metric.ratio < 0.2) return;
    bottlenecks.push({
      type: 'spoilage-pressure',
      severity: metric.severity,
      itemId,
      value: metric.spoilage,
      ratio: metric.ratio,
      available: metric.available,
      label: `${resourceLabel(itemId)}腐败 ${metric.spoilage}，占当日可用量的 ${Math.round(metric.ratio * 100)}%`,
    });
  });

  return {
    ...clone(report),
    economicMetricsVersion: 2,
    stockGapRatios: Object.freeze(Object.fromEntries(Object.entries(stockGapMetrics).map(([itemId, metric]) => [itemId, metric.ratio]))),
    stockGapMetrics,
    spoilagePressure,
    bottlenecks: sortBottlenecks(bottlenecks),
  };
}

export function createEconomicMetricsAuditView({ dailyEconomySystem } = {}) {
  if (!dailyEconomySystem) throw new Error('经济指标审计视图缺少每日经济系统。');

  function verify() {
    const base = dailyEconomySystem.verify();
    const issues = [...(base.issues ?? []).map(clone)];
    dailyEconomySystem.listReports().map(decorateEconomicMetrics).forEach((report) => {
      Object.entries(report.stockGapMetrics ?? {}).forEach(([itemId, metric]) => {
        if (metric.ratio < 0 || metric.ratio > 1) issues.push({ type: 'invalid-stock-gap-ratio', year: report.year, day: report.day, itemId, ratio: metric.ratio });
      });
      Object.entries(report.spoilagePressure ?? {}).forEach(([itemId, metric]) => {
        if (metric.ratio < 0 || metric.ratio > 1) issues.push({ type: 'invalid-spoilage-ratio', year: report.year, day: report.day, itemId, ratio: metric.ratio });
      });
    });
    return { ...base, ok: base.ok && issues.length === 0, issues };
  }

  return Object.freeze({
    ...dailyEconomySystem,
    rollover: (...args) => decorateEconomicMetrics(dailyEconomySystem.rollover(...args)),
    finalizeCurrent: (...args) => decorateEconomicMetrics(dailyEconomySystem.finalizeCurrent(...args)),
    getReport: (...args) => decorateEconomicMetrics(dailyEconomySystem.getReport(...args)),
    getCurrentReport: () => decorateEconomicMetrics(dailyEconomySystem.getCurrentReport()),
    listReports: (...args) => dailyEconomySystem.listReports(...args).map(decorateEconomicMetrics),
    verify,
  });
}
