const DEFAULT_SUPPRESSED_EVENTS = Object.freeze([
  'actions:log',
  'environment:updated',
  'simulation:time',
  'resource-flow:recorded',
]);

export function createHeadlessEventBus({ suppressedEvents = DEFAULT_SUPPRESSED_EVENTS } = {}) {
  const listeners = new Map();
  const suppressed = new Set(suppressedEvents);
  const deliveredByEvent = new Map();
  const suppressedByEvent = new Map();

  function on(eventName, listener) {
    if (!listeners.has(eventName)) listeners.set(eventName, new Set());
    listeners.get(eventName).add(listener);
    return () => listeners.get(eventName)?.delete(listener);
  }

  function emit(eventName, payload) {
    if (suppressed.has(eventName)) {
      suppressedByEvent.set(eventName, (suppressedByEvent.get(eventName) ?? 0) + 1);
      return false;
    }
    let delivered = 0;
    listeners.get(eventName)?.forEach((listener) => {
      listener(payload);
      delivered += 1;
    });
    listeners.get('*')?.forEach((listener) => {
      listener({ eventName, payload });
      delivered += 1;
    });
    if (delivered > 0) deliveredByEvent.set(eventName, (deliveredByEvent.get(eventName) ?? 0) + delivered);
    return delivered > 0;
  }

  function getDiagnostics() {
    return {
      mode: 'headless',
      listenerGroups: listeners.size,
      suppressedEvents: [...suppressed].sort(),
      deliveredByEvent: Object.fromEntries([...deliveredByEvent.entries()].sort(([a], [b]) => a.localeCompare(b))),
      suppressedByEvent: Object.fromEntries([...suppressedByEvent.entries()].sort(([a], [b]) => a.localeCompare(b))),
    };
  }

  const bus = Object.freeze({ on, emit, getDiagnostics, isSuppressed: (eventName) => suppressed.has(eventName) });
  globalThis.__shenglingEventBus = bus;
  return bus;
}

export { DEFAULT_SUPPRESSED_EVENTS as HEADLESS_SUPPRESSED_EVENTS };
