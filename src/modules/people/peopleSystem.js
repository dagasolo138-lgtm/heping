import { createPerson } from './personFactory.js';
import { validatePerson } from './personValidation.js';
import { getPerson, listPeople, getPeopleByIds, getAlivePeople } from './personQueries.js';
import { patchPersonState, setOccupation, setLocation, setActivity, setExtension, addStatusTag, removeStatusTag } from './personMutations.js';
import { applyNeedDelta } from './personState.js';
import { appendLifeEvent, appendPersonalMemory, appendEncounterMemory } from './personMemory.js';
import { adjustRelation, linkParentChild, linkSiblings, linkSpouses } from './personRelations.js';
import { changeItem, equipItem, addClaim } from './personInventory.js';
import { markDead } from './personLifecycle.js';
import { PEOPLE_SCHEMA_VERSION } from './personSchema.js';

const RUNTIME_KEYS = Object.freeze([
  'identity',
  'location',
  'work',
  'state',
  'activity',
  'traits',
  'family',
  'relations',
  'inventory',
  'extensions',
]);

function clone(value) {
  return structuredClone(value);
}

function safeRuntimeView(person) {
  if (!person) return null;
  return clone({
    schemaVersion: person.schemaVersion,
    id: person.id,
    revision: person.revision,
    identity: person.identity,
    location: person.location,
    work: person.work,
    state: person.state,
    activity: person.activity,
    traits: person.traits,
    family: person.family,
    relations: person.relations,
    inventory: person.inventory,
    extensions: person.extensions,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
  });
}

function cachedRuntimeView(person, cache) {
  if (!person) return null;
  const cached = cache.get(person.id);
  if (cached?.revision === person.revision) return cached.view;
  const view = Object.freeze({
    schemaVersion: person.schemaVersion,
    id: person.id,
    revision: person.revision,
    identity: person.identity,
    location: person.location,
    work: person.work,
    state: person.state,
    activity: person.activity,
    traits: person.traits,
    family: person.family,
    relations: person.relations,
    inventory: person.inventory,
    extensions: person.extensions,
    createdAt: person.createdAt,
    updatedAt: person.updatedAt,
  });
  cache.set(person.id, { revision: person.revision, view });
  return view;
}

function runtimeDraft(person, keys = RUNTIME_KEYS) {
  const selected = new Set(keys);
  const draft = { ...person, memories: person.memories };
  RUNTIME_KEYS.forEach((key) => {
    draft[key] = selected.has(key) ? clone(person[key]) : person[key];
  });
  return draft;
}

function migrateSnapshot(rawSnapshot) {
  if (!rawSnapshot || !Array.isArray(rawSnapshot.people)) return rawSnapshot;
  const snapshot = clone(rawSnapshot);

  if (snapshot.schemaVersion === 1) {
    snapshot.people = snapshot.people.map((person) => ({
      ...person,
      schemaVersion: 2,
      memories: {
        ...(person.memories ?? {}),
        personal: clone(person.memories?.personal ?? person.memories?.player ?? []),
        recent: clone(person.memories?.recent ?? []),
      },
    }));
    snapshot.schemaVersion = 2;
  }

  if (snapshot.schemaVersion === 2) {
    snapshot.people = snapshot.people.map((person) => ({
      ...person,
      schemaVersion: 3,
      activity: person.activity ?? {
        status: 'idle',
        current: null,
        lastCompleted: null,
        completedCount: 0,
      },
    }));
    snapshot.schemaVersion = 3;
  }

  return snapshot;
}

