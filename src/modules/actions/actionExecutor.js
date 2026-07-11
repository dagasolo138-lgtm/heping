import { findPath } from './pathfinding.js';
import { buildLaborCostProfile, movementLaborMultiplier } from './laborCostModel.js';
import { ACTION_TYPES } from './actionTypes.js';

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

function eventTime() {
  return globalThis.shengling?.gameTime?.stamp?.() ?? null;
}

function emitActionEvent(eventName, payload) {
  globalThis.__shenglingEventBus?.emit?.(eventName, {
    ...structuredClone(payload),
    time: structuredClone(payload.time ?? eventTime()),
  });
}

function isDeliveryStage(task) {
  return task?.type === ACTION_TYPES.DELIVER_MATERIALS && task?.data?.stage === 'deliver';
}

function accumulateLaborEnergy(task, deltaSeconds, phase) {
  const profile = task?.data?.laborCost;
  if (!profile) return 0;
  const rate = phase === 'moving'
    ? Number(profile.movementExtraEnergyRate ?? 0)
    : Number(profile.workExtraEnergyRate ?? 0);
  const amount = Math.max(0, rate) * Math.max(0, deltaSeconds);
  task.laborEnergyPending = Number(task.laborEnergyPending ?? 0) + amount;
  return amount;
}

function settleLaborEnergy(agent, task) {
  const amount = Math.max(0, Number(task?.laborEnergyPending ?? 0));
  task.laborEnergyPending = 0;
  const { peopleSystem, person } = runtimeContext(agent.personId);
  if (!peopleSystem || !person?.identity?.alive || amount <= 0) return 0;
  peopleSystem.patchState(agent.personId, { energy: Math.max(0, Number(person.state.energy ?? 0) - amount) });
  task.laborEnergySpent = Number(task.laborEnergySpent ?? 0) + amount;
  return amount;
}

export function createRuntimeTask(task, position, mapSystem) {
  const route = findPath({ start: position, goal: task.destination, isWalkable: mapSystem.isWalkable });
  if (route === null) {
    if (isDeliveryStage(task)) {
      emitActionEvent('actions:failed', {
        personId: position.personId ?? null,
        taskId: task.id,
        task,
        reason: 'delivery-route-blocked',
        details: {
          stage: task.data?.stage ?? 'deliver',
          destination: task.destination ?? null,
        },
      });
    }
    return null;
  }
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
  const runtimeTask = {
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

  if (isDeliveryStage(runtimeTask)) {
    emitActionEvent('actions:stage-transition', {
      personId: position.personId ?? null,
      taskId: runtimeTask.id,
      task: runtimeTask,
      fromStage: runtimeTask.data?.previousStage ?? 'collect',
      toStage: runtimeTask.data?.stage ?? 'deliver',
      reason: 'construction-material-collected',
    });
  }
  return runtimeTask;
}

export function advanceRuntimeTask(agent, deltaSeconds, speedTilesPerSecond) {
  const task = agent.task;
  if (!task) return null;

  if (task.phase === 'moving') {
    const runtime = globalThis.shengling ?? {};
    const laborMultiplier = movementLaborMultiplier({
      task,
      agent,
      mapSystem: runtime.mapSystem ?? null,
      roadSystem: runtime.roadSystem ?? null,
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
    accumulateLaborEnergy(task, deltaSeconds, 'moving');
    if (task.routeIndex >= task.route.length) {
      task.phase = 'working';
      return { kind: 'arrived', task };
    }
    return { kind: 'moving', task };
  }

  if (task.phase === 'working') {
    task.workElapsed += deltaSeconds;
    accumulateLaborEnergy(task, deltaSeconds, 'working');
    if (task.workElapsed >= task.workDuration) {
      settleLaborEnergy(agent, task);
      return { kind: 'completed', task };
    }
    return { kind: 'working', task };
  }

  return null;
}
