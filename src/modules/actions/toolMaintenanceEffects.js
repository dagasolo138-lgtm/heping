import { CAMP_ITEM_LABELS } from '../settlements/campStore.js';
import { ACTION_TYPES } from './actionTypes.js';

function clone(value) {
  return structuredClone(value);
}

function positiveMaterials(materials = {}) {
  return Object.fromEntries(Object.entries(materials)
    .map(([itemId, amount]) => [itemId, Math.max(0, Number(amount) || 0)])
    .filter(([, amount]) => amount > 0));
}

function materialText(materials = {}) {
  return Object.entries(materials)
    .map(([itemId, amount]) => `${CAMP_ITEM_LABELS[itemId] ?? itemId}×${amount}`)
    .join('、');
}

function modeForTask(task) {
  return task?.type === ACTION_TYPES.REPLACE_TOOL ? 'replace' : 'repair';
}

function failed({ task, personId, reason, summary, details = {} }) {
  return {
    ok: false,
    personId: personId ?? null,
    reason,
    summary,
    details: {
      taskId: task?.id ?? null,
      action: task?.type ?? null,
      mode: task?.data?.mode ?? modeForTask(task),
      demandId: task?.data?.demandId ?? null,
      toolId: task?.data?.toolId ?? null,
      ...clone(details),
    },
  };
}

export function completeToolMaintenance({ agent, task, peopleSystem, campStore, gameTime } = {}) {
  const runtime = globalThis.shengling ?? {};
  const toolSystem = runtime.toolSystem;
  const maintenanceRuntime = runtime.toolMaintenanceRuntime;
  const person = peopleSystem?.get?.(agent?.personId);
  const expectedMode = modeForTask(task);
  if (!person) {
    return failed({ task, personId: agent?.personId, reason: 'maintenance-person-missing', summary: '工具维护任务失败：找不到执行人员。' });
  }

  const reservationFailure = maintenanceRuntime?.getFailure?.(task.id);
  if (reservationFailure) {
    return failed({
      task,
      personId: person.id,
      reason: reservationFailure.reason,
      summary: `${person.identity.name}未能开始工具维护：资源预留失败。`,
      details: reservationFailure.details,
    });
  }

  const reservation = maintenanceRuntime?.getTaskReservation?.(task.id);
  if (!reservation) {
    return failed({
      task,
      personId: person.id,
      reason: 'maintenance-reservation-missing',
      summary: `${person.identity.name}抵达营地后发现工具维护预留已经失效。`,
    });
  }
  if (reservation.mode !== expectedMode) {
    return failed({
      task,
      personId: person.id,
      reason: 'maintenance-mode-mismatch',
      summary: `${person.identity.name}发现维护任务类型已经变化，本次任务取消。`,
      details: { expectedMode, reservedMode: reservation.mode },
    });
  }

  const tool = toolSystem?.get?.(task.data?.toolId);
  if (!tool) {
    return failed({ task, personId: person.id, reason: 'maintenance-tool-missing', summary: `${person.identity.name}没有找到需要维护的工具。` });
  }
  const demand = toolSystem?.getMaintenanceDemand?.(tool.id);
  if (!demand || demand.id !== task.data?.demandId || demand.mode !== expectedMode) {
    return failed({
      task,
      personId: person.id,
      reason: 'maintenance-demand-stale',
      summary: `${tool.label}的维护需求已经变化，本次任务取消。`,
      details: { expectedMode, liveMode: demand?.mode ?? null },
    });
  }
  if (Number(task.data?.generation ?? tool.generation) !== Number(tool.generation)) {
    return failed({
      task,
      personId: person.id,
      reason: 'maintenance-generation-stale',
      summary: `${tool.label}已经进入新一代，本次旧维护任务取消。`,
      details: { taskGeneration: task.data?.generation, liveGeneration: tool.generation },
    });
  }

  const materials = positiveMaterials(task.data?.materials ?? demand.materials);
  const campId = task.data?.campId ?? reservation.campId ?? 'starting-camp';
  const camp = campStore?.get?.(campId);
  if (!camp) {
    return failed({ task, personId: person.id, reason: 'maintenance-camp-missing', summary: `${person.identity.name}找不到工具维护地点。`, details: { campId } });
  }

  const shortages = Object.entries(materials)
    .filter(([itemId, amount]) => Number(camp.items?.[itemId] ?? 0) < amount)
    .map(([itemId, amount]) => ({ itemId, required: amount, available: Number(camp.items?.[itemId] ?? 0) }));
  if (shortages.length) {
    return failed({
      task,
      personId: person.id,
      reason: 'maintenance-material-shortage',
      summary: `${person.identity.name}准备${expectedMode === 'replace' ? '替换' : '维修'}${tool.label}时发现材料不足。`,
      details: { shortages },
    });
  }

  let restoreAmount = 0;
  if (expectedMode === 'repair') {
    const targetDurability = Math.min(tool.maxDurability, Math.max(tool.durability, Number(task.data?.targetDurability ?? demand.targetDurability)));
    restoreAmount = Math.max(0, targetDurability - tool.durability);
    if (!(restoreAmount > 0)) {
      return failed({
        task,
        personId: person.id,
        reason: 'maintenance-no-repair-needed',
        summary: `${tool.label}已经不需要继续维修。`,
      });
    }
  }

  const flowContext = `${expectedMode}:${task.id}:${tool.id}:${person.id}`;
  const consumed = {};
  for (const [itemId, amount] of Object.entries(materials)) {
    const taken = campStore.take(campId, itemId, amount, `tool:maintenance:${flowContext}`);
    if (taken !== amount) {
      throw new Error(`工具维护材料原子扣除失败：${itemId} 需要 ${amount}，实际 ${taken}`);
    }
    consumed[itemId] = taken;
  }

  const before = clone(tool);
  const updated = expectedMode === 'replace'
    ? toolSystem.replace(tool.id, `tool:maintenance-completed:${flowContext}`)
    : toolSystem.repair(tool.id, restoreAmount, `tool:maintenance-completed:${flowContext}`);
  const restored = Math.max(0, Number(updated?.durability ?? tool.durability) - tool.durability);
  const stamp = gameTime?.stamp?.() ?? null;
  const summary = expectedMode === 'replace'
    ? `${person.identity.name}使用${materialText(consumed)}制作了替代${tool.label}，公共工具进入第 ${updated.generation} 代。`
    : `${person.identity.name}使用${materialText(consumed)}维修了${tool.label}，恢复 ${Math.round(restored)} 点耐久。`;
  return {
    ok: true,
    personId: person.id,
    summary,
    details: {
      taskId: task.id,
      action: task.type,
      mode: expectedMode,
      demandId: demand.id,
      toolId: tool.id,
      toolTypeId: tool.typeId,
      generationBefore: before.generation,
      generationAfter: updated.generation,
      durabilityBefore: tool.durability,
      durabilityAfter: updated.durability,
      restored,
      replacementReason: demand.replacementReason ?? null,
      guaranteeGap: Boolean(demand.guaranteeGap),
      materials: clone(consumed),
      reservationIds: clone(reservation.reservationIds),
      completedAt: clone(stamp),
    },
  };
}
