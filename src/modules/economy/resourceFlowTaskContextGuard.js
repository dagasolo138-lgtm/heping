function clone(value) {
  return structuredClone(value);
}

function payloadTaskId(payload = {}) {
  return payload.task?.id ?? payload.taskId ?? payload.record?.taskId ?? null;
}

function runtimeActiveTaskIds(runtime = {}) {
  return new Set((runtime.actionSystem?.getRenderPeople?.() ?? [])
    .map((person) => person.activity?.current?.id)
    .filter(Boolean));
}

export function attachResourceFlowTaskContextGuard({
  eventBus,
  resourceFlowSystem,
  getRuntime = () => globalThis.shengling,
} = {}) {
  if (!eventBus || !resourceFlowSystem) throw new Error('资源流水任务上下文守卫缺少依赖。');

  const tracked = new Map();
  let clearedTerminal = 0;
  let clearedOnLoad = 0;

  function forget(taskId, { syntheticCompletion = false, reason = 'terminal' } = {}) {
    if (!taskId) return false;
    const existed = tracked.delete(taskId);
    if (syntheticCompletion) {
      resourceFlowSystem.observe('actions:completed', {
        task: { id: taskId },
        reason: `task-context-guard:${reason}`,
      });
    }
    if (existed) clearedTerminal += 1;
    return existed;
  }

  eventBus.on('actions:assigned', ({ personId, task }) => {
    if (!task?.id) return;
    tracked.set(task.id, {
      taskId: task.id,
      personId: personId ?? null,
      type: task.type ?? null,
    });
  });

  eventBus.on('actions:completed', (payload) => {
    forget(payloadTaskId(payload));
  });

  ['actions:cancelled', 'actions:failed'].forEach((eventName) => {
    eventBus.on(eventName, (payload) => {
      forget(payloadTaskId(payload), { syntheticCompletion: true, reason: eventName });
    });
  });

  eventBus.on('task-lifecycle:closed', (payload) => {
    const taskId = payloadTaskId(payload);
    if (!taskId || !tracked.has(taskId)) return;
    forget(taskId, { syntheticCompletion: true, reason: payload.status ?? 'lifecycle-closed' });
  });

  eventBus.on('save:loaded', () => {
    const taskIds = [...tracked.keys()];
    taskIds.forEach((taskId) => {
      resourceFlowSystem.observe('actions:completed', {
        task: { id: taskId },
        reason: 'task-context-guard:save-loaded',
      });
    });
    clearedOnLoad += taskIds.length;
    tracked.clear();
  });

  function getSummary() {
    return {
      tracked: tracked.size,
      clearedTerminal,
      clearedOnLoad,
      taskIds: [...tracked.keys()].sort(),
    };
  }

  function verify() {
    const active = runtimeActiveTaskIds(getRuntime?.() ?? {});
    const issues = [];
    tracked.forEach((context, taskId) => {
      if (!active.has(taskId)) issues.push({ type: 'orphan-resource-flow-task-context', ...clone(context) });
    });
    return { ok: issues.length === 0, issues, ...getSummary() };
  }

  return Object.freeze({ getSummary, verify });
}
