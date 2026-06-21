import { createFarmSystem } from '../modules/farming/farmSystem.js';

function updatePhaseCopy() {
  const eyebrow = document.querySelector('.eyebrow');
  const subtitle = document.querySelector('.subtitle');
  const note = document.querySelector('.phase-note');
  if (eyebrow) eyebrow.textContent = 'SHENGLING / FOUNDATION 10';
  if (subtitle) subtitle.textContent = '起始河谷 · 生存、建造与稳定食物来源原型';
  if (note) note.innerHTML = '<strong>第十阶段：</strong>储物棚完成后，村民会开垦第一块粟田。粟米会经历开垦、播种、生长与收获，收获后进入营地成为新的稳定食物。';
}

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

function renderReadout(readout, farmSystem) {
  if (!readout) return;
  const summary = farmSystem.getSummary();
  if (!summary.total) {
    readout.textContent = '农事准备 · 等待储物棚完成';
    return;
  }
  if (summary.mature) {
    readout.textContent = `农事 · ${summary.mature} 块粟田成熟 · 种子 ${summary.seedStock}`;
    return;
  }
  if (summary.growing) {
    readout.textContent = `农事 · ${summary.growing} 块粟田生长中 · 种子 ${summary.seedStock}`;
    return;
  }
  readout.textContent = `农事 · 待开垦/播种 ${summary.clearing} 块 · 种子 ${summary.seedStock}`;
}

function patchMilletChip(runtime) {
  const container = document.querySelector('#camp-resources');
  if (!container) return;
  const amount = Number(runtime.campStore.get('starting-camp')?.items?.millet ?? 0);
  let chip = container.querySelector('#millet-resource-chip');
  if (!chip) {
    chip = document.createElement('span');
    chip.id = 'millet-resource-chip';
    chip.className = 'resource-chip resource-chip--millet';
    container.append(chip);
  }
  chip.innerHTML = `<b>粟米</b><strong>${amount}</strong>`;
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
  });
  updatePhaseCopy();
  const readout = ensureReadout();
  renderReadout(readout, farmSystem);
  patchMilletChip(runtime);

  eventBus.on('farms:changed', () => {
    renderReadout(readout, farmSystem);
    runtime.mapView.redraw();
  });
  eventBus.on('farms:matured', ({ field }) => {
    const status = document.querySelector('#system-status');
    if (status) status.textContent = `${field.label}的粟米已经成熟，村民可以开始收获。`;
  });
  eventBus.on('camp:changed', () => patchMilletChip(runtime));

  globalThis.shengling = Object.freeze({ ...runtime, farmSystem });
  return farmSystem;
}
