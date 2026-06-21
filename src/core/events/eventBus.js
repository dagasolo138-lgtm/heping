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

  return { on, emit };
}
