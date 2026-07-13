function pad(value) {
  return String(value).padStart(2, '0');
}

export function createGameTime({
  year = 1,
  day = 1,
  minute = 480,
  tick = 0,
  runtimeMode = globalThis.__shenglingEventBus?.getDiagnostics?.().mode ?? 'safe',
} = {}) {
  let state = { year, day, minute, tick };
  const headless = runtimeMode === 'headless';
  let cachedNow = null;
  let cachedStamp = null;
  let nowHits = 0;
  let stampHits = 0;

  function invalidate() {
    cachedNow = null;
    cachedStamp = null;
  }

  function now() {
    if (!headless) return { ...state };
    if (cachedNow) {
      nowHits += 1;
      return cachedNow;
    }
    cachedNow = Object.freeze({ ...state });
    return cachedNow;
  }

  function advanceMinutes(amount = 1) {
    const minutes = Math.max(0, Math.floor(amount));
    const totalMinutes = state.minute + minutes;
    const addedDays = Math.floor(totalMinutes / 1440);
    const dayIndex = state.day - 1 + addedDays;
    state = {
      year: state.year + Math.floor(dayIndex / 360),
      day: (dayIndex % 360) + 1,
      minute: totalMinutes % 1440,
      tick: state.tick + minutes,
    };
    invalidate();
    return now();
  }

  function advance(days = 1) {
    return advanceMinutes(days * 1440);
  }

  function timeOfDay() {
    const hour = Math.floor(state.minute / 60);
    const minuteValue = state.minute % 60;
    return {
      hour,
      minute: minuteValue,
      isNight: hour < 6 || hour >= 20,
      label: `${pad(hour)}:${pad(minuteValue)}`,
    };
  }

  function stamp() {
    if (headless && cachedStamp) {
      stampHits += 1;
      return cachedStamp;
    }
    const clock = timeOfDay();
    const value = { ...now(), ...clock, label: `生灵历 ${state.year} 年第 ${state.day} 日 ${clock.label}` };
    if (!headless) return value;
    cachedStamp = Object.freeze(value);
    return cachedStamp;
  }

  function exportState() {
    return { schemaVersion: 1, state: { ...state }, exportedAt: { ...stamp() } };
  }

  function importState(snapshot) {
    const next = snapshot?.state ?? snapshot;
    const yearValue = Number(next?.year);
    const dayValue = Number(next?.day);
    const minuteValue = Number(next?.minute);
    const tickValue = Number(next?.tick);
    if (![yearValue, dayValue, minuteValue, tickValue].every(Number.isFinite)) {
      throw new Error('时间存档格式不兼容。');
    }
    state = {
      year: Math.max(1, Math.floor(yearValue)),
      day: Math.min(360, Math.max(1, Math.floor(dayValue))),
      minute: Math.min(1439, Math.max(0, Math.floor(minuteValue))),
      tick: Math.max(0, Math.floor(tickValue)),
    };
    invalidate();
    return now();
  }

  function getDiagnostics() {
    return {
      mode: headless ? 'headless' : 'safe',
      nowHits,
      stampHits,
      cachedNow: Boolean(cachedNow),
      cachedStamp: Boolean(cachedStamp),
    };
  }

  return { now, advance, advanceMinutes, timeOfDay, stamp, exportState, importState, getDiagnostics };
}
