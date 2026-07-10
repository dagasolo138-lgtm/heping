import { INITIAL_TOOL_BLUEPRINTS, TOOL_SCHEMA_VERSION, createToolInstance, toolDefinition } from './toolCatalog.js';

function clone(value) {
  return structuredClone(value);
}

function normalizedTool(raw) {
  const definition = toolDefinition(raw?.typeId);
  if (!raw?.id || !definition) throw new Error('工具存档包含未知工具。');
  const maximum = Math.max(1, Number(raw.maxDurability ?? definition.maxDurability));
  const durability = Math.max(0, Math.min(maximum, Number(raw.durability ?? maximum)));
  return {
    schemaVersion: TOOL_SCHEMA_VERSION,
    id: String(raw.id),
    typeId: definition.typeId,
    label: definition.label,
    durability,
    maxDurability: maximum,
    status: durability > 0 ? 'usable' : 'broken',
    owner: clone(raw.owner ?? { type: 'camp', id: 'starting-camp' }),
    location: clone(raw.location ?? { type: 'camp', id: 'starting-camp' }),
    repairedCount: Math.max(0, Number(raw.repairedCount ?? 0)),
    totalWear: Math.max(0, Number(raw.totalWear ?? 0)),
  };
}

function toolScore(tool, actionType) {
  const definition = toolDefinition(tool.typeId);
  if (!definition?.supportedActions.includes(actionType)) return -Infinity;
  const condition = tool.maxDurability > 0 ? tool.durability / tool.maxDurability : 0;
  const speedGain = 1 - Number(definition.effects.workDurationMultiplier ?? 1);
  const energyGain = 1 - Number(definition.effects.energyMultiplier ?? 1);
  return speedGain * 100 + energyGain * 40 + condition * 10;
}

function activeTaskIdsFromRuntime(runtime) {
  return new Set((runtime?.actionSystem?.getRenderPeople?.() ?? [])
    .map((person) => person.activity?.current?.id)
    .filter(Boolean));
}

