function clone(value) {
  return structuredClone(value);
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function currentDate(gameTime) {
  const now = gameTime?.now?.() ?? gameTime?.stamp?.() ?? {};
  return {
    year: Number(now.year ?? 1),
    day: Number(now.day ?? 1),
  };
}

function normalizeDailyArgs(gameTime, yearOrDay, maybeDay) {
  const current = currentDate(gameTime);
  if (yearOrDay && typeof yearOrDay === 'object') {
    return {
      year: Number(yearOrDay.year ?? current.year),
      day: Number(yearOrDay.day ?? current.day),
    };
  }
  if (maybeDay !== undefined) {
    return {
      year: Number(yearOrDay ?? current.year),
      day: Number(maybeDay ?? current.day),
    };
  }
  return {
    year: current.year,
    day: Number(yearOrDay ?? current.day),
  };
}

function summarize(entries, pending) {
  const byItem = {};
  const byCategory = {};
  entries.forEach((entry) => {
    byItem[entry.itemId] = round((byItem[entry.itemId] ?? 0) + Number(entry.amount ?? 0));
    byCategory[entry.category] = round((byCategory[entry.category] ?? 0) + Number(entry.amount ?? 0));
  });
  return {
    totalEntries: entries.length,
    pending: Number(pending ?? 0),
    byItem,
    byCategory,
  };
}

export function createYearAwareResourceFlowView({ resourceFlowSystem, gameTime } = {}) {
  if (!resourceFlowSystem) throw new Error('跨年资源流水视图缺少底层流水系统。');

  function list(filter = {}) {
    const baseFilter = { ...filter };
    delete baseFilter.year;
    delete baseFilter.day;
    delete baseFilter.limit;
    delete baseFilter.skipFlush;

    let selected = resourceFlowSystem.list(baseFilter);
    if (filter.year !== undefined) {
      selected = selected.filter((entry) => Number(entry.time?.year ?? 1) === Number(filter.year));
    }
    if (filter.day !== undefined) {
      selected = selected.filter((entry) => Number(entry.time?.day ?? 1) === Number(filter.day));
    }
    if (filter.limit) selected = selected.slice(-Math.max(0, Number(filter.limit)));
    return selected.map(clone);
  }

  function getSummary(filter = {}) {
    const hasTemporalFilter = filter.year !== undefined || filter.day !== undefined || filter.limit !== undefined;
    if (filter.skipFlush && !hasTemporalFilter) return clone(resourceFlowSystem.getSummary(filter));
    const selected = list(filter);
    const pending = resourceFlowSystem.getSummary({ skipFlush: true }).pending;
    return summarize(selected, pending);
  }

  function getDailySummary(yearOrDay, maybeDay) {
    const target = normalizeDailyArgs(gameTime, yearOrDay, maybeDay);
    return getSummary(target);
  }

  return Object.freeze({
    ...resourceFlowSystem,
    list,
    getSummary,
    getDailySummary,
  });
}
