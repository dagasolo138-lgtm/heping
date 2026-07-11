import test from 'node:test';
import assert from 'node:assert/strict';

import { createEconomicMetricsAuditView, decorateEconomicMetrics } from '../src/modules/economy/economicMetricsAuditView.js';

function sampleReport() {
  return {
    year: 1,
    day: 8,
    balances: {
      water: { opening: 10, production: 100, spoilage: 0 },
      wood: { opening: 5, production: 50, spoilage: 0 },
      berries: { opening: 1, production: 2, spoilage: 1 },
    },
    stockTargets: {
      goals: { water: 100, food: 10, wood: 10 },
      amounts: { effective: { water: 95, food: 9, wood: 5 } },
    },
    stockGaps: { water: 5, food: 1, wood: 5 },
    bottlenecks: [
      { type: 'stock-gap', severity: 'high', itemId: 'water', value: 5, label: '旧库存缺口' },
      { type: 'spoilage-pressure', severity: 'medium', value: 1, label: '旧混合腐败率' },
      { type: 'inventory-mismatch', severity: 'high', itemId: 'stone', value: 1, label: '石料账实差异' },
    ],
    simulationErrors: [],
  };
}

test('腐败压力只使用同一种物品的期初库存和当日产出', () => {
  const report = decorateEconomicMetrics(sampleReport());
  assert.equal(report.spoilagePressure.berries.available, 3);
  assert.equal(report.spoilagePressure.berries.ratio, 0.333);

  const bottleneck = report.bottlenecks.find((entry) => entry.type === 'spoilage-pressure');
  assert.equal(bottleneck.itemId, 'berries');
  assert.equal(bottleneck.ratio, 0.333);
  assert.match(bottleneck.label, /浆果腐败 1/);
  assert.equal(report.bottlenecks.some((entry) => entry.label === '旧混合腐败率'), false);
});

test('库存缺口严重度按目标比例判定而非绝对数量', () => {
  const report = decorateEconomicMetrics(sampleReport());
  const water = report.bottlenecks.find((entry) => entry.type === 'stock-gap' && entry.itemId === 'water');
  const wood = report.bottlenecks.find((entry) => entry.type === 'stock-gap' && entry.itemId === 'wood');

  assert.equal(water.value, 5);
  assert.equal(water.ratio, 0.05);
  assert.equal(water.severity, 'low');
  assert.equal(wood.value, 5);
  assert.equal(wood.ratio, 0.5);
  assert.equal(wood.severity, 'high');
  assert.equal(report.stockGapRatios.food, 0.1);
});

test('修正后的瓶颈按严重度排序并保留其他审计结果', () => {
  const report = decorateEconomicMetrics(sampleReport());
  assert.equal(report.bottlenecks[0].severity, 'high');
  assert.ok(report.bottlenecks.some((entry) => entry.type === 'inventory-mismatch'));
  assert.equal(report.bottlenecks.filter((entry) => entry.type === 'stock-gap').length, 3);
  assert.equal(report.economicMetricsVersion, 2);
});

test('审计视图统一修正当前、历史和列表报告', () => {
  const baseReport = sampleReport();
  const base = {
    getCurrentReport: () => structuredClone(baseReport),
    getReport: () => structuredClone(baseReport),
    listReports: () => [structuredClone(baseReport)],
    finalizeCurrent: () => structuredClone(baseReport),
    rollover: () => structuredClone(baseReport),
    verify: () => ({ ok: true, issues: [], reports: 1 }),
    exportState: () => ({ schemaVersion: 1 }),
    importState: () => ({ schemaVersion: 1 }),
    reset: () => ({ schemaVersion: 1 }),
    createCheckpoint: () => ({ schemaVersion: 1 }),
    restoreCheckpoint: () => ({ schemaVersion: 1 }),
    observe: () => {},
  };
  const view = createEconomicMetricsAuditView({ dailyEconomySystem: base });

  assert.equal(view.getCurrentReport().economicMetricsVersion, 2);
  assert.equal(view.getReport(1, 8).stockGapRatios.wood, 0.5);
  assert.equal(view.listReports()[0].spoilagePressure.berries.ratio, 0.333);
  assert.equal(view.verify().ok, true);
});
