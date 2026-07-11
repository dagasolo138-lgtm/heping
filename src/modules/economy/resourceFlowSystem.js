import { createId } from '../../core/ids/createId.js';

export const RESOURCE_FLOW_SCHEMA_VERSION = 1;
const DEFAULT_MAX_ENTRIES = 5000;
const TRANSFER_ACTIONS = new Set(['haulToCamp', 'deliverMaterials']);

function clone(value) {
  return structuredClone(value);
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function accountItems(items = {}) {
  return Object.fromEntries(Object.entries(items).map(([key, value]) => [key, round(value)]));
}

function mergeReason(first, second) {
  const values = [...new Set([first, second].filter(Boolean))];
  return values.join(' → ') || 'inventory:change';
}

function activityContext(person) {
  const current = person?.activity?.current ?? null;
  return {
    personId: person?.id ?? null,
    taskId: current?.id ?? null,
    actionType: current?.type ?? null,
  };
}

function sourceFor(delta) {
  if (delta.kind === 'tool-durability') return 'maintenance:tools';
  const type = delta.actionType;
  if (type === 'fetchWater') return 'environment:river';
  if (type === 'gatherBerries') return `map:feature:${delta.featureId ?? 'berries'}`;
  if (type === 'chopTree') return `map:feature:${delta.featureId ?? 'tree'}`;
  if (type === 'harvestMillet') return `farm:${delta.fieldId ?? 'field'}`;
  if (delta.reason?.includes('harvest')) return `farm:${delta.fieldId ?? 'field'}`;
  if (delta.reason?.includes('created') || delta.reason?.includes('seed')) return 'world:initial';
  return 'world:production';
}

function sinkFor(delta) {
  if (delta.kind === 'tool-durability') return `wear:${delta.toolId ?? delta.itemId}`;
  const reason = String(delta.reason ?? '');
  const type = delta.actionType;
  if (reason.includes('decay') || reason.includes('spoil')) return 'waste:spoilage';
  if (type === 'tendFire' || reason.includes('fire')) return 'fire:starting-camp';
  if (type === 'deliverMaterials' || type === 'buildSite' || reason.includes('construction')) {
    return `building:${delta.siteId ?? 'site'}`;
  }
  if (reason.includes('consume') || reason.includes('food') || reason.includes('drink') || reason.includes('distribution')) {
    return `needs:${delta.personId ?? 'population'}`;
  }
  return 'world:consumption';
}

function categoryFor(from, to, kind) {
  if (kind === 'tool-durability') return from.startsWith('maintenance:') ? 'repair' : 'wear';
  if (from.startsWith('world:') || from.startsWith('environment:') || from.startsWith('map:') || from.startsWith('farm:')) return 'production';
  if (to.startsWith('waste:')) return 'spoilage';
  if (to.startsWith('needs:')) return 'consumption';
  if (to.startsWith('building:')) return 'construction';
  if (to.startsWith('fire:')) return 'fuel';
  return 'transfer';
}

function canPair(negative, positive) {
  if (negative.taskId && positive.taskId && negative.taskId === positive.taskId) return true;
  const campPerson = (negative.account.startsWith('camp:') && positive.account.startsWith('person:'))
    || (negative.account.startsWith('person:') && positive.account.startsWith('camp:'));
  const actionType = positive.actionType ?? negative.actionType;
  return campPerson && TRANSFER_ACTIONS.has(actionType);
}

export function createResourceFlowSystem({ eventBus, gameTime, getRuntime = () => globalThis.shengling, maxEntries = DEFAULT_MAX_ENTRIES } = {}) {
  const entries = [];
  const pending = [];
  const peopleShadow = new Map();
  const campShadow = new Map();
  const toolShadow = new Map();
  const taskContext = new Map();
  const rollingByItem = {};
  const rollingByCategory = {};
  let sequence = 0;

  function stamp() {
    return clone(gameTime?.stamp?.() ?? { tick: 0, year: 1, day: 1, minute: 0, label: '未知时间' });
  }

  function adjustRolling(bucket, key, delta) {
    const next = round(Number(bucket[key] ?? 0) + Number(delta ?? 0));
    if (Math.abs(next) < 0.0005) delete bucket[key];
    else bucket[key] = next;
  }

  function applyRolling(entry, direction = 1) {
    adjustRolling(rollingByItem, entry.itemId, Number(entry.amount) * direction);
    adjustRolling(rollingByCategory, entry.category, Number(entry.amount) * direction);
  }

  function resetRolling() {
    Object.keys(rollingByItem).forEach((key) => delete rollingByItem[key]);
    Object.keys(rollingByCategory).forEach((key) => delete rollingByCategory[key]);
    entries.forEach((entry) => applyRolling(entry));
  }

  function rollingSummary() {
    return {
      totalEntries: entries.length,
      pending: pending.length,
      byItem: clone(rollingByItem),
      byCategory: clone(rollingByCategory),
    };
  }

  function append(input) {
    const amount = round(input.amount);
    if (!(amount > 0) || !input.itemId || !input.from || !input.to || input.from === input.to) return null;
    sequence += 1;
    const entry = Object.freeze({
      schemaVersion: RESOURCE_FLOW_SCHEMA_VERSION,
      id: input.id ?? createId('flow'),
      sequence,
      tick: Number(input.tick ?? stamp().tick ?? 0),
      time: clone(input.time ?? stamp()),
      itemId: String(input.itemId),
      amount,
      unit: input.unit ?? 'units',
      from: String(input.from),
      to: String(input.to),
      category: input.category ?? categoryFor(String(input.from), String(input.to), input.kind),
      reason: input.reason ?? 'inventory:change',
      personId: input.personId ?? null,
      taskId: input.taskId ?? null,
      reservationId: input.reservationId ?? null,
      metadata: clone(input.metadata ?? {}),
    });
    entries.push(entry);
    applyRolling(entry);
    if (entries.length > maxEntries) {
      const evicted = entries.splice(0, entries.length - maxEntries);
      evicted.forEach((removed) => applyRolling(removed, -1));
    }
    eventBus?.emit?.('resource-flow:recorded', { entry: clone(entry), summary: rollingSummary() });
    return clone(entry);
  }

  function enqueue({ account, itemId, delta, reason, unit = 'units', kind = 'resource', ...context } = {}) {
    const amount = round(delta);
    if (!account || !itemId || amount === 0) return null;
    const time = stamp();
    const draft = {
      id: createId('flow-delta'),
      account,
      itemId,
      delta: amount,
      reason: reason ?? 'inventory:change',
      unit,
      kind,
      tick: Number(time.tick ?? 0),
      time,
      ...clone(context),
    };
    pending.push(draft);
    return clone(draft);
  }

  function flushGroup(group) {
    const positives = group.filter((entry) => entry.delta > 0).map((entry) => ({ ...entry, remaining: entry.delta }));
    const negatives = group.filter((entry) => entry.delta < 0).map((entry) => ({ ...entry, remaining: -entry.delta }));

    for (const negative of negatives) {
      for (const positive of positives) {
        if (negative.remaining <= 0) break;
        if (positive.remaining <= 0 || !canPair(negative, positive)) continue;
        const amount = round(Math.min(negative.remaining, positive.remaining));
        append({
          itemId: negative.itemId,
          amount,
          unit: negative.unit,
          from: negative.account,
          to: positive.account,
          reason: mergeReason(negative.reason, positive.reason),
          tick: negative.tick,
          time: negative.time,
          personId: positive.personId ?? negative.personId,
          taskId: positive.taskId ?? negative.taskId,
          reservationId: positive.reservationId ?? negative.reservationId,
          metadata: { matched: true, actionType: positive.actionType ?? negative.actionType ?? null },
        });
        negative.remaining = round(negative.remaining - amount);
        positive.remaining = round(positive.remaining - amount);
      }
    }

    positives.filter((entry) => entry.remaining > 0).forEach((entry) => {
      const from = sourceFor(entry);
      append({
        itemId: entry.itemId,
        amount: entry.remaining,
        unit: entry.unit,
        kind: entry.kind,
        from,
        to: entry.account,
        reason: entry.reason,
        tick: entry.tick,
        time: entry.time,
        personId: entry.personId,
        taskId: entry.taskId,
        reservationId: entry.reservationId,
        metadata: { matched: false, actionType: entry.actionType ?? null },
      });
    });

    negatives.filter((entry) => entry.remaining > 0).forEach((entry) => {
      const to = sinkFor(entry);
      append({
        itemId: entry.itemId,
        amount: entry.remaining,
        unit: entry.unit,
        kind: entry.kind,
        from: entry.account,
        to,
        reason: entry.reason,
        tick: entry.tick,
        time: entry.time,
        personId: entry.personId,
        taskId: entry.taskId,
        reservationId: entry.reservationId,
        metadata: { matched: false, actionType: entry.actionType ?? null },
      });
    });
  }

  function flush({ throughTick = Infinity } = {}) {
    const ready = pending.filter((entry) => entry.tick <= throughTick);
    if (!ready.length) return [];
    const readyIds = new Set(ready.map((entry) => entry.id));
    const groups = new Map();
    const appended = [];
    ready.forEach((entry) => {
      const key = `${entry.tick}:${entry.itemId}:${entry.unit}`;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(entry);
    });
    const previousSequence = sequence;
    groups.forEach(flushGroup);
    if (sequence > previousSequence) {
      const firstSequence = previousSequence + 1;
      entries.forEach((entry) => {
        if (entry.sequence >= firstSequence) appended.push(clone(entry));
      });
    }
    for (let index = pending.length - 1; index >= 0; index -= 1) {
      if (readyIds.has(pending[index].id)) pending.splice(index, 1);
    }
    return appended;
  }

  function diffItems(account, previous = {}, next = {}, context = {}) {
    const keys = new Set([...Object.keys(previous), ...Object.keys(next)]);
    keys.forEach((itemId) => {
      const delta = round(Number(next[itemId] ?? 0) - Number(previous[itemId] ?? 0));
      if (delta !== 0) enqueue({ account, itemId, delta, ...context });
    });
  }

  function baseline() {
    const runtime = getRuntime?.() ?? {};
    peopleShadow.clear();
    (runtime.peopleSystem?.list?.() ?? []).forEach((person) => peopleShadow.set(person.id, accountItems(person.inventory?.items)));
    campShadow.clear();
    (runtime.campStore?.list?.() ?? []).forEach((camp) => campShadow.set(camp.id, accountItems(camp.items)));
    toolShadow.clear();
    (runtime.toolSystem?.list?.() ?? []).forEach((tool) => toolShadow.set(tool.id, round(tool.durability)));
  }

  function observe(eventName, payload = {}) {
    const currentTick = Number(gameTime?.stamp?.().tick ?? 0);
    if (eventName === 'simulation:pre-tick') flush({ throughTick: currentTick - 1 });

    if (eventName === 'actions:assigned' && payload.task?.id) {
      taskContext.set(payload.task.id, { personId: payload.personId ?? null, task: clone(payload.task) });
      return;
    }
    if (eventName === 'actions:completed' && payload.task?.id) {
      taskContext.delete(payload.task.id);
      return;
    }
    if (eventName === 'people:hydrated' || eventName === 'camp:hydrated') {
      baseline();
      return;
    }

    if (eventName === 'people:changed' && payload.person?.id) {
      const person = payload.person;
      const previous = peopleShadow.get(person.id) ?? {};
      const next = accountItems(person.inventory?.items);
      const activity = activityContext(person);
      const known = activity.taskId ? taskContext.get(activity.taskId)?.task : null;
      diffItems(`person:${person.id}`, previous, next, {
        reason: payload.reason,
        ...activity,
        featureId: known?.data?.featureId ?? null,
        fieldId: known?.data?.fieldId ?? null,
        siteId: known?.data?.siteId ?? null,
        reservationId: known?.data?.reservationId ?? null,
      });
      peopleShadow.set(person.id, next);
      return;
    }

    if (eventName === 'camp:changed' && payload.camp?.id) {
      const camp = payload.camp;
      const previous = campShadow.get(camp.id) ?? {};
      const next = accountItems(camp.items);
      diffItems(`camp:${camp.id}`, previous, next, {
        reason: payload.reason,
        siteId: payload.siteId ?? null,
        reservationId: payload.reservationId ?? null,
      });
      campShadow.set(camp.id, next);
      return;
    }

    if (eventName === 'tools:changed' && Array.isArray(payload.tools)) {
      const resetReasons = new Set(['tools:hydrated', 'tools:defaults-restored', 'tools:checkpoint-restored']);
      if (resetReasons.has(payload.reason)) {
        toolShadow.clear();
        payload.tools.forEach((tool) => toolShadow.set(tool.id, round(tool.durability)));
        return;
      }
      payload.tools.forEach((tool) => {
        const previous = toolShadow.has(tool.id) ? toolShadow.get(tool.id) : round(tool.durability);
        const next = round(tool.durability);
        const delta = round(next - previous);
        if (delta !== 0) enqueue({
          account: `tool:${tool.id}`,
          itemId: `durability:${tool.typeId}`,
          delta,
          unit: 'durability',
          kind: 'tool-durability',
          reason: payload.reason,
          toolId: tool.id,
          taskId: payload.assignment?.taskId ?? null,
          personId: payload.personId ?? payload.assignment?.personId ?? null,
        });
        toolShadow.set(tool.id, next);
      });
    }
  }

  function selectEntries(filter = {}) {
    return entries
      .filter((entry) => !filter.itemId || entry.itemId === filter.itemId)
      .filter((entry) => !filter.category || entry.category === filter.category)
      .filter((entry) => !filter.personId || entry.personId === filter.personId)
      .filter((entry) => filter.day === undefined || Number(entry.time?.day) === Number(filter.day))
      .filter((entry) => filter.sinceTick === undefined || entry.tick >= Number(filter.sinceTick))
      .slice(filter.limit ? -Math.max(0, Number(filter.limit)) : 0);
  }

  function list(filter = {}) {
    flush();
    return selectEntries(filter).map(clone);
  }

  function hasSummaryFilter(filter = {}) {
    return Boolean(
      filter.itemId
      || filter.category
      || filter.personId
      || filter.day !== undefined
      || filter.sinceTick !== undefined
      || filter.limit,
    );
  }

  function getSummary(filter = {}) {
    if (!filter.skipFlush) flush();
    if (!hasSummaryFilter(filter)) return rollingSummary();
    const selected = selectEntries(filter);
    const byItem = {};
    const byCategory = {};
    selected.forEach((entry) => {
      byItem[entry.itemId] = round((byItem[entry.itemId] ?? 0) + entry.amount);
      byCategory[entry.category] = round((byCategory[entry.category] ?? 0) + entry.amount);
    });
    return { totalEntries: selected.length, pending: pending.length, byItem, byCategory };
  }

  function getDailySummary(day = gameTime?.now?.().day) {
    return getSummary({ day });
  }

  function verify() {
    flush();
    const issues = [];
    const ids = new Set();
    entries.forEach((entry) => {
      if (ids.has(entry.id)) issues.push({ type: 'duplicate-entry', id: entry.id });
      ids.add(entry.id);
      if (!(entry.amount > 0)) issues.push({ type: 'invalid-amount', id: entry.id, amount: entry.amount });
      if (!entry.from || !entry.to || entry.from === entry.to) issues.push({ type: 'invalid-route', id: entry.id });
    });
    const runtime = getRuntime?.() ?? {};
    (runtime.peopleSystem?.list?.() ?? []).forEach((person) => Object.entries(person.inventory?.items ?? {}).forEach(([itemId, amount]) => {
      if (Number(amount) < 0) issues.push({ type: 'negative-inventory', account: `person:${person.id}`, itemId, amount });
    }));
    (runtime.campStore?.list?.() ?? []).forEach((camp) => Object.entries(camp.items ?? {}).forEach(([itemId, amount]) => {
      if (Number(amount) < 0) issues.push({ type: 'negative-inventory', account: `camp:${camp.id}`, itemId, amount });
    }));
    (runtime.toolSystem?.list?.() ?? []).forEach((tool) => {
      if (tool.durability < 0 || tool.durability > tool.maxDurability) issues.push({ type: 'invalid-durability', toolId: tool.id });
    });
    return { ok: issues.length === 0, issues, entries: entries.length, pending: pending.length };
  }

  function exportState() {
    flush();
    return { schemaVersion: RESOURCE_FLOW_SCHEMA_VERSION, exportedAt: stamp(), sequence, entries: entries.map(clone) };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== RESOURCE_FLOW_SCHEMA_VERSION || !Array.isArray(snapshot.entries)) {
      throw new Error('资源流水存档格式不兼容。');
    }
    entries.length = 0;
    snapshot.entries.slice(-maxEntries).forEach((entry) => {
      if (!entry?.id || !(Number(entry.amount) > 0) || !entry.from || !entry.to) throw new Error('资源流水包含无效记录。');
      entries.push(Object.freeze(clone(entry)));
    });
    resetRolling();
    sequence = Math.max(Number(snapshot.sequence ?? 0), ...entries.map((entry) => Number(entry.sequence ?? 0)), 0);
    pending.length = 0;
    baseline();
    eventBus?.emit?.('resource-flow:hydrated', { count: entries.length, summary: rollingSummary() });
    return list();
  }

  function createCheckpoint() {
    return { state: exportState(), pending: clone(pending) };
  }

  function restoreCheckpoint(snapshot) {
    importState(snapshot?.state ?? snapshot);
    pending.push(...clone(snapshot?.pending ?? []));
    return createCheckpoint();
  }

  baseline();

  return Object.freeze({
    observe,
    record: append,
    enqueue,
    flush,
    list,
    getSummary,
    getDailySummary,
    verify,
    exportState,
    importState,
    createCheckpoint,
    restoreCheckpoint,
    baseline,
  });
}
