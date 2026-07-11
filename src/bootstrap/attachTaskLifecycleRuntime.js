import { createTaskLifecycleSystem } from '../modules/economy/taskLifecycleSystem.js';

export function attachTaskLifecycleRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('任务生命周期账本启动失败：核心运行时尚未初始化。');
  if (runtime.taskLifecycleSystem) return runtime.taskLifecycleSystem;

  const taskLifecycleSystem = createTaskLifecycleSystem({
    eventBus,
    gameTime: runtime.gameTime,
    getRuntime: () => globalThis.shengling,
  });

  eventBus.on('*', ({ eventName, payload }) => taskLifecycleSystem.observe(eventName, payload));
  globalThis.shengling = Object.freeze({ ...runtime, taskLifecycleSystem });
  return taskLifecycleSystem;
}
