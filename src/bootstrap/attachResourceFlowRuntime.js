import { createUiRenderScheduler } from '../core/ui/uiRenderScheduler.js';
import { createResourceFlowSystem } from '../modules/economy/resourceFlowSystem.js';

function ensureReadout() {
  const host = document.querySelector('.camp-stock');
  if (!host) return null;
  let readout = host.querySelector('#resource-flow-detail');
  if (readout) return readout;
  readout = document.createElement('p');
  readout.id = 'resource-flow-detail';
  readout.className = 'food-freshness-detail resource-flow-detail';
  host.append(readout);
  return readout;
}

function formatAmount(value) {
  return Math.round(Number(value ?? 0) * 10) / 10;
}

function render(readout, system, gameTime) {
  if (!readout) return;
  const summary = system.getDailySummary(gameTime.now().day);
  const category = summary.byCategory;
  readout.textContent = [
    `今日流水 ${summary.totalEntries} 笔`,
    `生产 ${formatAmount(category.production)}`,
    `消耗 ${formatAmount(category.consumption)}`,
    `施工 ${formatAmount(category.construction)}`,
    `腐败 ${formatAmount(category.spoilage)}`,
    `转移 ${formatAmount(category.transfer)}`,
  ].join(' · ');
}

export function attachResourceFlowRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('资源流水模块启动失败：世界运行时尚未初始化。');
  if (runtime.resourceFlowSystem) return runtime.resourceFlowSystem;

  const resourceFlowSystem = createResourceFlowSystem({
    eventBus,
    gameTime: runtime.gameTime,
    getRuntime: () => globalThis.shengling,
  });
  const readout = ensureReadout();
  const scheduler = createUiRenderScheduler({
    maxFps: 10,
    render: () => render(readout, resourceFlowSystem, runtime.gameTime),
  });

  eventBus.on('*', ({ eventName, payload }) => resourceFlowSystem.observe(eventName, payload));
  eventBus.on('resource-flow:recorded', () => scheduler.request('resource-flow:recorded'));
  eventBus.on('resource-flow:hydrated', () => scheduler.request('resource-flow:hydrated'));
  eventBus.on('save:loaded', () => {
    resourceFlowSystem.baseline();
    scheduler.request('save:loaded');
  });

  globalThis.shengling = Object.freeze({ ...runtime, resourceFlowSystem });
  scheduler.flush('initial');
  return resourceFlowSystem;
}
