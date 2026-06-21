function clone(value) {
  return structuredClone(value);
}

export function getPerson(people, id) {
  const person = people.get(id);
  return person ? clone(person) : null;
}

export function listPeople(people, { aliveOnly = false, sortBy = 'name' } = {}) {
  const list = [...people.values()].filter((person) => !aliveOnly || person.identity.alive);
  if (sortBy === 'name') list.sort((a, b) => a.identity.name.localeCompare(b.identity.name, 'zh-CN'));
  if (sortBy === 'birth') list.sort((a, b) => a.identity.birth.year - b.identity.birth.year);
  return clone(list);
}

export function getPeopleByIds(people, ids = []) {
  return ids.map((id) => people.get(id)).filter(Boolean).map(clone);
}

export function getAlivePeople(people) {
  return listPeople(people, { aliveOnly: true });
}
