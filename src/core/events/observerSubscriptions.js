export const RESOURCE_FLOW_OBSERVER_EVENTS = Object.freeze([
  'simulation:pre-tick',
  'actions:assigned',
  'actions:completed',
  'people:hydrated',
  'camp:hydrated',
  'people:changed',
  'camp:changed',
  'tools:changed',
]);

export const TASK_LIFECYCLE_OBSERVER_EVENTS = Object.freeze([
  'simulation:pre-tick',
  'actions:assigned',
  'actions:stage-transition',
  'actions:completed',
  'actions:cancelled',
  'actions:failed',
  'people:changed',
  'save:loaded',
]);

export const DAILY_ECONOMY_OBSERVER_EVENTS = Object.freeze([
  'simulation:pre-tick',
  'actions:assigned',
  'actions:completed',
  'survival:resource-denied',
  'simulation:error',
]);

export function subscribeObserverEvents({ eventBus, observer, eventNames } = {}) {
  if (!eventBus?.on) throw new Error('精确观察订阅缺少事件总线。');
  if (!observer?.observe) throw new Error('精确观察订阅缺少观察器。');
  const names = [...new Set(eventNames ?? [])];
  if (!names.length) throw new Error('精确观察订阅至少需要一个事件。');
  const unsubscribe = names.map((eventName) => eventBus.on(eventName, (payload) => observer.observe(eventName, payload)));
  return Object.freeze({
    eventNames: Object.freeze(names),
    unsubscribe: () => unsubscribe.forEach((remove) => remove()),
  });
}
