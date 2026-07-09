function clamp01(value) {
  return Math.min(1, Math.max(0, Number(value) || 0));
}

function hasTrait(person, trait) {
  return person.traits?.includes(trait) ? 1 : 0;
}

export function buildDesireModel({ person }) {
  const hunger = clamp01(person.state.hunger / 100);
  const thirst = clamp01(person.state.thirst / 100);
  const fatigue = clamp01((100 - person.state.energy) / 100);
  const stress = clamp01(person.state.stress / 100);
  const healthRisk = clamp01((100 - person.state.health) / 100);

  return Object.freeze({
    personId: person.id,
    needs: Object.freeze({ hunger, thirst, fatigue, stress, healthRisk }),
    traits: Object.freeze({
      diligent: hasTrait(person, 'diligent'),
      generous: hasTrait(person, 'generous'),
      cautious: hasTrait(person, 'cautious'),
      brave: hasTrait(person, 'brave'),
      frugal: hasTrait(person, 'frugal'),
      calm: hasTrait(person, 'calm'),
      lively: hasTrait(person, 'lively'),
      patient: hasTrait(person, 'patient'),
      stubborn: hasTrait(person, 'stubborn'),
      curious: hasTrait(person, 'curious'),
    }),
    work: Object.freeze({
      occupation: person.work.occupation,
      skills: { ...(person.work.skills ?? {}) },
      preferences: [...(person.work.preferences ?? [])],
    }),
  });
}
