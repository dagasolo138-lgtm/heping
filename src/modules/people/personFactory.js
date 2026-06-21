import { createId } from '../../core/ids/createId.js';
import { createSkillSet } from '../../data/constants/skills.js';
import { createBlankPerson } from './personSchema.js';
import { validatePerson } from './personValidation.js';

function uniqueStrings(values = []) {
  return [...new Set(values.filter(Boolean))];
}

export function createPerson(input = {}, timeStamp) {
  const person = createBlankPerson();
  const birth = input.identity?.birth ?? input.birth ?? person.identity.birth;

  person.id = input.id ?? createId('person');
  person.identity = {
    ...person.identity,
    ...(input.identity ?? {}),
    birth: { ...person.identity.birth, ...birth },
    portraitSeed: input.identity?.portraitSeed ?? input.portraitSeed ?? person.id,
  };
  person.location = { ...person.location, ...(input.location ?? {}) };
  person.work = {
    ...person.work,
    ...(input.work ?? {}),
    skills: createSkillSet(input.work?.skills ?? input.skills),
    preferences: uniqueStrings(input.work?.preferences ?? input.preferences ?? []),
  };
  person.state = { ...person.state, ...(input.state ?? {}) };
  person.traits = uniqueStrings(input.traits ?? []);
  person.family = { ...person.family, ...(input.family ?? {}) };
  person.relations = structuredClone(input.relations ?? {});
  person.memories = { ...person.memories, ...(input.memories ?? {}) };
  person.inventory = { ...person.inventory, ...(input.inventory ?? {}) };
  person.extensions = structuredClone(input.extensions ?? {});
  person.createdAt = timeStamp;
  person.updatedAt = timeStamp;

  validatePerson(person);
  return person;
}
