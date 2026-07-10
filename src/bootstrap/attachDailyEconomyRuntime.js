import { createUiRenderScheduler } from '../core/ui/uiRenderScheduler.js';
import { createDailyEconomySystem } from '../modules/economy/dailyEconomySystem.js';

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
  readout.textContent = [
    `第 ${report.day} 日经济`,
    `食物 ${signed(foodDelta(report))}`,
    `水 ${signed(report.balances?.water?.actualDelta)}`,
    `木材 ${signed(report.balances?.wood?.actualDelta)}`,
    `劳动 ${report.labor.completed}/${report.labor.assigned}`,
    bottleneck,
  ].join(' · ');
}

export function attachDailyEconomyRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus || !runtime.resourceFlowSystem) throw new Error('每日经济摘要启动失败：资源流水尚未初始化。');
  if (runtime.dailyEconomySystem) return runtime.dailyEconomySystem;

  const dailyEconomySystem = createDailyEconomySystem({
    eventBus,
    gameTime: runtime.gameTime,
    resourceFlowSystem: runtime.resourceFlowSystem,
    getRuntime: () => globalThis.shengling,
  });
  const readout = ensureReadout();
  const scheduler = createUiRenderScheduler({
    maxFps: 10,
    render: () => render(readout, dailyEconomySystem),
  });

  eventBus.on('*', ({ eventName, payload }) => dailyEconomySystem.observe(eventName, payload));
  ['simulation:time', 'resource-flow:recorded', 'daily-economy:finalized', 'daily-economy:hydrated']
    .forEach((eventName) => eventBus.on(eventName, () => scheduler.request(eventName)));
  eventBus.on('save:loaded', () => scheduler.request('save:loaded'));

  globalThis.shengling = Object.freeze({ ...runtime, dailyEconomySystem });
  scheduler.flush('initial');
  return dailyEconomySystem;
}
