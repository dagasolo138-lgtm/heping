import { createPerson } from './personFactory.js';
import { validatePerson } from './personValidation.js';
import { getPerson, listPeople, getPeopleByIds, getAlivePeople } from './personQueries.js';
import { patchPersonState, setOccupation, setLocation, setExtension, addStatusTag, removeStatusTag } from './personMutations.js';
import { applyNeedDelta } from './personState.js';
import { appendLifeEvent, appendPlayerMemory } from './personMemory.js';
import { adjustRelation, linkParentChild, linkSiblings, linkSpouses } from './personRelations.js';
import { changeItem, equipItem, addClaim } from './personInventory.js';
import { markDead } from './personLifecycle.js';
import { PEOPLE_SCHEMA_VERSION } from './personSchema.js';

function clone(value) {
  return structuredClone(value);
}

export function createPeopleSystem({ eventBus, gameTime }) {
  const people = new Map();

  function stamp() {
    return gameTime.stamp();
  }

  function commit(person, reason) {
    validatePerson(person);
    person.revision += 1;
    person.updatedAt = stamp();
    people.set(person.id, person);
    eventBus.emit('people:changed', { reason, person: clone(person) });
    return clone(person);
  }

  function transact(personId, reason, mutator) {
    const original = people.get(personId);
    if (!original) throw new Error(`找不到人物：${personId}`);
    const draft = clone(original);
    const result = mutator(draft);
    return { person: commit(draft, reason), result: clone(result) };
  }

  function create(input) {
    const person = createPerson(input, stamp());
    people.set(person.id, person);
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

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== PEOPLE_SCHEMA_VERSION || !Array.isArray(snapshot.people)) {
      throw new Error('人物存档格式不兼容。');
    }
    const draft = new Map();
    snapshot.people.forEach((person) => {
      validatePerson(person);
      draft.set(person.id, clone(person));
    });
    people.clear();
    draft.forEach((person, id) => people.set(id, person));
    eventBus.emit('people:hydrated', { count: people.size });
  }

  return Object.freeze({
    create,
    get: (id) => getPerson(people, id),
    list: (options) => listPeople(people, options),
    getMany: (ids) => getPeopleByIds(people, ids),
    getAlive: () => getAlivePeople(people),
    count: () => people.size,
    connect,
    exportState,
    importState,
    patchState: (id, patch) => transact(id, 'state:patch', (draft) => patchPersonState(draft, patch)).person,
    applyNeedDelta: (id, delta) => transact(id, 'state:needs', (draft) => applyNeedDelta(draft, delta)).person,
    setOccupation: (id, occupation) => transact(id, 'work:occupation', (draft) => setOccupation(draft, occupation)).person,
    setLocation: (id, location) => transact(id, 'location:set', (draft) => setLocation(draft, location)).person,
    setExtension: (id, namespace, value) => transact(id, 'extension:set', (draft) => setExtension(draft, namespace, value)).person,
    addStatusTag: (id, tag) => transact(id, 'state:status:add', (draft) => addStatusTag(draft, tag)).person,
    removeStatusTag: (id, tag) => transact(id, 'state:status:remove', (draft) => removeStatusTag(draft, tag)).person,
    addLifeEvent: (id, event) => transact(id, 'memory:life-event', (draft) => appendLifeEvent(draft, { ...event, time: event.time ?? stamp() })).result,
    addPlayerMemory: (id, event) => transact(id, 'memory:player-event', (draft) => appendPlayerMemory(draft, { ...event, time: event.time ?? stamp() })).result,
    adjustRelation: (id, otherId, patch) => transact(id, 'relation:adjust', (draft) => adjustRelation(draft, otherId, patch)).person,
    changeItem: (id, itemId, delta) => transact(id, 'inventory:item', (draft) => changeItem(draft, itemId, delta)).person,
    equipItem: (id, slot, itemId) => transact(id, 'inventory:equip', (draft) => equipItem(draft, slot, itemId)).person,
    addClaim: (id, claim) => transact(id, 'inventory:claim', (draft) => addClaim(draft, claim)).person,
    markDead: (id, options = {}) => transact(id, 'lifecycle:death', (draft) => markDead(draft, { ...options, time: options.time ?? stamp() })).person,
  });
}