export function createToolSystem({ eventBus, gameTime, reservationLedger, getRuntime = () => globalThis.shengling } = {}) {
  const tools = new Map();
  const assignments = new Map();

  function stamp() {
    return gameTime?.stamp?.() ?? null;
  }

  function emit(reason, payload = {}) {
    eventBus?.emit?.('tools:changed', {
      reason,
      ...clone(payload),
      tools: list(),
      summary: getSummary(),
      time: stamp(),
    });
  }

  function seedDefaults() {
    tools.clear();
    INITIAL_TOOL_BLUEPRINTS.forEach((blueprint) => {
      const tool = createToolInstance(blueprint);
      tools.set(tool.id, tool);
    });
  }

  seedDefaults();

  function list() {
    return [...tools.values()].sort((first, second) => first.id.localeCompare(second.id)).map(clone);
  }

  function get(toolId) {
    const tool = tools.get(toolId);
    return tool ? clone(tool) : null;
  }

  function isReserved(toolId) {
    return assignments.size > 0 && [...assignments.values()].some((assignment) => assignment.toolId === toolId)
      || Number(reservationLedger?.count?.({ type: 'tool', key: toolId }) ?? 0) > 0;
  }

  function previewForAction(actionType, { preferredId = null } = {}) {
    const available = [...tools.values()]
      .filter((tool) => tool.status === 'usable' && tool.durability > 0)
      .filter((tool) => !isReserved(tool.id))
      .filter((tool) => toolDefinition(tool.typeId)?.supportedActions.includes(actionType));
    if (preferredId) {
      const preferred = available.find((tool) => tool.id === preferredId);
      if (preferred) return toolView(preferred, actionType);
    }
    available.sort((first, second) => toolScore(second, actionType) - toolScore(first, actionType) || first.id.localeCompare(second.id));
    return available[0] ? toolView(available[0], actionType) : null;
  }

  function toolView(tool, actionType) {
    const definition = toolDefinition(tool.typeId);
    return Object.freeze({
      id: tool.id,
      typeId: tool.typeId,
      label: tool.label,
      durability: tool.durability,
      maxDurability: tool.maxDurability,
      condition: tool.maxDurability > 0 ? tool.durability / tool.maxDurability : 0,
      actionType,
      effects: clone(definition.effects),
      wear: Number(definition.wear[actionType] ?? 0),
    });
  }

  function reserveForTask({ task, personId } = {}) {
    if (!task?.id || assignments.has(task.id)) return assignments.get(task?.id) ? clone(assignments.get(task.id)) : null;
    const preferredId = task.data?.tool?.id ?? task.data?.laborCost?.tool?.id ?? null;
    const selected = previewForAction(task.type, { preferredId });
    if (!selected) return null;
    const reservationId = `${task.id}:tool`;
    const reservation = reservationLedger?.reserve?.({
      id: reservationId,
      type: 'tool',
      key: selected.id,
      taskId: task.id,
      ownerId: personId ?? null,
      amount: 1,
      capacity: 1,
      metadata: { toolId: selected.id, typeId: selected.typeId, actionType: task.type },
    });
    if (!reservation) return null;
    const assignment = {
      taskId: task.id,
      personId: personId ?? null,
      toolId: selected.id,
      reservationId,
      actionType: task.type,
      released: false,
      assignedAt: stamp(),
    };
    assignments.set(task.id, assignment);
    emit('tool:reserved', { assignment });
    return clone(assignment);
  }

  function releaseReservation(assignment) {
    if (!assignment || assignment.released) return null;
    const released = reservationLedger?.release?.(assignment.reservationId) ?? null;
    assignment.released = true;
    return released;
  }

  function releaseReservationForOwner(personId) {
    const released = [];
    assignments.forEach((assignment) => {
      if (assignment.personId !== personId) return;
      const entry = releaseReservation(assignment);
      if (entry) released.push(entry);
    });
    if (released.length) emit('tool:reservation-released', { personId, released });
    return released.map(clone);
  }

  function wearForTask(tool, task) {
    const definition = toolDefinition(tool.typeId);
    const base = Number(definition?.wear?.[task?.type] ?? 0);
    const workScale = Math.max(0.65, Math.min(2.5, Number(task?.data?.workAmount ?? 1)));
    return base * workScale;
  }

  function applyWear(toolId, amount, reason = 'tool:wear') {
    const tool = tools.get(toolId);
    if (!tool || tool.status === 'broken') return null;
    const applied = Math.min(tool.durability, Math.max(0, Number(amount) || 0));
    tool.durability = Math.max(0, tool.durability - applied);
    tool.totalWear += applied;
    tool.status = tool.durability > 0 ? 'usable' : 'broken';
    tools.set(tool.id, tool);
    emit(reason, { tool: clone(tool), amount: applied, broken: tool.status === 'broken' });
    return clone(tool);
  }

  function completeTask({ task, personId } = {}) {
    const assignment = assignments.get(task?.id);
    if (!assignment) return null;
    const tool = tools.get(assignment.toolId);
    const wear = tool ? wearForTask(tool, task) : 0;
    const updated = wear > 0 ? applyWear(assignment.toolId, wear, 'tool:used') : get(assignment.toolId);
    releaseReservation(assignment);
    assignments.delete(task.id);
    emit('tool:task-completed', { assignment, personId: personId ?? assignment.personId, wear, tool: updated });
    return { assignment: clone(assignment), wear, tool: updated };
  }

  function releaseTask(taskId, reason = 'tool:task-released') {
    const assignment = assignments.get(taskId);
    if (!assignment) return null;
    releaseReservation(assignment);
    assignments.delete(taskId);
    emit(reason, { assignment });
    return clone(assignment);
  }

  function reconcile(activeTaskIds = activeTaskIdsFromRuntime(getRuntime?.())) {
    const active = activeTaskIds instanceof Set ? activeTaskIds : new Set(activeTaskIds ?? []);
    const released = [];
    assignments.forEach((assignment, taskId) => {
      if (active.has(taskId)) return;
      released.push(releaseTask(taskId, 'tool:orphan-released'));
    });
    return released.filter(Boolean);
  }

  function repair(toolId, amount = Infinity, reason = 'tool:repaired') {
    const tool = tools.get(toolId);
    if (!tool) return null;
    const restored = Math.min(tool.maxDurability - tool.durability, Math.max(0, Number(amount)) || 0);
    if (restored <= 0) return clone(tool);
    tool.durability += restored;
    tool.status = 'usable';
    tool.repairedCount += 1;
    tools.set(tool.id, tool);
    emit(reason, { tool: clone(tool), amount: restored });
    return clone(tool);
  }

  function replace(toolId) {
    const tool = tools.get(toolId);
    if (!tool) return null;
    tool.durability = tool.maxDurability;
    tool.status = 'usable';
    tool.repairedCount += 1;
    tools.set(tool.id, tool);
    emit('tool:replaced', { tool: clone(tool) });
    return clone(tool);
  }

  function getAssignments() {
    return [...assignments.values()].sort((first, second) => first.taskId.localeCompare(second.taskId)).map(clone);
  }

  function getSummary() {
    const values = [...tools.values()];
    return {
      total: values.length,
      usable: values.filter((tool) => tool.status === 'usable').length,
      broken: values.filter((tool) => tool.status === 'broken').length,
      reserved: assignments.size,
      averageCondition: values.length
        ? values.reduce((total, tool) => total + tool.durability / tool.maxDurability, 0) / values.length
        : 0,
    };
  }

  function exportState() {
    return { schemaVersion: TOOL_SCHEMA_VERSION, exportedAt: stamp(), tools: list() };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== TOOL_SCHEMA_VERSION || !Array.isArray(snapshot.tools)) {
      throw new Error('工具存档格式不兼容。');
    }
    const next = new Map();
    snapshot.tools.forEach((raw) => {
      const tool = normalizedTool(raw);
      if (next.has(tool.id)) throw new Error(`工具存档包含重复 ID：${tool.id}`);
      next.set(tool.id, tool);
    });
    tools.clear();
    next.forEach((tool, id) => tools.set(id, tool));
    assignments.clear();
    emit('tools:hydrated', { count: tools.size });
    return list();
  }

  function resetToDefaults() {
    seedDefaults();
    assignments.clear();
    emit('tools:defaults-restored', { count: tools.size });
    return list();
  }

  function createCheckpoint() {
    return { tools: list(), assignments: getAssignments() };
  }

  function restoreCheckpoint(snapshot) {
    tools.clear();
    (snapshot?.tools ?? []).forEach((raw) => {
      const tool = normalizedTool(raw);
      tools.set(tool.id, tool);
    });
    assignments.clear();
    (snapshot?.assignments ?? []).forEach((assignment) => assignments.set(assignment.taskId, clone(assignment)));
    emit('tools:checkpoint-restored', { count: tools.size, assignments: assignments.size });
    return createCheckpoint();
  }

  return Object.freeze({
    list,
    get,
    getSummary,
    getAssignments,
    previewForAction,
    reserveForTask,
    releaseReservationForOwner,
    completeTask,
    releaseTask,
    reconcile,
    applyWear,
    repair,
    replace,
    exportState,
    importState,
    resetToDefaults,
    createCheckpoint,
    restoreCheckpoint,
  });
}
