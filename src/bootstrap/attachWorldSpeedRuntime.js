import { createWorldSpeedSystem } from '../modules/time/worldSpeedSystem.js';

const STYLESHEET_URL = new URL('../styles/worldSpeed.css', import.meta.url);

function ensureStylesheet() {
  let stylesheet = document.querySelector('link[data-shengling-world-speed]');
  if (stylesheet) return stylesheet;
  stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = STYLESHEET_URL.href;
  stylesheet.dataset.shenglingWorldSpeed = 'true';
  document.head.append(stylesheet);
  return stylesheet;
}

function updatePhaseCopy() {
  const eyebrow = document.querySelector('.eyebrow');
  const subtitle = document.querySelector('.subtitle');
  const note = document.querySelector('.phase-note');
  if (eyebrow) eyebrow.textContent = 'SHENGLING / FOUNDATION 16';
  if (subtitle) subtitle.textContent = '起始河谷 · 荒野手账与聚落观察器';
  if (note) note.innerHTML = '<strong>第十六阶段：</strong>界面整理为聚落观察器。地图成为主观察窗口，存档、倍速、天气与系统状态收进顶部手账栏；模拟规则保持不变。';
}

function render({ buttons, status }, speed) {
  buttons.forEach((button) => {
    const active = Number(button.dataset.worldSpeed) === speed.value;
    button.classList.toggle('is-active', active);
    button.setAttribute('aria-pressed', String(active));
  });
  if (status) status.textContent = `世界速度 ${speed.label}`;
}

export function attachWorldSpeedRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('世界速度模块启动失败：世界运行时尚未初始化。');
  if (runtime.worldSpeedRuntime) return runtime.worldSpeedRuntime;

  ensureStylesheet();
  updatePhaseCopy();
  const worldSpeedSystem = runtime.worldSpeedSystem ?? createWorldSpeedSystem({
    eventBus,
    gameTime: runtime.gameTime,
    initialSpeed: 1,
  });
  const buttons = [...document.querySelectorAll('[data-world-speed]')];
  const status = document.querySelector('#world-speed-status');
  const elements = { buttons, status };
  render(elements, worldSpeedSystem.get());

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const speed = worldSpeedSystem.set(Number(button.dataset.worldSpeed), 'player');
      const systemStatus = document.querySelector('#system-status');
      if (systemStatus) systemStatus.textContent = `世界运行速度已调整为 ${speed.label}。`;
    });
  });

  eventBus.on('simulation:speed', ({ speed }) => render(elements, speed));

  const api = Object.freeze({
    get: () => worldSpeedSystem.get(),
    set: (value) => worldSpeedSystem.set(value, 'runtime'),
  });
  globalThis.shengling = Object.freeze({ ...globalThis.shengling, worldSpeedSystem, worldSpeedRuntime: api });
  return api;
}
