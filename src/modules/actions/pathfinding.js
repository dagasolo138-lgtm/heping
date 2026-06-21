const CARDINAL_STEPS = Object.freeze([
  { x: 1, y: 0 }, { x: -1, y: 0 }, { x: 0, y: 1 }, { x: 0, y: -1 },
]);

function key(x, y) {
  return `${x}:${y}`;
}

function heuristic(x, y, targetX, targetY) {
  return Math.abs(targetX - x) + Math.abs(targetY - y);
}

function rebuildPath(cameFrom, currentKey) {
  const path = [];
  let cursor = currentKey;
  while (cameFrom.has(cursor)) {
    const [x, y] = cursor.split(':').map(Number);
    path.unshift({ x, y });
    cursor = cameFrom.get(cursor);
  }
  return path;
}

export function findPath({ start, goal, isWalkable, maxNodes = 8500 }) {
  const startX = Math.round(start.x);
  const startY = Math.round(start.y);
  const goalX = Math.round(goal.x);
  const goalY = Math.round(goal.y);
  if (startX === goalX && startY === goalY) return [];
  if (!isWalkable(goalX, goalY)) return null;

  const startKey = key(startX, startY);
  const open = [{ x: startX, y: startY, f: heuristic(startX, startY, goalX, goalY) }];
  const cameFrom = new Map();
  const gScore = new Map([[startKey, 0]]);
  const closed = new Set();
  let visited = 0;

  while (open.length && visited < maxNodes) {
    open.sort((first, second) => first.f - second.f);
    const current = open.shift();
    const currentKey = key(current.x, current.y);
    if (closed.has(currentKey)) continue;
    closed.add(currentKey);
    visited += 1;

    if (current.x === goalX && current.y === goalY) return rebuildPath(cameFrom, currentKey);

    CARDINAL_STEPS.forEach((step) => {
      const nextX = current.x + step.x;
      const nextY = current.y + step.y;
      const nextKey = key(nextX, nextY);
      if (closed.has(nextKey)) return;
      if (!isWalkable(nextX, nextY)) return;
      const tentativeG = gScore.get(currentKey) + 1;
      if (tentativeG >= (gScore.get(nextKey) ?? Infinity)) return;
      cameFrom.set(nextKey, currentKey);
      gScore.set(nextKey, tentativeG);
      open.push({ x: nextX, y: nextY, f: tentativeG + heuristic(nextX, nextY, goalX, goalY) });
    });
  }

  return null;
}
