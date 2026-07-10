import { createId } from '../../core/ids/createId.js';
import { BUILDING_SCHEMA_VERSION, createConstructionSite } from './buildingSchema.js';
import { getBuildingType } from './buildingCatalog.js';

function clone(value) {
  return structuredClone(value);
}

function materialNeeded(site, itemId) {
  const required = Number(site.materials.required[itemId] ?? 0);
  const delivered = Number(site.materials.delivered[itemId] ?? 0);
  const reserved = site.materials.reservations
    .filter((reservation) => reservation.itemId === itemId)
    .reduce((sum, reservation) => sum + reservation.amount, 0);
  return Math.max(0, required - delivered - reserved);
}

function materialsReady(site) {
  return Object.keys(site.materials.required)
    .every((itemId) => Number(site.materials.delivered[itemId] ?? 0) >= Number(site.materials.required[itemId] ?? 0));
}

function withoutTransientReservations(building) {
  const snapshot = clone(building);
  snapshot.materials = {
    ...snapshot.materials,
    reservations: [],
  };
  return snapshot;
}

export function createBuildingSystem({ eventBus, gameTime }) {
  const buildings = new Map();

  function emit(reason, building) {
    eventBus.emit('buildings:changed', { reason, building: clone(building), buildings: list() });
  }

  function get(id) {
    const building = buildings.get(id);
    return building ? clone(building) : null;
  }

  function list({ includeCompleted = true } = {}) {
    return [...buildings.values()]
      .filter((building) => includeCompleted || building.status !== 'complete')
      .map(clone);
  }

  function startConstruction({ typeId, anchor }) {
    const building = createConstructionSite({ typeId, anchor, createdAt: gameTime.stamp() });
    buildings.set(building.id, building);
    emit('construction:started', building);
    return get(building.id);
  }

  function activeByType(typeId) {
    return list().find((building) => building.typeId === typeId && building.status !== 'complete') ?? null;
  }

  function completedByType(typeId) {
    return list().find((building) => building.typeId === typeId && building.status === 'complete') ?? null;
  }

  function getResidenceFor(personId) {
    return list().find((building) => building.status === 'complete'
      && building.capacity > 0
      && building.occupants.includes(personId)) ?? null;
  }

  function reserveMaterial(buildingId, itemId, desiredAmount) {
    const building = buildings.get(buildingId);
    if (!building || building.status === 'complete') return null;
    const available = materialNeeded(building, itemId);
    const amount = Math.min(Math.max(0, Number(desiredAmount ?? 0)), available);
    if (!amount) return null;
    const reservation = {
      id: createId('material'),
      itemId,
      amount,
      state: 'reserved',
    };
    building.materials.reservations.push(reservation);
    emit('materials:reserved', building);
    return clone(reservation);
  }

  function beginDelivery(buildingId, reservationId) {
    const building = buildings.get(buildingId);
    const reservation = building?.materials.reservations.find((item) => item.id === reservationId);
    if (!reservation || reservation.state !== 'reserved') return null;
    reservation.state = 'carried';
    emit('materials:carried', building);
    return clone(reservation);
  }

  function cancelReservation(buildingId, reservationId) {
    const building = buildings.get(buildingId);
    if (!building) return false;
    const index = building.materials.reservations.findIndex((item) => item.id === reservationId);
    if (index === -1) return false;
    building.materials.reservations.splice(index, 1);
    emit('materials:reservation-cancelled', building);
    return true;
  }

  function deliverReservation(buildingId, reservationId, actualAmount) {
    const building = buildings.get(buildingId);
    if (!building) return null;
    const index = building.materials.reservations.findIndex((item) => item.id === reservationId);
    if (index === -1) return null;
    const reservation = building.materials.reservations[index];
    const amount = Math.min(Number(actualAmount ?? 0), reservation.amount);
    building.materials.reservations.splice(index, 1);
    building.materials.delivered[reservation.itemId] = Math.min(
      Number(building.materials.required[reservation.itemId] ?? 0),
      Number(building.materials.delivered[reservation.itemId] ?? 0) + amount,
    );
    if (materialsReady(building) && building.status === 'planned') building.status = 'building';
    emit('materials:delivered', building);
    return { building: get(buildingId), itemId: reservation.itemId, amount };
  }

  function addWork(buildingId, amount) {
    const building = buildings.get(buildingId);
    if (!building || !materialsReady(building) || building.status === 'complete') return null;
    building.status = 'building';
    building.work.completed = Math.min(building.work.required, building.work.completed + Math.max(0, Number(amount ?? 0)));
    const completed = building.work.completed >= building.work.required;
    if (completed) {
      building.status = 'complete';
      building.completedAt = gameTime.stamp();
      eventBus.emit('buildings:completed', { building: get(buildingId) });
    }
    emit(completed ? 'construction:completed' : 'construction:work', building);
    return { building: get(buildingId), completed };
  }

  function assignOccupants(buildingId, personIds) {
    const building = buildings.get(buildingId);
    if (!building || building.status !== 'complete') return null;
    building.occupants = [...new Set(personIds)].slice(0, building.capacity || personIds.length);
    emit('occupancy:assigned', building);
    return get(buildingId);
  }

  function getMaterialNeed(buildingId) {
    const building = buildings.get(buildingId);
    if (!building) return null;
    const result = {};
    Object.keys(building.materials.required).forEach((itemId) => { result[itemId] = materialNeeded(building, itemId); });
    return result;
  }

  function getConstructionSummary(buildingId) {
    const building = buildings.get(buildingId);
    if (!building) return null;
    const type = getBuildingType(building.typeId);
    return {
      ...get(buildingId),
      description: type.description,
      materialsReady: materialsReady(building),
      materialNeed: getMaterialNeed(buildingId),
      progress: building.work.required ? building.work.completed / building.work.required : 1,
    };
  }

  function exportState() {
    return {
      schemaVersion: BUILDING_SCHEMA_VERSION,
      exportedAt: gameTime.stamp(),
      buildings: list().map(withoutTransientReservations),
    };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== BUILDING_SCHEMA_VERSION || !Array.isArray(snapshot.buildings)) {
      throw new Error('建筑存档格式不兼容。');
    }
    const next = new Map();
    snapshot.buildings.forEach((building) => {
      if (!building?.id) throw new Error('建筑存档缺少 id。');
      next.set(building.id, withoutTransientReservations(building));
    });
    buildings.clear();
    next.forEach((building, id) => buildings.set(id, building));
    eventBus.emit('buildings:hydrated', { buildings: list(), time: gameTime.stamp() });
    emit('buildings:hydrated', list()[0] ?? null);
    return list();
  }

  return Object.freeze({
    get,
    list,
    startConstruction,
    activeByType,
    completedByType,
    getResidenceFor,
    reserveMaterial,
    beginDelivery,
    cancelReservation,
    deliverReservation,
    addWork,
    assignOccupants,
    getMaterialNeed,
    getConstructionSummary,
    exportState,
    importState,
  });
}