export function createPeopleSystem({ eventBus, gameTime, runtimeMode = 'safe' }) {
  const people = new Map();
  const runtimeCache = new Map();
  const headless = runtimeMode === 'headless';
  let runtimeCacheHits = 0;
  let runtimeCacheMisses = 0;

  function stamp() {
    return gameTime.stamp();
  }

  function invalidateRuntime(id) {
    runtimeCache.delete(id);
  }

  function runtimeView(person) {
    if (!headless) return safeRuntimeView(person);
    const cached = person ? runtimeCache.get(person.id) : null;
    if (cached?.revision === person.revision) runtimeCacheHits += 1;
    else runtimeCacheMisses += 1;
    return cachedRuntimeView(person, runtimeCache);
  }

  function commit(person, reason) {
    validatePerson(person);
    person.revision += 1;
    person.updatedAt = stamp();
    people.set(person.id, person);
    invalidateRuntime(person.id);
    eventBus.emit('people:changed', { reason, person: clone(person) });
    return clone(person);
  }

  function commitRuntime(person, reason) {
    validatePerson(person);
    person.revision += 1;
    person.updatedAt = stamp();
    people.set(person.id, person);
    invalidateRuntime(person.id);
    const view = runtimeView(person);
    eventBus.emit('people:changed', { reason, person: view });
    return view;
  }

  function transact(personId, reason, mutator) {
    const original = people.get(personId);
    if (!original) throw new Error(`找不到人物：${personId}`);
    const draft = clone(original);
    const result = mutator(draft);
    return { person: commit(draft, reason), result: clone(result) };
  }

  function transactRuntime(personId, reason, keys, mutator) {
    const original = people.get(personId);
    if (!original) throw new Error(`找不到人物：${personId}`);
    const draft = runtimeDraft(original, headless ? keys : RUNTIME_KEYS);
    const result = mutator(draft);
    return { person: commitRuntime(draft, reason), result: clone(result) };
  }

  function create(input) {
    const person = createPerson(input, stamp());
    people.set(person.id, person);
    invalidateRuntime(person.id);
    eventBus.emit('people:created', { person: clone(person) });
    return clone(person);
  }

  function connect(firstId, secondId, kind) {
    const first = people.get(firstId);
    const second = people.get(secondId);
    if (!first || !second) throw new Error('建立关系时找不到人物。');
    const firstDraft = clone(first);
    const secondDraft = clone(second);
    if (kind === 'spouse') linkSpouses(firstDraft, secondDraft);
    else if (kind === 'sibling') linkSiblings(firstDraft, secondDraft);
    else if (kind === 'parentChild') linkParentChild(firstDraft, secondDraft);
    else throw new Error(`未知关系类型：${kind}`);
    commit(firstDraft, `relation:${kind}`);
    commit(secondDraft, `relation:${kind}`);
  }

  function exportState() {
    return {
      schemaVersion: PEOPLE_SCHEMA_VERSION,
      exportedAt: stamp(),
      people: listPeople(people, { sortBy: 'birth' }),
    };
  }

  function importState(rawSnapshot) {
    const snapshot = migrateSnapshot(rawSnapshot);
    if (snapshot?.schemaVersion !== PEOPLE_SCHEMA_VERSION || !Array.isArray(snapshot.people)) {
      throw new Error('人物存档格式不兼容。');
    }
    const draft = new Map();
    snapshot.people.forEach((person) => {
      validatePerson(person);
      draft.set(person.id, clone(person));
    });
    people.clear();
    runtimeCache.clear();
    draft.forEach((person, id) => people.set(id, person));
    eventBus.emit('people:hydrated', { count: people.size });
  }

  function getRuntimeDiagnostics() {
    return {
      mode: headless ? 'headless' : 'safe',
      cacheSize: runtimeCache.size,
      hits: runtimeCacheHits,
      misses: runtimeCacheMisses,
      hitRate: runtimeCacheHits + runtimeCacheMisses > 0
        ? runtimeCacheHits / (runtimeCacheHits + runtimeCacheMisses)
        : 0,
    };
  }

  return Object.freeze({
    create,
    get: (id) => getPerson(people, id),
    getRuntime: (id) => runtimeView(people.get(id)),
    list: (options) => listPeople(people, options),
    getMany: (ids) => getPeopleByIds(people, ids),
    getAlive: () => getAlivePeople(people),
    getAliveRuntime: () => [...people.values()].filter((person) => person.identity.alive).map(runtimeView),
    count: () => people.size,
    connect,
    exportState,
    importState,
    getRuntimeDiagnostics,
    patchState: (id, patch) => transactRuntime(id, 'state:patch', ['state'], (draft) => patchPersonState(draft, patch)).person,
    applyNeedDelta: (id, delta) => transactRuntime(id, 'state:needs', ['state'], (draft) => applyNeedDelta(draft, delta)).person,
    setOccupation: (id, occupation) => transactRuntime(id, 'work:occupation', ['work'], (draft) => setOccupation(draft, occupation)).person,
    setLocation: (id, location) => transactRuntime(id, 'location:set', ['location'], (draft) => setLocation(draft, location)).person,
    setActivity: (id, activity) => transactRuntime(id, 'activity:set', ['activity'], (draft) => setActivity(draft, activity)).person,
    setExtension: (id, namespace, value) => transactRuntime(id, 'extension:set', ['extensions'], (draft) => setExtension(draft, namespace, value)).person,
    addStatusTag: (id, tag) => transactRuntime(id, 'state:status:add', ['state'], (draft) => addStatusTag(draft, tag)).person,
    removeStatusTag: (id, tag) => transactRuntime(id, 'state:status:remove', ['state'], (draft) => removeStatusTag(draft, tag)).person,
    addLifeEvent: (id, event) => transact(id, 'memory:life-event', (draft) => appendLifeEvent(draft, { ...event, time: event.time ?? stamp() })).result,
    addPersonalMemory: (id, memory) => transact(id, 'memory:personal', (draft) => appendPersonalMemory(draft, { ...memory, time: memory.time ?? stamp() })).result,
    addEncounterMemory: (id, memory) => transact(id, 'memory:encounter', (draft) => appendEncounterMemory(draft, { ...memory, time: memory.time ?? stamp() })).result,
    adjustRelation: (id, otherId, patch) => transactRuntime(id, 'relation:adjust', ['relations'], (draft) => adjustRelation(draft, otherId, patch)).person,
    changeItem: (id, itemId, delta) => transactRuntime(id, 'inventory:item', ['inventory'], (draft) => changeItem(draft, itemId, delta)).person,
    equipItem: (id, slot, itemId) => transactRuntime(id, 'inventory:equip', ['inventory'], (draft) => equipItem(draft, slot, itemId)).person,
    addClaim: (id, claim) => transactRuntime(id, 'inventory:claim', ['inventory'], (draft) => addClaim(draft, claim)).person,
    markDead: (id, options = {}) => transact(id, 'lifecycle:death', (draft) => markDead(draft, { ...options, time: options.time ?? stamp() })).person,
  });
}
