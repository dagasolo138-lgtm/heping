import { ACTION_TYPES, actionLabel } from '../actions/actionTypes.js';

export const SOCIAL_EVENT_SCHEMA_VERSION = 1;

const DIRECT_RADIUS = 6;
const RUMOR_RADIUS = 4;
const MAX_EVENTS = 80;

function clone(value) {
  return structuredClone(value);
}

function distance(first, second) {
  return Math.hypot(Number(first.tileX ?? first.x ?? 0) - Number(second.tileX ?? second.x ?? 0), Number(first.tileY ?? first.y ?? 0) - Number(second.tileY ?? second.y ?? 0));
}

function relationScore(person, otherId) {
  const relation = person.relations?.[otherId];
  return Number(relation?.familiarity ?? 0) * 0.25 + Number(relation?.affinity ?? 0) * 0.35 + Number(relation?.trust ?? 0) * 0.4;
}

function stableRoll(seed) {
  let hash = 2166136261;
  [...String(seed)].forEach((char) => {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return Math.abs(hash >>> 0) % 100;
}

function hasEventMemory(person, eventId) {
  return (person.memories?.personal ?? []).some((memory) => memory.details?.eventId === eventId);
}

function locationOf(person) {
  return {
    tileX: Number(person.location?.tileX ?? 0),
    tileY: Number(person.location?.tileY ?? 0),
  };
}

function eventSeverity(payload, fallback = 1) {
  if (payload?.severity === 'shortage') return 4;
  if (payload?.severity === 'major') return 5;
  if (payload?.type?.includes?.('coWork')) return 2;
  return fallback;
}

function summaryFor(event, actor, target = null) {
  if (event.kind === 'buildingCompleted') return `${actor.identity.name}完成了${event.item ?? '建筑'}，这件事在营地传开了。`;
  if (event.kind === 'majorHarvest') return `${actor.identity.name}带回了一次重要收获，营地记住了这件事。`;
  if (event.kind === 'action') return `${actor.identity.name}${actionLabel(event.action)}，这件事被旁人记住了。`;
  if (event.kind === 'resourceDenied') return `${actor.identity.name}在营地请求${event.item ?? event.need}时被拒绝。`;
  if (event.kind === 'resourceDistributed') return `${actor.identity.name}按“${event.ruleLabel ?? event.ruleId}”规则取得了${event.item ?? event.need}。`;
  if (event.kind === 'relationChanged' && target) return `${actor.identity.name}与${target.identity.name}的关系因${actionLabel(event.action)}发生变化。`;
  if (event.kind === 'campRuleChanged') return `营地规则改为“${event.ruleLabel ?? event.ruleId}”。`;
  return event.summary ?? '营地发生了一件值得记住的事。';
}

function relationDeltaFor(event, source) {
  if (event.kind === 'resourceDenied') return { familiarity: 0.1, affinity: -0.15, trust: -0.1 };
  if (event.kind === 'resourceDistributed') return { familiarity: 0.05, affinity: source === 'rumor' ? 0.02 : 0.05, trust: 0.03 };
  if (event.kind === 'relationChanged') return { familiarity: 0.05, affinity: 0.03, trust: 0.02 };
  return { familiarity: 0.03 };
}

export function createSocialEventSystem({
  eventBus,
  peopleSystem,
  gameTime,
  getRuntimePeople = () => peopleSystem.getAlive(),
} = {}) {
  const events = [];

  function alivePeople() {
    return peopleSystem.getAlive();
  }

  function runtimePerson(id) {
    return getRuntimePeople()?.find((person) => person.id === id) ?? peopleSystem.get(id);
  }

  function peopleNear(location, exceptIds = new Set(), radius = DIRECT_RADIUS) {
    return alivePeople().filter((person) => {
      if (exceptIds.has(person.id)) return false;
      const runtime = runtimePerson(person.id) ?? person;
      return distance(location, locationOf(runtime)) <= radius;
    });
  }

  function recordMemory(person, event, source, viaPersonId = null) {
    const current = peopleSystem.get(person.id);
    if (!current || hasEventMemory(current, event.id)) return null;
    const actor = event.actorId ? peopleSystem.get(event.actorId) : null;
    const target = event.targetId ? peopleSystem.get(event.targetId) : null;
    const prefix = source === 'direct' ? '亲眼所见' : '听闻';
    const memory = peopleSystem.addPersonalMemory(person.id, {
      type: source === 'direct' ? 'social:observedEvent' : 'social:rumor',
      summary: `${prefix}：${summaryFor(event, actor ?? person, target)}`,
      relatedPersonIds: [event.actorId, event.targetId, viaPersonId].filter(Boolean),
      relatedEntityIds: [event.item, event.ruleId].filter(Boolean),
      details: {
        eventId: event.id,
        source,
        viaPersonId,
        kind: event.kind,
        severity: event.severity,
        action: event.action ?? null,
      },
      time: event.time,
    });
    if (actor && actor.id !== person.id) peopleSystem.adjustRelation(person.id, actor.id, relationDeltaFor(event, source));
    return memory;
  }

  function rumorChance(speaker, listener, event) {
    const social = Number(speaker.work?.skills?.social ?? 0) + Number(listener.work?.skills?.social ?? 0);
    const relation = Math.max(0, relationScore(speaker, listener.id));
    return Math.min(88, 12 + event.severity * 9 + social * 2 + relation * 0.4);
  }

  function spreadRumors(event, witnesses) {
    witnesses.forEach((speaker) => {
      const speakerRuntime = runtimePerson(speaker.id) ?? speaker;
      peopleNear(locationOf(speakerRuntime), new Set([speaker.id, event.actorId, event.targetId].filter(Boolean)), RUMOR_RADIUS)
        .forEach((listener) => {
          if (event.witnesses.includes(listener.id)) return;
          if (hasEventMemory(listener, event.id)) return;
          const chance = rumorChance(speaker, listener, event);
          if (stableRoll(`${event.id}:${speaker.id}:${listener.id}`) >= chance) return;
          const memory = recordMemory(listener, event, 'rumor', speaker.id);
          if (memory) event.heardBy.push(listener.id);
        });
    });
  }

  function ingest(rawEvent) {
    if (!rawEvent?.actorId && rawEvent?.kind !== 'campRuleChanged') return null;
    const actor = rawEvent.actorId ? runtimePerson(rawEvent.actorId) : null;
    const baseLocation = rawEvent.location ?? (actor ? locationOf(actor) : { tileX: 0, tileY: 0 });
    const event = {
      schemaVersion: SOCIAL_EVENT_SCHEMA_VERSION,
      id: rawEvent.id ?? `social-event-${gameTime.now().tick}-${events.length + 1}`,
      kind: rawEvent.kind,
      actorId: rawEvent.actorId ?? null,
      targetId: rawEvent.targetId ?? null,
      item: rawEvent.item ?? null,
      amount: rawEvent.amount ?? null,
      ruleId: rawEvent.ruleId ?? null,
      ruleLabel: rawEvent.ruleLabel ?? null,
      action: rawEvent.action ?? null,
      severity: Number(rawEvent.severity ?? 1),
      summary: rawEvent.summary ?? null,
      location: clone(baseLocation),
      time: clone(rawEvent.time ?? gameTime.stamp()),
      witnesses: [],
      heardBy: [],
    };
    const except = new Set([event.actorId, event.targetId].filter(Boolean));
    const witnesses = peopleNear(baseLocation, except, DIRECT_RADIUS);
    witnesses.forEach((person) => {
      const memory = recordMemory(person, event, 'direct');
      if (memory) event.witnesses.push(person.id);
    });
    spreadRumors(event, witnesses);
    events.unshift(event);
    events.splice(MAX_EVENTS);
    eventBus.emit('social:event-recorded', { event: clone(event), time: gameTime.stamp() });
    return clone(event);
  }

  function exportState() {
    return {
      schemaVersion: SOCIAL_EVENT_SCHEMA_VERSION,
      exportedAt: gameTime.stamp(),
      events: clone(events),
    };
  }

  function importState(snapshot) {
    if (snapshot === null || snapshot === undefined) return null;
    if (snapshot?.schemaVersion !== SOCIAL_EVENT_SCHEMA_VERSION) throw new Error('社会事件存档格式不兼容。');
    events.splice(0, events.length, ...(Array.isArray(snapshot.events) ? clone(snapshot.events).slice(0, MAX_EVENTS) : []));
    eventBus.emit('social:events-hydrated', { count: events.length, time: gameTime.stamp() });
    return exportState();
  }

  const offCompleted = eventBus.on('actions:completed', ({ result, task, personId, time }) => {
    // 降噪：普通劳动继续进入 lifeEvents，但不再默认成为可传播的社会传闻。
    if (task?.type === ACTION_TYPES.BUILD_SITE && result?.completedBuilding) {
      ingest({
        kind: 'buildingCompleted',
        actorId: personId,
        action: task.type,
        item: result.completedBuilding.label,
        severity: 4,
        summary: result.summary,
        time,
      });
      return;
    }
    const harvestAmount = Number(result?.harvest?.amount ?? result?.details?.harvest?.amount ?? 0);
    if (task?.type === ACTION_TYPES.HARVEST_MILLET && harvestAmount >= 8) {
      ingest({
        kind: 'majorHarvest',
        actorId: personId,
        action: task.type,
        amount: harvestAmount,
        severity: 3,
        summary: result.summary,
        time,
      });
    }
  });
  const offDistributed = eventBus.on('survival:resource-distributed', (payload) => ingest({
    kind: 'resourceDistributed',
    actorId: payload.personId,
    item: payload.itemId,
    ruleId: payload.ruleId,
    ruleLabel: payload.ruleLabel,
    severity: 2,
    time: payload.time,
  }));
  const offDenied = eventBus.on('survival:resource-denied', (payload) => ingest({
    kind: 'resourceDenied',
    actorId: payload.personId,
    item: payload.itemId,
    ruleId: payload.ruleId,
    ruleLabel: payload.ruleLabel,
    severity: eventSeverity(payload, 4),
    time: payload.time,
  }));
  const offRelation = eventBus.on('social:relation-changed', (payload) => ingest({
    kind: 'relationChanged',
    actorId: payload.actorId,
    targetId: payload.targetId,
    action: payload.action,
    severity: eventSeverity(payload, 2),
    time: payload.time,
  }));
  const offRule = eventBus.on('camp:rule-changed', ({ rule, entry, time }) => ingest({
    kind: 'campRuleChanged',
    actorId: entry?.proposedBy,
    ruleId: rule?.id,
    ruleLabel: rule?.id,
    severity: 4,
    time,
  }));

  return Object.freeze({
    ingest,
    listEvents: () => clone(events),
    exportState,
    importState,
    stop() {
      offCompleted();
      offDistributed();
      offDenied();
      offRelation();
      offRule();
    },
  });
}
