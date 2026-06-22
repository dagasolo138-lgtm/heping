export const WORLD_SPEED_OPTIONS = Object.freeze([0.5, 1, 2, 5, 10]);

function normalizeSpeed(value) {
  const numeric = Number(value);
  return WORLD_SPEED_OPTIONS.find((option) => option === numeric) ?? null;
}

function speedView(value) {
  return Object.freeze({
    value,
    label: `${value}×`,
    worldMinutesPerRealSecond: 6 * value,
  });
}

export function createWorldSpeedSystem({ eventBus, gameTime, initialSpeed = 1 } = {}) {
  let currentSpeed = normalizeSpeed(initialSpeed) ?? 1;

  function get() {
    return speedView(currentSpeed);
  }

  function set(nextSpeed, reason = 'user') {
    const next = normalizeSpeed(nextSpeed);
    if (next === null) throw new Error(`不支持的世界速度：${nextSpeed}`);
    if (next === currentSpeed) return get();

    const previous = currentSpeed;
    currentSpeed = next;
    const speed = get();
    eventBus?.emit('simulation:speed', {
      speed,
      previous: speedView(previous),
      reason,
      time: gameTime?.stamp?.() ?? null,
    });
    return speed;
  }

  return Object.freeze({
    get,
    set,
    options: () => WORLD_SPEED_OPTIONS,
    isSupported: (value) => normalizeSpeed(value) !== null,
  });
}
