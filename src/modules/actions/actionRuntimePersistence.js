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
    destination: task.destination ? clone(task.destination) : null,
    utility: task.utility ? clone(task.utility) : null,
  };
}

function normalizeRuntimeEntry(entry) {
  return {
    personId: entry?.personId ?? entry?.id ?? null,
    x: Number(entry?.x ?? entry?.location?.tileX),
    y: Number(entry?.y ?? entry?.location?.tileY),
    interruptedTask: interruptedTaskView(entry?.task ?? entry?.activity?.current ?? null),
  };
}

export function exportActionRuntimeState({ agents, people, exportedAt } = {}) {
  const list = agents instanceof Map
    ? [...agents.values()]
    : Array.isArray(agents)
      ? agents
      : Array.isArray(people)
        ? people
        : [];
  return {
    schemaVersion: ACTION_RUNTIME_SCHEMA_VERSION,
    policy: ACTION_RUNTIME_LOAD_POLICY,
    exportedAt: clone(exportedAt ?? null),
    agents: list
      .map(normalizeRuntimeEntry)
      .filter((agent) => agent.personId && Number.isFinite(agent.x) && Number.isFinite(agent.y))
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
    if (!person || typeof person !== 'object' || !person.id) return clone(person);
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
      state: person.state ? { ...person.state, statusTags } : person.state,
      activity: person.activity
        ? { ...person.activity, status: 'idle', current: null }
        : person.activity,
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
