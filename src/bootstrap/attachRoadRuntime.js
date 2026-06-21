import { createRoadSystem } from '../modules/roads/roadSystem.js';

const SAMPLE_INTERVAL_MS = 240;

function updatePhaseCopy() {
  const eyebrow = document.querySelector('.eyebrow');
  const subtitle = document.querySelector('.subtitle');
  const note = document.querySelector('.phase-note');
  if (eyebrow) eyebrow.textContent = 'SHENGLING / FOUNDATION 09';
  if (subtitle) subtitle.textContent = '起始河谷 · 生存、建造与聚落路径原型';
  if (note) note.innerHTML = '<strong>第九阶段：</strong>村民反复走过同一片土地，会留下踩踏痕迹；痕迹累积后形成土路。成型土路让行走速度提高 16%。';
}

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
  return {
    x: Math.round(person.location.tileX),
    y: Math.round(person.location.tileY),
  };
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
  let frameId = null;
  let lastSample = 0;

  function sample(now) {
    frameId = requestAnimationFrame(sample);
    if (now - lastSample < SAMPLE_INTERVAL_MS) return;
    lastSample = now;
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

  updatePhaseCopy();
  renderReadout(readout, roadSystem);
  eventBus.on('roads:changed', ({ changed }) => {
    renderReadout(readout, roadSystem);
    runtime.mapView.redraw();
    if (changed.some((road) => road.stage === 'dirtRoad')) {
      const status = document.querySelector('#system-status');
      if (status) status.textContent = '反复通行的路线被踩实，新的土路提高了村民的行走效率。';
    }
  });

  frameId = requestAnimationFrame(sample);
  const system = Object.freeze({
    ...roadSystem,
    stop() { if (frameId) cancelAnimationFrame(frameId); frameId = null; },
  });
  globalThis.shengling = Object.freeze({ ...runtime, roadSystem: system });
  return system;
}
