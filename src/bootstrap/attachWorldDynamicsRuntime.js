import { createWorldDynamicsSystem } from '../modules/dynamics/worldDynamicsSystem.js';

export function attachWorldDynamicsRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('世界动力系统启动失败：世界运行时尚未初始化。');
  if (!runtime.dailyEconomySystem) throw new Error('世界动力系统启动失败：每日经济尚未初始化。');
  if (runtime.worldDynamicsSystem) return runtime.worldDynamicsSystem;

  const worldDynamicsSystem = createWorldDynamicsSystem({
    eventBus,
    gameTime: runtime.gameTime,
    getRuntime: () => globalThis.shengling,
  });

  eventBus.on('daily-economy:finalized', ({ report }) => {
    const decorated = runtime.dailyEconomySystem.getReport?.(report?.year, report?.day) ?? report;
    if (decorated) worldDynamicsSystem.evaluate(decorated);
  });

  globalThis.shengling = Object.freeze({ ...runtime, worldDynamicsSystem });
  return worldDynamicsSystem;
}
