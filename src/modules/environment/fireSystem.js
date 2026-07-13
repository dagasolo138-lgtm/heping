export const FIRE_SCHEMA_VERSION = 1;

function clone(value) {
  return structuredClone(value);
}

function burnRate(weather) {
  if (weather?.seasonId === 'winter' && weather?.isRain) return 1 / 85;
  if (weather?.seasonId === 'winter' && Number(weather?.temperature ?? 99) <= 0) return 1 / 105;
  if (weather?.isRain) return 1 / 115;
  if (Number(weather?.temperature ?? 99) <= 8) return 1 / 140;
  return 1 / 190;
}

function distance(first, second) {
  return Math.hypot(Number(first.x) - Number(second.x), Number(first.y) - Number(second.y));
}

export function createFireSystem({ eventBus, gameTime, mapSystem }) {
  const map = mapSystem.get();
  const feature = map?.features.find((item) => item.kind === 'campfire');
  const position = feature ? { x: feature.x, y: feature.y } : { ...map.spawnPoint };
  const headless = eventBus?.getDiagnostics?.().mode === 'headless';
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
  let cachedView = null;
  let viewHits = 0;

  function invalidate() {
    cachedView = null;
  }

  function buildView() {
    return {
      ...state,
      position: headless ? state.position : clone(state.position),
      fuel: Math.round(state.fuel * 100) / 100,
    };
  }

  function get() {
    if (!headless) return clone(buildView());
    if (cachedView) {
      viewHits += 1;
      return cachedView;
    }
    cachedView = Object.freeze(buildView());
    return cachedView;
  }

  function emit(reason) {
    eventBus.emit('environment:fire', { reason, fire: get(), time: gameTime.stamp() });
  }

  function sync({ weather, phase }) {
    const nowTick = Number(gameTime.now().tick ?? 0);
    const elapsedMinutes = Math.max(0, nowTick - state.lastTick);
    if (state.lastTick !== nowTick) {
      state.lastTick = nowTick;
      invalidate();
    }
    if (!elapsedMinutes || !state.lit) return get();

    const shouldBurn = Boolean(phase?.isNight || weather?.requiresFire);
    if (!shouldBurn) return get();
    const rate = burnRate(weather);
    const before = state.fuel;
    state.fuel = Math.max(0, state.fuel - elapsedMinutes * rate);
    state.lit = state.fuel > 0.01;
    invalidate();
    if (Math.abs(before - state.fuel) >= 0.05 || !state.lit) emit(state.lit ? 'fuel:burned' : 'fire:extinguished');
    return get();
  }

  function addFuel(amount) {
    const accepted = Math.min(Math.max(0, Number(amount ?? 0)), state.maxFuel - state.fuel);
    if (!accepted) return 0;
    state.fuel += accepted;
    state.lit = state.fuel > 0.01;
    invalidate();
    emit('fuel:added');
    return accepted;
  }

  function needsFuel(threshold = 1.4) {
    return state.fuel <= threshold;
  }

  function isWarmAt(point) {
    return state.lit && distance(point, state.position) <= state.warmthRadius;
  }

  function exportState() {
    return {
      schemaVersion: FIRE_SCHEMA_VERSION,
      exportedAt: { ...gameTime.stamp() },
      state: clone(get()),
    };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== FIRE_SCHEMA_VERSION || !snapshot.state) {
      throw new Error('篝火存档格式不兼容。');
    }
    state = {
      ...state,
      ...clone(snapshot.state),
      position: clone(snapshot.state.position ?? state.position),
      fuel: Math.max(0, Number(snapshot.state.fuel ?? state.fuel)),
      maxFuel: Math.max(0, Number(snapshot.state.maxFuel ?? state.maxFuel)),
      warmthRadius: Math.max(0, Number(snapshot.state.warmthRadius ?? state.warmthRadius)),
      lastTick: Math.max(0, Number(snapshot.state.lastTick ?? gameTime.now().tick ?? 0)),
      lit: Boolean(snapshot.state.lit),
    };
    invalidate();
    emit('fire:hydrated');
    return get();
  }

  function getDiagnostics() {
    return { mode: headless ? 'headless' : 'safe', viewHits, cached: Boolean(cachedView) };
  }

  return Object.freeze({ get, sync, addFuel, needsFuel, isWarmAt, exportState, importState, getDiagnostics });
}
