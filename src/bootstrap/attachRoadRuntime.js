import { createUiRenderScheduler } from '../core/ui/uiRenderScheduler.js';
import { createRoadSystem } from '../modules/roads/roadSystem.js';

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

function tileOf(person) {
  return { x: Math.round(person.location.tileX), y: Math.round(person.location.tileY) };
}

function sameTile(first, second) {
  return first?.x === second?.x && first?.y === second?.y;
}

export function attachRoadRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('路径模块启动失败：世界运行时尚未初始化。');
  if (runtime.roadSystem) return runtime.roadSystem;

  const roadSystem = createRoadSystem({ eventBus, gameTime: runtime.gameTime });
  const lastTiles = new Map();
  const readout = ensureReadout();
  const ui = createUiRenderScheduler({
    maxFps: 10,
    render: () => {
      renderReadout(readout, roadSystem);
      runtime.mapView.redraw();
    },
  });

  function sampleTick() {
    runtime.actionSystem.getRenderPeople().forEach((person) => {
      if (person.location.tileX === null || person.location.tileY === null) return;
      const current = tileOf(person);
      const previous = lastTiles.get(person.id);
      if (previous && person.activity?.status === 'moving' && !sameTile(previous, current)) {
        roadSystem.recordTraversal({ personId: person.id, from: previous, to: current });
      }
      lastTiles.set(person.id, current);
    });
  }

  renderReadout(readout, roadSystem);
  const stopTick = eventBus.on('simulation:tick', sampleTick);
  eventBus.on('roads:changed', ({ changed }) => {
    ui.request('roads:changed');
    if (changed.some((road) => road.stage === 'dirtRoad')) {
      const status = document.querySelector('#system-status');
      if (status) status.textContent = '反复通行的路线被踩实，新的土路提高了村民的行走效率。';
    }
  });

  const system = Object.freeze({
    ...roadSystem,
    sampleTick,
    stop() {
      stopTick();
      ui.stop();
    },
  });
  globalThis.shengling = Object.freeze({ ...runtime, roadSystem: system });
  return system;
}
