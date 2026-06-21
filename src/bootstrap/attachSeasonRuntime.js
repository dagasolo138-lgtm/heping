import { createSeasonSystem } from '../modules/seasons/seasonSystem.js';

function ensureReadout() {
  let readout = document.querySelector('#season-readout');
  if (readout) return readout;
  const mapWrap = document.querySelector('.map-canvas-wrap');
  if (!mapWrap) return null;
  readout = document.createElement('div');
  readout.id = 'season-readout';
  readout.className = 'map-overlay map-overlay--season';
  mapWrap.append(readout);
  return readout;
}

function formatTemperature(value) {
  return `${value >= 0 ? '+' : ''}${value}℃`;
}

function renderReadout(readout, seasonSystem) {
  if (!readout) return;
  const season = seasonSystem.get();
  readout.textContent = `季节：${season.label} · 第 ${season.dayInSeason} / ${season.length} 日 · 温度趋势 ${formatTemperature(season.temperatureModifier)}`;
}

export function attachSeasonRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('季节模块启动失败：世界运行时尚未初始化。');
  if (runtime.seasonSystem) return runtime.seasonSystem;

  const seasonSystem = createSeasonSystem({ eventBus, gameTime: runtime.gameTime });
  runtime.weatherSystem.setSeasonSystem?.(seasonSystem);
  const readout = ensureReadout();
  renderReadout(readout, seasonSystem);

  eventBus.on('simulation:time', () => renderReadout(readout, seasonSystem));
  eventBus.on('seasons:changed', ({ season }) => {
    renderReadout(readout, seasonSystem);
    const status = document.querySelector('#system-status');
    if (status) status.textContent = `${season.label}到来，温度趋势 ${formatTemperature(season.temperatureModifier)}。`;
    runtime.mapView.redraw();
  });

  globalThis.shengling = Object.freeze({ ...runtime, seasonSystem });
  return seasonSystem;
}
