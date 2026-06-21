const RESOURCE_RENEWAL = Object.freeze({
  tree: {
    label: '树木',
    regrowMinutes: 3 * 1440,
    markerKind: 'treeStump',
    markerLabel: '树桩',
  },
  berryBush: {
    label: '浆果丛',
    regrowMinutes: 1440,
    markerKind: 'berryPatch',
    markerLabel: '浆果灌丛',
  },
});

function clone(value) {
  return structuredClone(value);
}

function isInsideBuilding(point, building) {
  return point.x >= building.anchor.x
    && point.x < building.anchor.x + building.footprint.width
    && point.y >= building.anchor.y
    && point.y < building.anchor.y + building.footprint.height;
}

function summary(entries) {
  const byKind = { tree: 0, berryBush: 0 };
  entries.forEach((entry) => { byKind[entry.kind] = (byKind[entry.kind] ?? 0) + 1; });
  return { total: entries.length, byKind };
}

export function createResourceRenewalSystem({ eventBus, gameTime, mapSystem, buildingSystem }) {
  const entries = new Map();

  function list() {
    return [...entries.values()].sort((first, second) => first.regrowAtTick - second.regrowAtTick).map(clone);
  }

  function getSummary() {
    return summary([...entries.values()]);
  }

  function emit(reason, entry = null) {
    eventBus.emit('ecology:changed', {
      reason,
      entry: entry ? clone(entry) : null,
      pending: list(),
      summary: getSummary(),
      time: gameTime.stamp(),
    });
  }

  function registerDepletion(feature) {
    const config = RESOURCE_RENEWAL[feature?.kind];
    if (!config || entries.has(feature.id)) return null;
    const now = gameTime.now();
    const entry = {
      id: feature.id,
      kind: feature.kind,
      label: config.label,
      x: feature.x,
      y: feature.y,
      source: clone(feature),
      markerId: `${feature.id}--regrowth`,
      markerKind: config.markerKind,
      markerLabel: config.markerLabel,
      depletedAt: gameTime.stamp(),
      regrowAtTick: Number(now.tick) + config.regrowMinutes,
      delayedCount: 0,
    };
    entries.set(entry.id, entry);
    mapSystem.addFeature({
      id: entry.markerId,
      kind: entry.markerKind,
      x: entry.x,
      y: entry.y,
      blocking: false,
      persistent: false,
      ecology: { resourceId: entry.id, sourceKind: entry.kind, regrowAtTick: entry.regrowAtTick },
    });
    emit('resource:depleted', entry);
    return clone(entry);
  }

  function locationBlocked(entry) {
    const occupied = mapSystem.getFeaturesAt(entry.x, entry.y)
      .some((feature) => feature.id !== entry.markerId);
    if (occupied) return true;
    return buildingSystem.list().some((building) => isInsideBuilding(entry, building));
  }

  function restore(entry) {
    mapSystem.removeFeature(entry.markerId);
    mapSystem.addFeature({
      ...clone(entry.source),
      id: entry.id,
      blocking: entry.kind === 'tree',
      persistent: false,
      ecology: { regrownAt: gameTime.stamp(), generation: Number(entry.source.ecology?.generation ?? 0) + 1 },
    });
    entries.delete(entry.id);
    eventBus.emit('ecology:regrown', { entry: clone(entry), time: gameTime.stamp() });
    emit('resource:regrown', entry);
  }

  function sync() {
    const nowTick = Number(gameTime.now().tick ?? 0);
    const due = [...entries.values()].filter((entry) => entry.regrowAtTick <= nowTick);
    due.forEach((entry) => {
      if (locationBlocked(entry)) {
        entry.regrowAtTick = nowTick + 1440;
        entry.delayedCount += 1;
        emit('resource:delayed', entry);
        return;
      }
      restore(entry);
    });
    return getSummary();
  }

  eventBus.on('map:feature-removed', ({ feature }) => { registerDepletion(feature); });
  eventBus.on('simulation:time', () => { sync(); });

  return Object.freeze({ registerDepletion, sync, list, getSummary });
}
