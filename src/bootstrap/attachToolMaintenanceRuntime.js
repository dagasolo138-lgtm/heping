import { createToolMaintenanceRuntime } from '../modules/actions/toolMaintenanceRuntime.js';

export function attachToolMaintenanceRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('维修模块启动失败：世界运行时尚未初始化。');
  if (runtime.toolMaintenanceRuntime) return runtime.toolMaintenanceRuntime;
  if (!runtime.toolSystem) throw new Error('维修模块启动失败：工具系统尚未挂接。');

  const toolMaintenanceRuntime = createToolMaintenanceRuntime({
    eventBus,
    reservationLedger: runtime.reservationLedger,
    campStore: runtime.campStore,
    toolSystem: runtime.toolSystem,
    gameTime: runtime.gameTime,
    getRuntime: () => globalThis.shengling,
  });

  globalThis.shengling = Object.freeze({ ...runtime, toolMaintenanceRuntime });
  return toolMaintenanceRuntime;
}
