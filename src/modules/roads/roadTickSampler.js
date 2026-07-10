function tileOf(person) {
  return { x: Math.round(person.location.tileX), y: Math.round(person.location.tileY) };
}

function sameTile(first, second) {
  return first?.x === second?.x && first?.y === second?.y;
}

export function createRoadTickSampler({ roadSystem, getPeople } = {}) {
  const lastTiles = new Map();

  function sample() {
    const people = getPeople?.() ?? [];
    people.forEach((person) => {
      if (person.location?.tileX === null || person.location?.tileY === null) return;
      const current = tileOf(person);
      const previous = lastTiles.get(person.id);
      if (previous && person.activity?.status === 'moving' && !sameTile(previous, current)) {
        roadSystem.recordTraversal({ personId: person.id, from: previous, to: current });
      }
      lastTiles.set(person.id, current);
    });
  }

  function reset() {
    lastTiles.clear();
  }

  return Object.freeze({ sample, reset });
}
