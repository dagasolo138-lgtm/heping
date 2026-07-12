import {
  INITIAL_TOOL_BLUEPRINTS,
  MINIMUM_PUBLIC_TOOL_COUNTS,
  TOOL_SCHEMA_VERSION,
  createToolInstance,
  toolDefinition,
} from './toolCatalog.js';
import { maintenanceDemandView, synchronizeMaintenance, verifyToolMaintenance } from './toolMaintenanceModel.js';

function clone(value) {
  return structuredClone(value);
}

function normalizedTool(raw, time = null) {
  const definition = toolDefinition(raw?.typeId);
  if (!raw?.id || !definition) throw new Error('工具存档包含未知工具。');
  const sourceSchemaVersion = Number(raw.schemaVersion ?? 1);
  const maximum = Math.max(1, Number(raw.maxDurability ?? definition.maxDurability));
  const durability = Math.max(0, Math.min(maximum, Number(raw.durability ?? maximum)));
  const repairedCount = Math.max(0, Number(raw.repairedCount ?? 0));
  const replacedCount = Math.max(0, Number(raw.replacedCount ?? 0));
  const totalWear = Math.max(0, Number(raw.totalWear ?? 0));
  const base = {
    schemaVersion: TOOL_SCHEMA_VERSION,
    id: String(raw.id),
    typeId: definition.typeId,
    label: definition.label,
    durability,
    maxDurability: maximum,
    status: durability > 0 ? 'usable' : 'broken',
    owner: clone(raw.owner ?? { type: 'camp', id: 'starting-camp' }),
    location: clone(raw.location ?? { type: 'camp', id: 'starting-camp' }),
    generation: Math.max(1, Number(raw.generation ?? replacedCount + 1)),
    repairedCount,
    repairsSinceReplacement: sourceSchemaVersion >= 3 ? Math.max(0, Number(raw.repairsSinceReplacement ?? 0)) : 0,
    replacedCount,
    totalWear,
    wearSinceReplacement: sourceSchemaVersion >= 3 ? Math.max(0, Number(raw.wearSinceReplacement ?? 0)) : 0,
  };
  const synchronized = synchronizeMaintenance(base, raw.maintenance ?? null, time);
  return { ...base, condition: synchronized.condition, maintenance: synchronized.maintenance };
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

  function synchronizeTool(tool, time = stamp()) {
    const synchronized = synchronizeMaintenance(tool, tool.maintenance ?? null, time);
    tool.condition = synchronized.condition;
    tool.maintenance = synchronized.maintenance;
    return tool;
  }

  function emit(reason, payload = {}) {
    eventBus?.emit?.('tools:changed', {
      reason,
      ...clone(payload),
      tools: list(),
      maintenanceDemands: listMaintenanceDemands(),
      coverage: getCoverage(),
      summary: getSummary(),
      time: stamp(),
    });
  }

  function seedDefaults() {
    tools.clear();
    INITIAL_TOOL_BLUEPRINTS.forEach((blueprint) => {
      const tool = normalizedTool(createToolInstance(blueprint), stamp());
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

  function rawMaintenanceDemands() {
    return [...tools.values()]
      .map(maintenanceDemandView)
      .filter(Boolean)
      .sort((first, second) => {
        if (first.priority !== second.priority) return first.priority === 'high' ? -1 : 1;
        return first.toolId.localeCompare(second.toolId);
      });
  }

  function coverageSnapshot(demands = rawMaintenanceDemands()) {
    return Object.entries(MINIMUM_PUBLIC_TOOL_COUNTS).map(([typeId, required]) => {
      const matching = [...tools.values()].filter((tool) => tool.typeId === typeId);
      const usable = matching.filter((tool) => tool.status === 'usable' && tool.durability > 0).length;
      const available = matching.filter((tool) => tool.status === 'usable' && tool.durability > 0 && !isReserved(tool.id)).length;
      const gap = Math.max(0, Number(required) - usable);
      const recoveryDemands = demands.filter((demand) => demand.typeId === typeId);
      return Object.freeze({
        typeId,
        label: toolDefinition(typeId)?.label ?? typeId,
        required: Number(required),
        total: matching.length,
        usable,
        available,
        gap,
        recoveryDemandCount: recoveryDemands.length,
        protected: gap === 0 || recoveryDemands.length > 0,
      });
    });
  }

  function getCoverage() {
    return coverageSnapshot().map(clone);
  }

  function listMaintenanceDemands({ priority = null, mode = null } = {}) {
    const raw = rawMaintenanceDemands();
    const coverage = new Map(coverageSnapshot(raw).map((entry) => [entry.typeId, entry]));
    return raw
      .map((demand) => {
        const guarantee = coverage.get(demand.typeId) ?? null;
        const guaranteeGap = Number(guarantee?.gap ?? 0) > 0;
        return {
          ...clone(demand),
          state: guaranteeGap ? 'urgent' : demand.state,
          priority: guaranteeGap ? 'high' : demand.priority,
          guaranteeGap,
          guarantee: guarantee ? clone(guarantee) : null,
        };
      })
      .filter((demand) => !priority || demand.priority === priority)
      .filter((demand) => !mode || demand.mode === mode)
      .sort((first, second) => {
        if (first.guaranteeGap !== second.guaranteeGap) return first.guaranteeGap ? -1 : 1;
        if (first.priority !== second.priority) return first.priority === 'high' ? -1 : 1;
        if (first.mode !== second.mode) return first.mode === 'replace' ? -1 : 1;
        return first.toolId.localeCompare(second.toolId);
      })
      .map(clone);
  }

  function getMaintenanceDemand(toolId) {
    const demand = listMaintenanceDemands().find((entry) => entry.toolId === toolId);
    return demand ? clone(demand) : null;
  }

  function verifyMaintenance() {
    const base = verifyToolMaintenance(list());
    const demands = listMaintenanceDemands();
    const coverage = coverageSnapshot(demands);
    const errors = [...base.errors];
    coverage.forEach((entry) => {
      if (entry.gap > 0 && entry.recoveryDemandCount <= 0) errors.push(`${entry.typeId}:unprotected-guarantee-gap`);
    });
    return Object.freeze({
      ok: errors.length === 0,
      errors: Object.freeze(errors),
      demandCount: base.demandCount,
      replacementDemandCount: demands.filter((demand) => demand.mode === 'replace').length,
      guaranteeGapCount: coverage.filter((entry) => entry.gap > 0).length,
      coverage: Object.freeze(coverage.map(clone)),
    });
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
      generation: tool.generation,
      durability: tool.durability,
      maxDurability: tool.maxDurability,
      condition: tool.maxDurability > 0 ? tool.durability / tool.maxDurability : 0,
      conditionState: tool.condition,
      maintenanceDemandId: tool.maintenance?.demandId ?? null,
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
    const previousDemandId = tool.maintenance?.demandId ?? null;
    const applied = Math.min(tool.durability, Math.max(0, Number(amount) || 0));
    tool.durability = Math.max(0, tool.durability - applied);
    tool.totalWear += applied;
    tool.wearSinceReplacement += applied;
    tool.status = tool.durability > 0 ? 'usable' : 'broken';
    synchronizeTool(tool);
    tools.set(tool.id, tool);
    emit(reason, {
      tool: clone(tool),
      amount: applied,
      broken: tool.status === 'broken',
      maintenanceRequested: !previousDemandId && Boolean(tool.maintenance?.demandId),
    });
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
    tool.repairsSinceReplacement += 1;
    synchronizeTool(tool);
    tools.set(tool.id, tool);
    emit(reason, { tool: clone(tool), amount: restored, maintenanceCleared: !tool.maintenance?.demandId });
    return clone(tool);
  }

  function replace(toolId, reason = 'tool:replaced') {
    const tool = tools.get(toolId);
    if (!tool) return null;
    const previous = clone(tool);
    tool.durability = tool.maxDurability;
    tool.status = 'usable';
    tool.generation += 1;
    tool.replacedCount += 1;
    tool.repairsSinceReplacement = 0;
    tool.wearSinceReplacement = 0;
    synchronizeTool(tool);
    tools.set(tool.id, tool);
    emit(reason, { tool: clone(tool), previous, maintenanceCleared: true });
    return clone(tool);
  }

  function getAssignments() {
    return [...assignments.values()].sort((first, second) => first.taskId.localeCompare(second.taskId)).map(clone);
  }

  function getSummary() {
    const values = [...tools.values()];
    const demands = listMaintenanceDemands();
    const coverage = coverageSnapshot(demands);
    return {
      total: values.length,
      usable: values.filter((tool) => tool.status === 'usable').length,
      broken: values.filter((tool) => tool.status === 'broken').length,
      low: values.filter((tool) => tool.condition === 'worn' || tool.condition === 'critical').length,
      critical: values.filter((tool) => tool.condition === 'critical').length,
      maintenanceNeeded: demands.length,
      urgentMaintenance: demands.filter((demand) => demand.priority === 'high').length,
      replacementNeeded: demands.filter((demand) => demand.mode === 'replace').length,
      guaranteeGaps: coverage.filter((entry) => entry.gap > 0).length,
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
    if (![1, 2, TOOL_SCHEMA_VERSION].includes(Number(snapshot?.schemaVersion)) || !Array.isArray(snapshot.tools)) {
      throw new Error('工具存档格式不兼容。');
    }
    const next = new Map();
    snapshot.tools.forEach((raw) => {
      const tool = normalizedTool(raw, stamp());
      if (next.has(tool.id)) throw new Error(`工具存档包含重复 ID：${tool.id}`);
      next.set(tool.id, tool);
    });
    tools.clear();
    next.forEach((tool, id) => tools.set(id, tool));
    assignments.clear();
    emit('tools:hydrated', { count: tools.size, sourceSchemaVersion: Number(snapshot.schemaVersion) });
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
      const tool = normalizedTool(raw, stamp());
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
    getCoverage,
    getAssignments,
    listMaintenanceDemands,
    getMaintenanceDemand,
    verifyMaintenance,
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
