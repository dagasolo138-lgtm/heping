import test from 'node:test';
import assert from 'node:assert/strict';

import { createBuildingSystem } from '../src/modules/buildings/buildingSystem.js';

test('建筑检查点保留瞬时预留，普通存档继续剥离预留', () => {
  const events = [];
  const buildings = createBuildingSystem({
    eventBus: { emit: (name, payload) => events.push({ name, payload }) },
    gameTime: { stamp: () => ({ year: 1, day: 1, minute: 480 }) },
  });
  const site = buildings.startConstruction({ typeId: 'communalShelter', anchor: { x: 4, y: 4 } });
  const reservation = buildings.reserveMaterial(site.id, 'wood', 3);
  buildings.beginDelivery(site.id, reservation.id);

  const checkpoint = buildings.createCheckpoint();
  const persisted = buildings.exportState();

  assert.equal(checkpoint.buildings[0].materials.reservations.length, 1);
  assert.equal(checkpoint.buildings[0].materials.reservations[0].state, 'carried');
  assert.equal(persisted.buildings[0].materials.reservations.length, 0);

  buildings.importState(persisted);
  assert.equal(buildings.get(site.id).materials.reservations.length, 0);

  buildings.restoreCheckpoint(checkpoint);
  assert.equal(buildings.get(site.id).materials.reservations.length, 1);
  assert.equal(buildings.get(site.id).materials.reservations[0].state, 'carried');
});
