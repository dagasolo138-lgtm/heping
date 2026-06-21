function clone(value) {
  return structuredClone(value);
}

function distance(first, second) {
  return Math.hypot(Number(first.x) - Number(second.x), Number(first.y) - Number(second.y));
}

export function createFireSystem({ eventBus, gameTime, mapSystem }) {
  const map = mapSystem.get();
  const feature = map?.features.find((item) => item.kind === 'campfire');
  const position = feature ? { x: feature.x, y: feature.y } : { ...map.spawnPoint };
  let state = {
    id: feature?.id ?? 'starting-campfire',
    featureId: feature?.id ?? null,
    position,
    fuel: 4,
    maxFuel: 8,
    lit: true,
    warmthRadius: 7,
    lastTick: Number(gameTime.now().tick ?? 0),
  };

  function get() {
    return clone({ ...state, fuel: Math.round(state.fuel * 100) / 100 });
  }

  function emit(reason) {
    eventBus.emit('environment:fire', { reason, fire: get(), time: gameTime.stamp() });
  }

  function sync({ weather, phase }) {
    const nowTick = Number(gameTime.now().tick ?? 0);
    const elapsedMinutes = Math.max(0, nowTick - state.lastTick);
    state.lastTick = nowTick;
    if (!elapsedMinutes || !state.lit) return get();

    const shouldBurn = Boolean(phase?.isNight || weather?.requiresFire);
    if (!shouldBurn) return get();
    const rate = weather?.isRain ? 1 / 115 : weather?.temperature <= 8 ? 1 / 150 : 1 / 190;
    const before = state.fuel;
    state.fuel = Math.max(0, state.fuel - elapsedMinutes * rate);
    state.lit = state.fuel > 0.01;
    if (Math.abs(before - state.fuel) >= 0.05 || !state.lit) emit(state.lit ? 'fuel:burned' : 'fire:extinguished');
    return get();
  }

  function addFuel(amount) {
    const accepted = Math.min(Math.max(0, Number(amount ?? 0)), state.maxFuel - state.fuel);
    if (!accepted) return 0;
    state.fuel += accepted;
    state.lit = state.fuel > 0.01;
    emit('fuel:added');
    return accepted;
  }

  function needsFuel(threshold = 1.4) {
    return state.fuel <= threshold;
  }

  function isWarmAt(point) {
    return state.lit && distance(point, state.position) <= state.warmthRadius;
  }

  return Object.freeze({ get, sync, addFuel, needsFuel, isWarmAt });
}
