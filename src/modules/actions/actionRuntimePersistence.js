import { ACTION_TYPES } from './actionTypes.js';

export const ACTION_RUNTIME_SCHEMA_VERSION = 1;
export const ACTION_RUNTIME_LOAD_POLICY = 'cancel-and-replan';

function clone(value) {
  return structuredClone(value);
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function interruptedTaskView(task) {
  if (!task) return null;
  return {
    id: task.id ?? null,
    type: task.type ?? null,
    label: task.label ?? null,
    phase: task.phase ?? null,
    stage: task.data?.stage ?? null,
    destination: task.destination ? clone(task.destination) : null,
    workElapsed: Number(task.workElapsed ?? 0),
    workDuration: Number(task.workDuration ?? 0),
    reservationId: task.data?.reservationId ?? null,
    siteId: task.data?.siteId ?? null,
    materialId: task.data?.materialId ?? null,
    carriedAmount: Number(task.data?.carriedAmount ?? 0),
    reservedCapacity: Number(task.data?.reservedCapacity ?? 0),
    featureId: task.data?.featureId ?? null,
  };
}

export function exportActionRuntimeState({ agents, exportedAt } = {}) {
  const list = agents instanceof Map ? [...agents.values()] : Array.isArray(agents) ? agents : [];
  return {
    schemaVersion: ACTION_RUNTIME_SCHEMA_VERSION,
    policy: ACTION_RUNTIME_LOAD_POLICY,
    exportedAt: clone(exportedAt ?? null),
    agents: list
      .map((agent) => ({
        personId: agent.personId,
        x: Number(agent.x),
        y: Number(agent.y),
        interruptedTask: interruptedTaskView(agent.task),
      }))
      .sort((first, second) => String(first.personId).localeCompare(String(second.personId))),
  };
}

export function validateActionRuntimeState(rawSnapshot) {
  if (rawSnapshot?.schemaVersion !== ACTION_RUNTIME_SCHEMA_VERSION || !Array.isArray(rawSnapshot.agents)) {
    throw new Error('行动运行时存档格式不兼容。');
  }
  if (rawSnapshot.policy !== ACTION_RUNTIME_LOAD_POLICY) {
    throw new Error(`行动运行时读取策略不兼容：${rawSnapshot.policy ?? 'unknown'}`);
  }

  const seen = new Set();
  const snapshot = clone(rawSnapshot);
  snapshot.agents.forEach((agent) => {
    if (!agent?.personId || seen.has(agent.personId)) throw new Error('行动运行时存档包含无效或重复人物。');
    if (finiteNumber(agent.x) === null || finiteNumber(agent.y) === null) throw new Error(`行动运行时坐标无效：${agent.personId}`);
    if (agent.interruptedTask !== null && agent.interruptedTask !== undefined && typeof agent.interruptedTask !== 'object') {
      throw new Error(`行动运行时任务摘要无效：${agent.personId}`);
    }
    seen.add(agent.personId);
  });
  return snapshot;
}

export function sanitizePeopleSnapshotForRuntimeInterruption(rawPeopleSnapshot, rawRuntimeSnapshot) {
  if (!rawPeopleSnapshot || !Array.isArray(rawPeopleSnapshot.people) || !rawRuntimeSnapshot) return clone(rawPeopleSnapshot);
  const runtimeSnapshot = validateActionRuntimeState(rawRuntimeSnapshot);
  const agents = new Map(runtimeSnapshot.agents.map((agent) => [agent.personId, agent]));
  const snapshot = clone(rawPeopleSnapshot);

  snapshot.people = snapshot.people.map((person) => {
    const agent = agents.get(person.id);
    const interruptedSleep = agent?.interruptedTask?.type === ACTION_TYPES.SLEEP;
    const statusTags = (person.state?.statusTags ?? [])
      .filter((tag) => tag !== 'sleeping')
      .filter((tag) => !interruptedSleep || (tag !== 'sheltered' && tag !== 'exposed'));

    return {
      ...person,
      location: agent
        ? { ...person.location, tileX: Number(agent.x), tileY: Number(agent.y) }
        : clone(person.location),
      state: { ...person.state, statusTags },
      activity: {
        ...person.activity,
        status: 'idle',
        current: null,
      },
    };
  });
  return snapshot;
}

function validPosition({ x, y, mapSystem }) {
  const nextX = finiteNumber(x);
  const nextY = finiteNumber(y);
  const map = mapSystem?.get?.();
  if (nextX === null || nextY === null || !map?.geometry) return null;
  if (nextX < 0 || nextY < 0 || nextX >= map.geometry.width || nextY >= map.geometry.height) return null;
  const tileX = Math.round(nextX);
  const tileY = Math.round(nextY);
  if (!mapSystem.isWalkable(tileX, tileY)) return null;
  return { x: nextX, y: nextY };
}

export function resolveSavedRuntimePosition({ savedAgent, person, mapSystem } = {}) {
  const runtimePosition = validPosition({ x: savedAgent?.x, y: savedAgent?.y, mapSystem });
  if (runtimePosition) return { ...runtimePosition, source: 'runtime' };

  const personPosition = validPosition({
    x: person?.location?.tileX,
    y: person?.location?.tileY,
    mapSystem,
  });
  if (personPosition) return { ...personPosition, source: 'person' };

  const spawn = mapSystem?.getSpawnPoint?.();
  const spawnPosition = validPosition({ x: spawn?.x, y: spawn?.y, mapSystem });
  if (spawnPosition) return { ...spawnPosition, source: 'spawn' };

  throw new Error(`无法为人物恢复可行走位置：${person?.id ?? savedAgent?.personId ?? 'unknown'}`);
}
