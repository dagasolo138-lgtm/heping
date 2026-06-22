const SECOND_FIELD_ID = 'second-millet-field';

function updatePhaseCopy() {
  const eyebrow = document.querySelector('.eyebrow');
  const subtitle = document.querySelector('.subtitle');
  const note = document.querySelector('.phase-note');
  if (eyebrow) eyebrow.textContent = 'SHENGLING / FOUNDATION 14';
  if (subtitle) subtitle.textContent = '起始河谷 · 生存、建造、农业与土地恢复原型';
  if (note) note.innerHTML = '<strong>第十四阶段：</strong>每块田都保存独立肥力。休耕会慢慢恢复，作物成长与收获会受土壤影响；连续耕作会让同一块土地逐渐减产。';
}

function ensureReadout() {
  let readout = document.querySelector('#farm-expansion-readout');
  if (readout) return readout;
  const mapWrap = document.querySelector('.map-canvas-wrap');
  if (!mapWrap) return null;
  readout = document.createElement('div');
  readout.id = 'farm-expansion-readout';
  readout.className = 'map-overlay map-overlay--expansion';
  mapWrap.append(readout);
  return readout;
}

function renderReadout(readout, farmSystem) {
  if (!readout) return;
  const summary = farmSystem.getSummary();
  if (!summary.total) {
    readout.textContent = '扩田 · 等待第一块粟田';
    return;
  }
  const secondField = farmSystem.get(SECOND_FIELD_ID);
  if (secondField) {
    readout.textContent = `扩田 · ${secondField.label} · ${secondField.seasonal.label} · 土壤 ${secondField.soil.fertility}`;
    return;
  }
  if (summary.expansionAvailable) {
    readout.textContent = '扩田 · 首次收获完成，正在选址';
    return;
  }
  readout.textContent = '扩田 · 第一块粟田首次收获后开放';
}

export function attachFarmExpansionRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime?.farmSystem || !eventBus) throw new Error('扩田模块启动失败：农田运行时尚未初始化。');
  if (runtime.farmExpansionRuntime) return runtime.farmExpansionRuntime;

  updatePhaseCopy();
  const readout = ensureReadout();
  renderReadout(readout, runtime.farmSystem);

  eventBus.on('farms:changed', ({ reason, field }) => {
    if (reason === 'field:harvested' && field?.id === 'first-millet-field') {
      const camp = runtime.campStore.get('starting-camp');
      const expansion = camp ? runtime.farmSystem.ensureExpansionField({ campAnchor: camp.anchor }) : null;
      if (expansion) {
        const status = document.querySelector('#system-status');
        if (status) status.textContent = '第一块粟田完成首次收获，村民开始规划第二块人工扩田。';
      }
    }
    renderReadout(readout, runtime.farmSystem);
    runtime.mapView.redraw();
  });

  const api = Object.freeze({ render: () => renderReadout(readout, runtime.farmSystem) });
  globalThis.shengling = Object.freeze({ ...runtime, farmExpansionRuntime: api });
  return api;
}
