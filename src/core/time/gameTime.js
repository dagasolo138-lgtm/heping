export function createGameTime({ year = 1, day = 1, tick = 0 } = {}) {
  let state = { year, day, tick };

  function now() {
    return { ...state };
  }

  function advance(days = 1) {
    const totalDays = state.day - 1 + days;
    state = {
      year: state.year + Math.floor(totalDays / 360),
      day: (totalDays % 360) + 1,
      tick: state.tick + days,
    };
    return now();
  }

  function stamp() {
    return { ...now(), label: `生灵历 ${state.year} 年第 ${state.day} 日` };
  }

  return { now, advance, stamp };
}
