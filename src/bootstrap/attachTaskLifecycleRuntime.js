import {
  TASK_LIFECYCLE_OBSERVER_EVENTS,
  subscribeObserverEvents,
} from '../core/events/observerSubscriptions.js';
import { createTaskLifecycleSystem } from '../modules/economy/taskLifecycleSystem.js';
import { createTaskLifecycleStageCostView } from '../modules/economy/taskLifecycleStageCostView.js';

export function attachTaskLifecycleRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('任务生命周期账本启动失败：核心运行时尚未初始化。');
  if (runtime.taskLifecycleSystem) return runtime.taskLifecycleSystem;

  const baseTaskLifecycleSystem = createTaskLifecycleSystem({
    eventBus,
    gameTime: runtime.gameTime,
    getRuntime: () => globalThis.shengling,
  });
  const taskLifecycleSystem = createTaskLifecycleStageCostView({
    taskLifecycleSystem: baseTaskLifecycleSystem,
    gameTime: runtime.gameTime,
  });

  subscribeObserverEvents({
    eventBus,
    observer: taskLifecycleSystem,
    eventNames: TASK_LIFECYCLE_OBSERVER_EVENTS,
  });
  globalThis.shengling = Object.freeze({ ...runtime, taskLifecycleSystem });
  return taskLifecycleSystem;
}
