const MINUTES_PER_DAY = 1440;
const DAWN_START = 5 * 60;
const DAY_START = 7 * 60;
const DUSK_START = 17 * 60;
const NIGHT_START = 20 * 60;

export const DAY_PHASES = Object.freeze({
  dawn: { id: 'dawn', label: '黎明', isNight: false, lightOpacity: 0.12 },
  day: { id: 'day', label: '白昼', isNight: false, lightOpacity: 0 },
  dusk: { id: 'dusk', label: '黄昏', isNight: false, lightOpacity: 0.2 },
  night: { id: 'night', label: '夜晚', isNight: true, lightOpacity: 0.5 },
});

function minuteOfDay(time) {
  return ((Number(time?.minute ?? 0) % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
}

export function getDayPhase(time) {
  const minute = minuteOfDay(time);
  if (minute >= DAY_START && minute < DUSK_START) return DAY_PHASES.day;
  if (minute >= DUSK_START && minute < NIGHT_START) return DAY_PHASES.dusk;
  if (minute >= DAWN_START && minute < DAY_START) return DAY_PHASES.dawn;
  return DAY_PHASES.night;
}

export function minutesUntilDawn(time) {
  const minute = minuteOfDay(time);
  if (minute >= DAWN_START && minute < NIGHT_START) return 0;
  return minute < DAWN_START ? DAWN_START - minute : MINUTES_PER_DAY - minute + DAWN_START;
}

export function nightKey(time) {
  const minute = minuteOfDay(time);
  const year = Number(time?.year ?? 1);
  const day = Number(time?.day ?? 1) - (minute < DAWN_START ? 1 : 0);
  return `${year}:${day}`;
}
