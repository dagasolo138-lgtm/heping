function formatSpeed(value) {
  return `${Number(value)}×`;
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
  if (!runtime?.worldSpeedSystem || !eventBus) throw new Error('世界速度模块启动失败：速度系统尚未初始化。');
  if (runtime.worldSpeedRuntime) return runtime.worldSpeedRuntime;

  const buttons = [...document.querySelectorAll('[data-world-speed]')];
  const status = document.querySelector('#world-speed-status');
  const elements = { buttons, status };
  render(elements, runtime.worldSpeedSystem.get());

  buttons.forEach((button) => {
    button.addEventListener('click', () => {
      const speed = runtime.worldSpeedSystem.set(Number(button.dataset.worldSpeed), 'player');
      const systemStatus = document.querySelector('#system-status');
      if (systemStatus) systemStatus.textContent = `世界运行速度已调整为 ${speed.label}。`;
    });
  });

  eventBus.on('simulation:speed', ({ speed }) => render(elements, speed));

  const api = Object.freeze({
    get: () => runtime.worldSpeedSystem.get(),
    set: (value) => runtime.worldSpeedSystem.set(value, 'runtime'),
  });
  globalThis.shengling = Object.freeze({ ...runtime, worldSpeedRuntime: api });
  return api;
}
