import { appendLifeEvent } from './personMemory.js';

export function getAge(person, currentTime) {
  const birth = person.identity.birth;
  const years = currentTime.year - birth.year;
  const beforeBirthday = currentTime.day < birth.day;
  return Math.max(0, years - (beforeBirthday ? 1 : 0));
}

export function markDead(person, { time, cause = 'unknown', summary } = {}) {
  if (!person.identity.alive) return false;
  person.identity.alive = false;
  person.identity.death = { time: structuredClone(time), cause };
  person.state.health = 0;
  person.state.statusTags = [...new Set([...person.state.statusTags, 'dead'])];
  appendLifeEvent(person, {
    type: 'death',
    summary: summary ?? `${person.identity.name} 于${time.label}去世。`,
    time,
    details: { cause },
  });
  return true;
}
