export function createEventBus() {
  const listeners = new Map();

  function on(eventName, listener) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(listener);
    return () => listeners.get(eventName)?.delete(listener);
  }

  function emit(eventName, payload) {
    listeners.get(eventName)?.forEach((listener) => listener(payload));
    listeners.get('*')?.forEach((listener) => listener({ eventName, payload }));
  }

  const bus = { on, emit };
  // 当前项目只有一个世界运行时；启动器可用此引用挂接独立模块，避免反向耦合到页面入口。
  globalThis.__shenglingEventBus = bus;
  return bus;
}
