export const ACTION_RUNTIME_SCHEMA_VERSION = 1;
export const ACTION_INTERRUPTION_POLICY = 'cancel-and-replan';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function alivePeople(peopleSystem) {
  const people = peopleSystem?.getAlive?.();
  return Array.isArray(people) ? people : null;
}

function summarizeTask(current) {
  if (!current || typeof current !== 'object') return null;
  return {
    id: current.id ?? null,
    type: current.type ?? null,
    label: current.label ?? null,
    phase: current.phase ?? null,
  };
}

export function validateActionRuntimeSnapshot(rawSnapshot) {
  if (rawSnapshot === null || rawSnapshot === undefined) return null;
  if (!rawSnapshot || typeof rawSnapshot !== 'object') throw new Error('行动运行时存档格式无效。');
  if (rawSnapshot.schemaVersion !== ACTION_RUNTIME_SCHEMA_VERSION) {
    throw new Error(`行动运行时存档版本不兼容：${rawSnapshot.schemaVersion}`);
  }
  if (rawSnapshot.interruptionPolicy !== ACTION_INTERRUPTION_POLICY) {
    throw new Error(`行动运行时中断策略不兼容：${rawSnapshot.interruptionPolicy ?? 'missing'}`);
  }
  if (!Array.isArray(rawSnapshot.agents)) throw new Error('行动运行时存档缺少人物坐标。');

  const personIds = new Set();
  rawSnapshot.agents.forEach((agent) => {
    if (!agent || typeof agent !== 'object' || typeof agent.personId !== 'string' || !agent.personId) {
      throw new Error('行动运行时人物标识无效。');
    }
    if (personIds.has(agent.personId)) throw new Error(`行动运行时人物重复：${agent.personId}`);
    personIds.add(agent.personId);
    if (!Number.isFinite(agent.x) || !Number.isFinite(agent.y)) {
      throw new Error(`行动运行时坐标无效：${agent.personId}`);
    }
    if (agent.interruptedTask !== null && agent.interruptedTask !== undefined && typeof agent.interruptedTask !== 'object') {
      throw new Error(`行动运行时任务摘要无效：${agent.personId}`);
    }
  });

  return clone(rawSnapshot);
}

export function exportActionRuntimeSnapshot({ actionSystem, peopleSystem, exportedAt = null } = {}) {
  const persistentPeople = alivePeople(peopleSystem);
  if (!persistentPeople) return null;

  const rendered = actionSystem?.getRenderPeople?.();
  const renderedPeople = Array.isArray(rendered) ? rendered : persistentPeople;
  return {
    schemaVersion: ACTION_RUNTIME_SCHEMA_VERSION,
    interruptionPolicy: ACTION_INTERRUPTION_POLICY,
    exportedAt: clone(exportedAt),
    agents: renderedPeople
      .filter((person) => person?.identity?.alive !== false)
      .map((person) => ({
        personId: person.id,
        x: Number(person.location?.tileX ?? 0),
        y: Number(person.location?.tileY ?? 0),
        interruptedTask: summarizeTask(person.activity?.current),
      })),
  };
}

function validateCoordinatesAgainstMap(snapshot, mapSystem, peopleById) {
  if (!snapshot) return;
  const map = mapSystem?.get?.();
  const width = Number(map?.geometry?.width);
  const height = Number(map?.geometry?.height);
  if (!Number.isFinite(width) || !Number.isFinite(height)) return;

  snapshot.agents.forEach((agent) => {
    if (!peopleById.has(agent.personId)) return;
    if (agent.x < 0 || agent.y < 0 || agent.x > width - 1 || agent.y > height - 1) {
      throw new Error(`行动运行时坐标越界：${agent.personId}`);
    }
  });
}

export function restoreActionRuntimeSnapshot({ snapshot, peopleSystem, mapSystem } = {}) {
  const people = alivePeople(peopleSystem);
  if (!people) {
    return {
      interruptionPolicy: ACTION_INTERRUPTION_POLICY,
      restoredPositions: 0,
      interruptedTasks: 0,
      usedLegacyPositions: true,
    };
  }

  const validated = validateActionRuntimeSnapshot(snapshot);
  const peopleById = new Map(people.map((person) => [person.id, person]));
  validateCoordinatesAgainstMap(validated, mapSystem, peopleById);
  const agentsById = new Map((validated?.agents ?? []).map((agent) => [agent.personId, agent]));
  let restoredPositions = 0;
  let interruptedTasks = 0;

  people.forEach((person) => {
    const savedAgent = agentsById.get(person.id);
    if (savedAgent) {
      peopleSystem.setLocation(person.id, { tileX: savedAgent.x, tileY: savedAgent.y });
      restoredPositions += 1;
    }
    if (savedAgent?.interruptedTask || person.activity?.current) interruptedTasks += 1;
    if (person.activity?.status !== 'idle' || person.activity?.current) {
      peopleSystem.setActivity(person.id, { status: 'idle', current: null });
    }
    if (person.state?.statusTags?.includes('sleeping')) peopleSystem.removeStatusTag(person.id, 'sleeping');
  });

  return {
    interruptionPolicy: ACTION_INTERRUPTION_POLICY,
    restoredPositions,
    interruptedTasks,
    usedLegacyPositions: validated === null,
  };
}
