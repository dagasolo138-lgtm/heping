import { findPath } from './pathfinding.js';

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function roadMultiplierAt(agent) {
  const roadSystem = globalThis.shengling?.roadSystem;
  return Math.max(1, Number(roadSystem?.getMovementMultiplierAt?.(agent.x, agent.y) ?? 1));
}

export function createRuntimeTask(task, position, mapSystem) {
  const route = findPath({ start: position, goal: task.destination, isWalkable: mapSystem.isWalkable });
  if (route === null) return null;
  return {
    ...structuredClone(task),
    phase: route.length ? 'moving' : 'working',
    route,
    routeIndex: 0,
    workElapsed: 0,
  };
}

export function advanceRuntimeTask(agent, deltaSeconds, speedTilesPerSecond) {
  const task = agent.task;
  if (!task) return null;

  if (task.phase === 'moving') {
    let remaining = Math.max(0, deltaSeconds * speedTilesPerSecond * roadMultiplierAt(agent));
    while (remaining > 0 && task.routeIndex < task.route.length) {
      const target = task.route[task.routeIndex];
      const gap = distance(agent, target);
      if (gap <= remaining || gap < 0.001) {
        agent.x = target.x;
        agent.y = target.y;
        remaining -= gap;
        task.routeIndex += 1;
      } else {
        const ratio = remaining / gap;
        agent.x += (target.x - agent.x) * ratio;
        agent.y += (target.y - agent.y) * ratio;
        remaining = 0;
      }
    }
    if (task.routeIndex >= task.route.length) {
      task.phase = 'working';
      return { kind: 'arrived', task };
    }
    return { kind: 'moving', task };
  }

  if (task.phase === 'working') {
    task.workElapsed += deltaSeconds;
    if (task.workElapsed >= task.workDuration) return { kind: 'completed', task };
    return { kind: 'working', task };
  }

  return null;
}
