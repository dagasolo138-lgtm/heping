const SEASON_LENGTH_DAYS = 90;
const WORLD_YEAR_DAYS = 360;

export const SEASON_DEFINITIONS = Object.freeze([
  {
    id: 'spring',
    label: '春季',
    startDay: 1,
    endDay: 90,
    temperatureModifier: 2,
    agriculture: {
      crops: {
        millet: { canSow: true, growthMultiplier: 1, waitingLabel: '可播种' },
      },
    },
  },
  {
    id: 'summer',
    label: '夏季',
    startDay: 91,
    endDay: 180,
    temperatureModifier: 7,
    agriculture: {
      crops: {
        millet: { canSow: false, growthMultiplier: 1.25, waitingLabel: '等待春播' },
      },
    },
  },
  {
    id: 'autumn',
    label: '秋季',
    startDay: 181,
    endDay: 270,
    temperatureModifier: -1,
    agriculture: {
      crops: {
        millet: { canSow: false, growthMultiplier: 0.62, waitingLabel: '等待春播' },
      },
    },
  },
  {
    id: 'winter',
    label: '冬季',
    startDay: 271,
    endDay: 360,
    temperatureModifier: -8,
    agriculture: {
      crops: {
        millet: { canSow: false, growthMultiplier: 0, waitingLabel: '等待春播' },
      },
    },
  },
]);

function clone(value) {
  return structuredClone(value);
}

function normalizeDay(day) {
  const value = Math.floor(Number(day) || 1);
  return ((value - 1) % WORLD_YEAR_DAYS + WORLD_YEAR_DAYS) % WORLD_YEAR_DAYS + 1;
}

function buildSeason(time) {
  const day = normalizeDay(time?.day);
  const definition = SEASON_DEFINITIONS.find((item) => day >= item.startDay && day <= item.endDay) ?? SEASON_DEFINITIONS[0];
  const dayInSeason = day - definition.startDay + 1;
  return {
    ...definition,
    day,
    dayInSeason,
    length: SEASON_LENGTH_DAYS,
    progress: dayInSeason / SEASON_LENGTH_DAYS,
  };
}

export function createSeasonSystem({ eventBus, gameTime }) {
  let current = buildSeason(gameTime.now());

  function get() {
    return clone(buildSeason(gameTime.now()));
  }

  function getCropRule(cropId) {
    const season = get();
    return clone(season.agriculture.crops[cropId] ?? { canSow: true, growthMultiplier: 1, waitingLabel: '可播种' });
  }

  function sync() {
    const next = buildSeason(gameTime.now());
    const changed = next.id !== current.id;
    const previous = current;
    current = next;
    if (changed) {
      eventBus.emit('seasons:changed', {
        previous: clone(previous),
        season: clone(current),
        time: gameTime.stamp(),
      });
    }
    return clone(current);
  }

  eventBus.on('simulation:time', sync);

  return Object.freeze({
    get,
    getCropRule,
    sync,
    list: () => clone(SEASON_DEFINITIONS),
  });
}
