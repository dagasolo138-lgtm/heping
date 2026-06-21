import { createResourceRenewalSystem } from '../modules/ecology/resourceRenewalSystem.js';

function updatePhaseCopy() {
  const eyebrow = document.querySelector('.eyebrow');
  const subtitle = document.querySelector('.subtitle');
  const note = document.querySelector('.phase-note');
  if (eyebrow) eyebrow.textContent = 'SHENGLING / FOUNDATION 08';
  if (subtitle) subtitle.textContent = '起始河谷 · 生存、建造与自然资源循环原型';
  if (note) note.innerHTML = '<strong>第八阶段：</strong>树木与浆果被耗尽后会留下恢复标记。树在三个世界日后、浆果在一个世界日后尝试回到原位置；建筑或其他物件占用时会顺延恢复。';
}

function ensureReadout() {
  let readout = document.querySelector('#ecology-readout');
  if (readout) return readout;
  const mapWrap = document.querySelector('.map-canvas-wrap');
  if (!mapWrap) return null;
  readout = document.createElement('div');
  readout.id = 'ecology-readout';
  readout.className = 'map-overlay map-overlay--ecology';
  mapWrap.append(readout);
  return readout;
}

function renderReadout(readout, ecologySystem) {
  if (!readout) return;
  const summary = ecologySystem.getSummary();
  if (!summary.total) {
    readout.textContent = '生态稳定 · 暂无资源恢复';
    return;
  }
  readout.textContent = `生态恢复 · 树 ${summary.byKind.tree} · 浆果 ${summary.byKind.berryBush}`;
}

export function attachEcologyRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('生态模块启动失败：世界运行时尚未初始化。');
  if (runtime.ecologySystem) return runtime.ecologySystem;

  const ecologySystem = createResourceRenewalSystem({
    eventBus,
    gameTime: runtime.gameTime,
    mapSystem: runtime.mapSystem,
    buildingSystem: runtime.buildingSystem,
  });
  updatePhaseCopy();
  const readout = ensureReadout();
  renderReadout(readout, ecologySystem);

  eventBus.on('ecology:changed', () => {
    renderReadout(readout, ecologySystem);
    runtime.mapView.redraw();
  });
  eventBus.on('ecology:regrown', ({ entry }) => {
    const status = document.querySelector('#system-status');
    if (status) status.textContent = `${entry.label}在原地恢复，起始河谷重新长出资源。`;
  });

  globalThis.shengling = Object.freeze({ ...runtime, ecologySystem });
  return ecologySystem;
}
