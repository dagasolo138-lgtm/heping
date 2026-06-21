const CAMP_OFFSETS = Object.freeze([
  { x: -3, y: -2 }, { x: 0, y: -3 }, { x: 3, y: -2 }, { x: -4, y: 1 }, { x: -1, y: 1 },
  { x: 2, y: 1 }, { x: 5, y: 1 }, { x: -3, y: 4 }, { x: 1, y: 4 }, { x: 4, y: 4 },
]);

export function placeStartingSettlers({ peopleSystem, map }) {
  const people = peopleSystem.list({ sortBy: 'birth' });
  people.forEach((person, index) => {
    const offset = CAMP_OFFSETS[index % CAMP_OFFSETS.length];
    peopleSystem.setLocation(person.id, {
      regionId: map.regionId,
      tileX: map.spawnPoint.x + offset.x,
      tileY: map.spawnPoint.y + offset.y,
      homeId: null,
    });
  });
  return peopleSystem.list({ sortBy: 'birth' });
}
