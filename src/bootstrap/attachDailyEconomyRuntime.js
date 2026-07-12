import { createUiRenderScheduler } from '../core/ui/uiRenderScheduler.js';
import { createDailyEconomySystem } from '../modules/economy/dailyEconomySystem.js';
import { createEconomicMetricsAuditView } from '../modules/economy/economicMetricsAuditView.js';
import { createFarmSeedDailyEconomyView } from '../modules/economy/farmSeedDailyEconomyView.js';
import { createTaskLifecycleEconomyView } from '../modules/economy/taskLifecycleEconomyView.js';

function ensureReadout() {
  const host = document.querySelector('.camp-stock');
  if (!host) return null;
  let readout = host.querySelector('#daily-economy-detail');
  if (readout) return readout;
  readout = document.createElement('p');
  readout.id = 'daily-economy-detail';
  readout.className = 'food-freshness-detail daily-economy-detail';
  host.append(readout);
  return readout;
}

function signed(value) {
  const rounded = Math.round(Number(value ?? 0) * 10) / 10;
  return `${rounded > 0 ? '+' : ''}${rounded}`;
}

function foodDelta(report) {
  return Number(report.balances?.berries?.actualDelta ?? 0) + Number(report.balances?.millet?.actualDelta ?? 0);
}

function render(readout, system) {
  if (!readout) return;
  const report = system.getCurrentReport();
  const bottleneck = report.bottlenecks?.[0]?.label ?? '暂无明显瓶颈';
  const laborStatus = report.labor.cancelled || report.labor.failed
    ? `${report.labor.completed}/${report.labor.started}，中断 ${report.labor.cancelled + report.labor.failed}`
    : `${report.labor.completed}/${report.labor.started}`;
  readout.textContent = [
    `第 ${report.day} 日经济`,
    `食物 ${signed(foodDelta(report))}`,
    `粟种 ${signed(report.balances?.milletSeed?.actualDelta)}`,
    `水 ${signed(report.balances?.water?.actualDelta)}`,
    `木材 ${signed(report.balances?.wood?.actualDelta)}`,
    `劳动 ${laborStatus}`,
    bottleneck,
  ].join(' · ');
}

export function attachDailyEconomyRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus || !runtime.resourceFlowSystem) throw new Error('每日经济摘要启动失败：资源流水尚未初始化。');
  if (!runtime.taskLifecycleSystem) throw new Error('每日经济摘要启动失败：任务生命周期账本尚未初始化。');
  if (runtime.dailyEconomySystem) return runtime.dailyEconomySystem;

  const baseDailyEconomySystem = createDailyEconomySystem({
    eventBus,
    gameTime: runtime.gameTime,
    resourceFlowSystem: runtime.resourceFlowSystem,
    getRuntime: () => globalThis.shengling,
  });
  const lifecycleDailyEconomySystem = createTaskLifecycleEconomyView({
    dailyEconomySystem: baseDailyEconomySystem,
    taskLifecycleSystem: runtime.taskLifecycleSystem,
  });
  const seedDailyEconomySystem = createFarmSeedDailyEconomyView({
    dailyEconomySystem: lifecycleDailyEconomySystem,
  });
  const dailyEconomySystem = createEconomicMetricsAuditView({
    dailyEconomySystem: seedDailyEconomySystem,
  });
  const readout = ensureReadout();
  const scheduler = createUiRenderScheduler({
    maxFps: 10,
    render: () => render(readout, dailyEconomySystem),
  });

  eventBus.on('*', ({ eventName, payload }) => baseDailyEconomySystem.observe(eventName, payload));
  ['simulation:time', 'resource-flow:recorded', 'task-lifecycle:closed', 'daily-economy:finalized', 'daily-economy:hydrated']
    .forEach((eventName) => eventBus.on(eventName, () => scheduler.request(eventName)));
  eventBus.on('save:loaded', () => scheduler.request('save:loaded'));

  globalThis.shengling = Object.freeze({ ...runtime, dailyEconomySystem });
  scheduler.flush('initial');
  return dailyEconomySystem;
}
