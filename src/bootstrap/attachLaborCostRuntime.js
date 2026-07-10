import { estimatePlannedLaborCost } from '../modules/actions/laborCostModel.js';

export function attachLaborCostRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('劳动成本诊断启动失败：世界运行时尚未初始化。');
  if (runtime.laborCostSystem) return runtime.laborCostSystem;

  const recent = [];
  eventBus.on('actions:assigned', ({ personId, task }) => {
    if (!task?.data?.laborCost) return;
    recent.unshift({
      personId,
      taskId: task.id,
      type: task.type,
      label: task.label,
      laborCost: structuredClone(task.data.laborCost),
    });
    recent.splice(30);
  });

  function estimate(personId, task) {
    const active = globalThis.shengling ?? runtime;
    const person = active.peopleSystem.getRuntime?.(personId) ?? active.peopleSystem.get(personId);
    if (!person) throw new Error(`找不到人物：${personId}`);
    return estimatePlannedLaborCost({
      person,
      task,
      mapSystem: active.mapSystem,
      roadSystem: active.roadSystem,
      weather: active.weatherSystem?.get?.() ?? null,
    });
  }

  const api = Object.freeze({
    estimate,
    getRecent: (limit = 10) => structuredClone(recent.slice(0, Math.max(0, Number(limit) || 0))),
  });
  globalThis.shengling = Object.freeze({ ...runtime, laborCostSystem: api });
  return api;
}
