import { createSkillSet } from '../../data/constants/skills.js';

export const PEOPLE_SCHEMA_VERSION = 2;

export function createBlankPerson() {
  return {
    schemaVersion: PEOPLE_SCHEMA_VERSION,
    id: '',
    revision: 1,
    identity: {
      name: '',
      gender: 'unspecified',
      portraitSeed: '',
      birth: { year: 1, day: 1 },
      alive: true,
      death: null,
    },
    location: {
      regionId: 'starting-valley',
      tileX: null,
      tileY: null,
      homeId: null,
    },
    work: {
      occupation: 'unassigned',
      skills: createSkillSet(),
      preferences: [],
    },
    state: {
      hunger: 20,
      thirst: 20,
      energy: 100,
      health: 100,
      mood: 0,
      stress: 0,
      bodyTemperature: 36.8,
      injuries: [],
      statusTags: [],
    },
    traits: [],
    family: {
      parentIds: [],
      childIds: [],
      spouseId: null,
      siblingIds: [],
    },
    relations: {},
    memories: {
      lifeEvents: [],
      personal: [],
      recent: [],
    },
    inventory: {
      items: {},
      equipment: {},
      ownedResources: {},
      claims: [],
    },
    extensions: {},
    createdAt: null,
    updatedAt: null,
  };
}
