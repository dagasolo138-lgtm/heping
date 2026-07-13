import { createUiRenderScheduler } from '../core/ui/uiRenderScheduler.js';
import { createFarmGrowthTickHandler } from '../modules/farming/farmGrowthScheduler.js';
import { createFarmSystem } from '../modules/farming/farmSystem.js';

function ensureReadout() {
  let readout = document.querySelector('#farm-readout');
  if (readout) return readout;
  const mapWrap = document.querySelector('.map-canvas-wrap');
  if (!mapWrap) return null;
  readout = document.createElement('div');
  readout.id = 'farm-readout';
  readout.className = 'map-overlay map-overlay--farm';
  mapWrap.append(readout);
  return readout;
}

function soilText(summary) {
  const fertility = summary.soil?.averageFertility;
  if (fertility === null || fertility === undefined) return '';
  const warning = Number(summary.soil?.thinFields ?? 0) ? ' · 有瘠薄田' : Number(summary.soil?.poorFields ?? 0) ? ' · 有贫瘠田' : '';
  return ` · 土壤 ${fertility}${warning}`;
}

function seedText(summary) {
  const seed = summary.seed ?? {};
  const shortage = Number(seed.shortage ?? 0);
  return `粟种 ${Number(seed.onHand ?? 0)}/${Number(seed.target ?? 0)}${shortage > 0 ? ` · 缺 ${shortage}` : ''}`;
}

function renderReadout(readout, farmSystem) {
  if (!readout) return;
  const summary = farmSystem.getSummary();
  if (!summary.total) {
    readout.textContent = '农事准备 · 等待储物棚完成';
    return;
  }
  const soil = soilText(summary);
  const seeds = seedText(summary);
  if (summary.mature) {
    readout.textContent = `农事 · ${summary.mature} 块粟田成熟待收 · ${seeds}${soil}`;
    return;
  }
  if (summary.growing) {
    readout.textContent = `农事 · ${summary.growing} 块粟田生长中 · ${seeds}${soil}`;
    return;
  }
  if (summary.waitingToSow) {
    readout.textContent = `农事 · ${summary.waitingToSow} 块粟田等待春播 · ${seeds}${soil}`;
    return;
  }
  if (summary.sowable) {
    readout.textContent = `农事 · ${summary.sowable} 块粟田可播种 · ${seeds}${soil}`;
    return;
  }
  readout.textContent = `农事 · 待开垦 ${summary.clearing} 块 · ${seeds}${soil}`;
}

function patchResourceChip(container, { id, label, amount, className }) {
  let chip = container.querySelector(`#${id}`);
  if (!chip) {
    chip = document.createElement('span');
    chip.id = id;
    chip.className = `resource-chip ${className}`;
    container.append(chip);
  }
  chip.innerHTML = `<b>${label}</b><strong>${amount}</strong>`;
}

function patchFarmChips(runtime, farmSystem) {
  const container = document.querySelector('#camp-resources');
  if (!container) return;
  const camp = runtime.campStore.get('starting-camp');
  patchResourceChip(container, {
    id: 'millet-resource-chip',
    label: '粟米',
    amount: Number(camp?.items?.millet ?? 0),
    className: 'resource-chip--millet',
  });
  const seed = farmSystem.getSeedSummary();
  patchResourceChip(container, {
    id: 'millet-seed-resource-chip',
    label: `粟种 · 目标 ${seed.target}`,
    amount: Number(camp?.items?.milletSeed ?? 0),
    className: 'resource-chip--millet',
  });
}

export function attachFarmRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('农田模块启动失败：世界运行时尚未初始化。');
  if (runtime.farmSystem) return runtime.farmSystem;

  const farmSystem = createFarmSystem({
    eventBus,
    gameTime: runtime.gameTime,
    mapSystem: runtime.mapSystem,
    buildingSystem: runtime.buildingSystem,
    seasonSystem: runtime.seasonSystem,
  });
  const readout = ensureReadout();
  const ui = createUiRenderScheduler({
    maxFps: 10,
    render: () => {
      renderReadout(readout, farmSystem);
      patchFarmChips(runtime, farmSystem);
      runtime.mapView.redraw();
    },
  });
  renderReadout(readout, farmSystem);
  patchFarmChips(runtime, farmSystem);

  const syncFarmGrowth = createFarmGrowthTickHandler({
    farmSystem,
    gameTime: runtime.gameTime,
  });
  eventBus.on('simulation:tick', syncFarmGrowth);
  eventBus.on('farms:changed', () => ui.request('farms:changed'));
  eventBus.on('farms:matured', ({ field }) => {
    const status = document.querySelector('#system-status');
    if (status) status.textContent = `${field.label}的粟米已经成熟，村民可以开始收获。`;
  });
  eventBus.on('seasons:changed', () => ui.request('seasons:changed'));
  eventBus.on('camp:changed', () => ui.request('camp:changed'));

  const system = Object.freeze({ ...farmSystem, stopUi: () => ui.stop() });
  globalThis.shengling = Object.freeze({ ...runtime, farmSystem: system });
  return system;
}
