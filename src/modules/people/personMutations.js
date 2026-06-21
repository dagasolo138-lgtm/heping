const LIMITS = Object.freeze({
  hunger: [0, 100],
  thirst: [0, 100],
  energy: [0, 100],
  health: [0, 100],
  stress: [0, 100],
  mood: [-100, 100],
});

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function patchPersonState(person, patch = {}) {
  for (const [key, value] of Object.entries(patch)) {
    if (!LIMITS[key]) continue;
    const [min, max] = LIMITS[key];
    person.state[key] = clamp(Number(value), min, max);
  }
}

export function setOccupation(person, occupation) {
  person.work.occupation = occupation;
}

export function setLocation(person, patch) {
  person.location = { ...person.location, ...patch };
}

export function setActivity(person, activity = {}) {
  person.activity = { ...person.activity, ...structuredClone(activity) };
}

export function setExtension(person, key, value) {
  if (!key || !key.includes('.')) throw new Error('Invalid extension key.');
  person.extensions[key] = structuredClone(value);
}

export function addStatusTag(person, tag) {
  if (tag && !person.state.statusTags.includes(tag)) person.state.statusTags.push(tag);
}

export function removeStatusTag(person, tag) {
  person.state.statusTags = person.state.statusTags.filter((item) => item !== tag);
}
