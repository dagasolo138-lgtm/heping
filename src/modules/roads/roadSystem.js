export const ROAD_SCHEMA_VERSION = 1;

const TRAIL_THRESHOLD = 4;
const DIRT_ROAD_THRESHOLD = 10;

function clone(value) {
  return structuredClone(value);
}

function keyOf(x, y) {
  return `${x}:${y}`;
}

function stageFor(traffic) {
  if (traffic >= DIRT_ROAD_THRESHOLD) return 'dirtRoad';
  if (traffic >= TRAIL_THRESHOLD) return 'wornTrail';
  return 'none';
}

function traceTiles(from, to) {
  const start = { x: Math.round(from.x), y: Math.round(from.y) };
  const end = { x: Math.round(to.x), y: Math.round(to.y) };
  const tiles = [];
  let x = start.x;
  let y = start.y;
  const dx = Math.abs(end.x - start.x);
  const dy = Math.abs(end.y - start.y);
  const stepX = start.x < end.x ? 1 : -1;
  const stepY = start.y < end.y ? 1 : -1;
  let error = dx - dy;

  while (true) {
    tiles.push({ x, y });
    if (x === end.x && y === end.y) break;
    const doubleError = error * 2;
    if (doubleError > -dy) { error -= dy; x += stepX; }
    if (doubleError < dx) { error += dx; y += stepY; }
  }
  return tiles.slice(1);
}

export function createRoadSystem({ eventBus, gameTime }) {
  const cells = new Map();

  function listRoads() {
    return [...cells.values()]
      .filter((cell) => cell.stage !== 'none')
      .sort((first, second) => second.traffic - first.traffic)
      .map(clone);
  }

  function getSummary() {
    const visible = listRoads();
    return {
      trackedTiles: cells.size,
      wornTiles: visible.filter((cell) => cell.stage === 'wornTrail').length,
      dirtTiles: visible.filter((cell) => cell.stage === 'dirtRoad').length,
    };
  }

  function emit(reason, changed = []) {
    eventBus.emit('roads:changed', {
      reason,
      changed: changed.map(clone),
      roads: listRoads(),
      summary: getSummary(),
      time: gameTime.stamp(),
    });
  }

  function recordTraversal({ personId, from, to }) {
    if (!from || !to) return [];
    const changed = [];
    traceTiles(from, to).forEach((tile) => {
      const key = keyOf(tile.x, tile.y);
      const cell = cells.get(key) ?? {
        id: `road-${tile.x}-${tile.y}`,
        x: tile.x,
        y: tile.y,
        traffic: 0,
        stage: 'none',
        firstUsedAt: gameTime.stamp(),
        lastUsedAt: gameTime.stamp(),
        lastPersonId: null,
      };
      const beforeStage = cell.stage;
      cell.traffic += 1;
      cell.lastUsedAt = gameTime.stamp();
      cell.lastPersonId = personId ?? null;
      cell.stage = stageFor(cell.traffic);
      cells.set(key, cell);
      if (cell.stage !== beforeStage) changed.push(cell);
    });
    if (changed.length) emit('road:stage-changed', changed);
    return changed.map(clone);
  }

  function getMovementMultiplierAt(x, y) {
    const cell = cells.get(keyOf(Math.round(x), Math.round(y)));
    if (cell?.stage === 'dirtRoad') return 1.16;
    return 1;
  }

  function exportState() {
    return {
      schemaVersion: ROAD_SCHEMA_VERSION,
      exportedAt: gameTime.stamp(),
      cells: [...cells.values()].map(clone),
    };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== ROAD_SCHEMA_VERSION || !Array.isArray(snapshot.cells)) {
      throw new Error('道路存档格式不兼容。');
    }
    cells.clear();
    snapshot.cells.forEach((cell) => {
      const x = Math.round(Number(cell?.x));
      const y = Math.round(Number(cell?.y));
      if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('道路存档坐标无效。');
      const draft = { ...clone(cell), x, y, stage: stageFor(Number(cell.traffic ?? 0)) };
      cells.set(keyOf(x, y), draft);
    });
    emit('roads:hydrated', [...cells.values()]);
    return getSummary();
  }

  return Object.freeze({
    recordTraversal,
    listRoads,
    getSummary,
    getMovementMultiplierAt,
    exportState,
    importState,
  });
}
