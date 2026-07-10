import { createUiRenderScheduler } from '../core/ui/uiRenderScheduler.js';
import { createRoadSystem } from '../modules/roads/roadSystem.js';
import { createRoadTickSampler } from '../modules/roads/roadTickSampler.js';

function ensureReadout() {
  let readout = document.querySelector('#road-readout');
  if (readout) return readout;
  const mapWrap = document.querySelector('.map-canvas-wrap');
  if (!mapWrap) return null;
  readout = document.createElement('div');
  readout.id = 'road-readout';
  readout.className = 'map-overlay map-overlay--road';
  mapWrap.append(readout);
  return readout;
}

function renderReadout(readout, roadSystem) {
  if (!readout) return;
  const summary = roadSystem.getSummary();
  if (!summary.wornTiles && !summary.dirtTiles) {
    readout.textContent = '路径形成 · 尚无明显踩踏痕迹';
    return;
  }
  readout.textContent = `路径形成 · 踩踏 ${summary.wornTiles} 格 · 土路 ${summary.dirtTiles} 格`;
}

export function attachRoadRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('路径模块启动失败：世界运行时尚未初始化。');
  if (runtime.roadSystem) return runtime.roadSystem;

  const roadSystem = createRoadSystem({ eventBus, gameTime: runtime.gameTime });
  const sampler = createRoadTickSampler({ roadSystem, getPeople: () => runtime.actionSystem.getRenderPeople() });
  const readout = ensureReadout();
  const ui = createUiRenderScheduler({
    maxFps: 10,
    render: () => {
      renderReadout(readout, roadSystem);
      runtime.mapView.redraw();
    },
  });

  renderReadout(readout, roadSystem);
  const stopTick = eventBus.on('simulation:tick', sampler.sample);
  eventBus.on('roads:changed', ({ changed }) => {
    ui.request('roads:changed');
    if (changed.some((road) => road.stage === 'dirtRoad')) {
      const status = document.querySelector('#system-status');
      if (status) status.textContent = '反复通行的路线被踩实，新的土路提高了村民的行走效率。';
    }
  });

  const system = Object.freeze({
    ...roadSystem,
    sampleTick: sampler.sample,
    resetSampler: sampler.reset,
    stop() {
      stopTick();
      ui.stop();
    },
  });
  globalThis.shengling = Object.freeze({ ...runtime, roadSystem: system });
  return system;
}
