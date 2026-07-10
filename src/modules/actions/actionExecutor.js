import { findPath } from './pathfinding.js';
import { buildLaborCostProfile, movementLaborMultiplier } from './laborCostModel.js';

function distance(first, second) {
  return Math.hypot(second.x - first.x, second.y - first.y);
}

function runtimeContext(personId) {
  const runtime = globalThis.shengling ?? {};
  return {
    peopleSystem: runtime.peopleSystem ?? null,
    person: runtime.peopleSystem?.getRuntime?.(personId) ?? runtime.peopleSystem?.get?.(personId) ?? null,
    roadSystem: runtime.roadSystem ?? null,
    weather: runtime.weatherSystem?.get?.() ?? null,
  };
}

function settleLaborEnergy(agent, task, deltaSeconds, phase, { force = false } = {}) {
  const profile = task?.data?.laborCost;
  if (!profile) return 0;
  const rate = phase === 'moving'
    ? Number(profile.movementExtraEnergyRate ?? 0)
    : Number(profile.workExtraEnergyRate ?? 0);
  task.laborEnergyPending = Number(task.laborEnergyPending ?? 0) + Math.max(0, rate) * Math.max(0, deltaSeconds);
  if (!force && task.laborEnergyPending < 0.05) return 0;
  const amount = task.laborEnergyPending;
  task.laborEnergyPending = 0;
  const { peopleSystem, person } = runtimeContext(agent.personId);
  if (!peopleSystem || !person?.identity?.alive || amount <= 0) return 0;
  peopleSystem.patchState(agent.personId, { energy: Math.max(0, Number(person.state.energy ?? 0) - amount) });
  task.laborEnergySpent = Number(task.laborEnergySpent ?? 0) + amount;
  return amount;
}

export function createRuntimeTask(task, position, mapSystem) {
  const route = findPath({ start: position, goal: task.destination, isWalkable: mapSystem.isWalkable });
  if (route === null) return null;
  const context = runtimeContext(position.personId);
  const laborCost = buildLaborCostProfile({
    person: context.person,
    task,
    position,
    route,
    mapSystem,
    roadSystem: context.roadSystem,
    weather: context.weather,
  });
  const workDuration = laborCost?.effectiveWorkDuration ?? Number(task.workDuration ?? 0);
  return {
    ...structuredClone(task),
    workDuration,
    data: {
      ...(structuredClone(task.data ?? {})),
      ...(laborCost ? { laborCost: structuredClone(laborCost) } : {}),
    },
    phase: route.length ? 'moving' : 'working',
    route,
    routeIndex: 0,
    workElapsed: 0,
    laborEnergyPending: 0,
    laborEnergySpent: 0,
  };
}

export function advanceRuntimeTask(agent, deltaSeconds, speedTilesPerSecond) {
  const task = agent.task;
  if (!task) return null;

  if (task.phase === 'moving') {
    const context = runtimeContext(agent.personId);
    const laborMultiplier = movementLaborMultiplier({
      person: context.person,
      task,
      agent,
      mapSystem: globalThis.shengling?.mapSystem ?? null,
      roadSystem: context.roadSystem,
    });
    let remaining = Math.max(0, deltaSeconds * speedTilesPerSecond * laborMultiplier);
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
    settleLaborEnergy(agent, task, deltaSeconds, 'moving');
    if (task.routeIndex >= task.route.length) {
      task.phase = 'working';
      return { kind: 'arrived', task };
    }
    return { kind: 'moving', task };
  }

  if (task.phase === 'working') {
    task.workElapsed += deltaSeconds;
    settleLaborEnergy(agent, task, deltaSeconds, 'working');
    if (task.workElapsed >= task.workDuration) {
      settleLaborEnergy(agent, task, 0, 'working', { force: true });
      return { kind: 'completed', task };
    }
    return { kind: 'working', task };
  }

  return null;
}
