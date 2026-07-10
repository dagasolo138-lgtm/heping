import { createUiRenderScheduler } from '../core/ui/uiRenderScheduler.js';
import { createFoodStorageSystem } from '../modules/storage/foodStorageSystem.js';

function ensureElements() {
  const mapWrap = document.querySelector('.map-canvas-wrap');
  const campStock = document.querySelector('.camp-stock');
  if (!mapWrap || !campStock) return { readout: null, detail: null };

  let readout = document.querySelector('#food-storage-readout');
  if (!readout) {
    readout = document.createElement('div');
    readout.id = 'food-storage-readout';
    readout.className = 'map-overlay map-overlay--food';
    mapWrap.append(readout);
  }

  let detail = document.querySelector('#food-freshness-detail');
  if (!detail) {
    detail = document.createElement('p');
    detail.id = 'food-freshness-detail';
    detail.className = 'food-freshness-detail';
    campStock.append(detail);
  }
  return { readout, detail };
}

function foodPart(label, state) {
  if (!state?.amount) return `${label} 0`;
  return `${label} ${state.amount} · 新鲜 ${state.freshness}%`;
}

function render(elements, foodStorageSystem) {
  const summary = foodStorageSystem.getSummary();
  const food = summary.food?.items ?? {};
  const storage = summary.storage;
  const weather = summary.weather;
  const berries = food.berries;
  const millet = food.millet;
  const spoiled = summary.food?.totalSpoiled ?? 0;
  const protection = Math.round(Number(storage?.protection ?? 0) * 100);
  const risk = weather?.isRain ? '雨损风险高' : weather?.id === 'cloudy' ? '潮湿风险中等' : '储存风险较低';
  const storageLabel = protection > 0 ? `储物棚防护 ${protection}%` : '露天堆放';
  const content = `${foodPart('浆果', berries)} · ${foodPart('粟米', millet)} · ${storageLabel} · ${risk}`;

  if (elements.readout) elements.readout.textContent = `食物保存 · 损耗 ${spoiled} · ${storageLabel}`;
  if (elements.detail) elements.detail.textContent = content;
}

function spoiledText(spoiled) {
  return Object.entries(spoiled)
    .filter(([, amount]) => amount > 0)
    .map(([itemId, amount]) => `${itemId === 'berries' ? '浆果' : '粟米'} ${amount}`)
    .join('、');
}

export function attachFoodStorageRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('食物储存模块启动失败：世界运行时尚未初始化。');
  if (runtime.foodStorageSystem) return runtime.foodStorageSystem;

  const foodStorageSystem = createFoodStorageSystem({
    eventBus,
    gameTime: runtime.gameTime,
    campStore: runtime.campStore,
  });
  const elements = ensureElements();
  const ui = createUiRenderScheduler({ maxFps: 10, render: () => render(elements, foodStorageSystem) });
  render(elements, foodStorageSystem);

  eventBus.on('simulation:tick', ({ weather }) => foodStorageSystem.sync(weather));
  eventBus.on('camp:changed', () => ui.request('camp:changed'));
  eventBus.on('storage:food-aged', () => ui.request('storage:food-aged'));
  eventBus.on('storage:food-spoiled', ({ spoiled }) => {
    const status = document.querySelector('#system-status');
    const text = spoiledText(spoiled);
    if (status && text) status.textContent = `${text}因储存损耗而无法食用。`;
  });

  const system = Object.freeze({ ...foodStorageSystem, stopUi: () => ui.stop() });
  globalThis.shengling = Object.freeze({ ...runtime, foodStorageSystem: system });
  return system;
}
