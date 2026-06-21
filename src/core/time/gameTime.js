function pad(value) {
  return String(value).padStart(2, '0');
}

export function createGameTime({ year = 1, day = 1, minute = 480, tick = 0 } = {}) {
  let state = { year, day, minute, tick };

  function now() {
    return { ...state };
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
    return now();
  }

  function advance(days = 1) {
    return advanceMinutes(days * 1440);
  }

  function timeOfDay() {
    const hour = Math.floor(state.minute / 60);
    const minute = state.minute % 60;
    return {
      hour,
      minute,
      isNight: hour < 6 || hour >= 20,
      label: `${pad(hour)}:${pad(minute)}`,
    };
  }

  function stamp() {
    const clock = timeOfDay();
    return { ...now(), ...clock, label: `生灵历 ${state.year} 年第 ${state.day} 日 ${clock.label}` };
  }

  return { now, advance, advanceMinutes, timeOfDay, stamp };
}
