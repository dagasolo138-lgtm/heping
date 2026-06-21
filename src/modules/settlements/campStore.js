export const CAMP_ITEM_LABELS = Object.freeze({
  wood: '木材',
  berries: '浆果',
  water: '清水',
  stone: '石料',
});

function clone(value) {
  return structuredClone(value);
}

function normalize(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100) / 100);
}

function normalizeCapacity(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100) / 100);
}

function usedCapacity(camp) {
  return normalize(Object.values(camp.items).reduce((sum, amount) => sum + normalize(amount), 0));
}

function storageSnapshot(camp) {
  const used = usedCapacity(camp);
  const capacity = normalizeCapacity(camp.storage.capacity);
  return {
    ...clone(camp.storage),
    used,
    available: normalize(Math.max(0, capacity - used)),
  };
}

export function createCampStore({ eventBus, gameTime }) {
  const camps = new Map();

  function get(id) {
    const camp = camps.get(id);
    return camp ? clone(camp) : null;
  }

  function list() {
    return [...camps.values()].map(clone);
  }

  function create({ id, label, anchor, items = {}, capacity = 24, storageLabel = '营地露天堆放' }) {
    if (!id || camps.has(id)) throw new Error('营地 id 缺失或重复。');
    const camp = {
      id,
      label: label ?? id,
      anchor: clone(anchor),
      items: Object.fromEntries(Object.entries(items).map(([key, value]) => [key, normalize(value)])),
      storage: {
        label: storageLabel,
        capacity: normalizeCapacity(capacity),
        protection: 0,
        upgrades: [],
      },
      createdAt: gameTime.stamp(),
      updatedAt: gameTime.stamp(),
    };
    camps.set(id, camp);
    eventBus.emit('camp:created', { camp: get(id) });
    return get(id);
  }

  function change(id, itemId, delta, reason = 'inventory') {
    const camp = camps.get(id);
    if (!camp) throw new Error(`找不到营地：${id}`);
    const before = normalize(camp.items[itemId]);
    const requested = Number(delta || 0);
    const deltaLimit = requested > 0 ? storageSnapshot(camp).available : Infinity;
    const actualRequest = requested > 0 ? Math.min(requested, deltaLimit) : requested;
    const after = normalize(before + actualRequest);
    const actualDelta = normalize(after - before);
    if (after === 0) delete camp.items[itemId];
    else camp.items[itemId] = after;
    camp.updatedAt = gameTime.stamp();
    eventBus.emit('camp:changed', { camp: get(id), itemId, delta: actualDelta, reason, storage: storageSnapshot(camp) });
    return actualDelta;
  }

  function take(id, itemId, amount, reason = 'consume') {
    const camp = camps.get(id);
    if (!camp) return 0;
    const taken = Math.min(normalize(amount), normalize(camp.items[itemId]));
    if (taken > 0) change(id, itemId, -taken, reason);
    return taken;
  }

  function getStorage(id) {
    const camp = camps.get(id);
    return camp ? storageSnapshot(camp) : null;
  }

  function applyStorageUpgrade(id, { sourceBuildingId, label, capacityDelta = 0, protectionDelta = 0 } = {}) {
    const camp = camps.get(id);
    if (!camp || !sourceBuildingId) return null;
    if (camp.storage.upgrades.some((upgrade) => upgrade.sourceBuildingId === sourceBuildingId)) return getStorage(id);
    const upgrade = {
      sourceBuildingId,
      label: label ?? '储存设施',
      capacityDelta: normalizeCapacity(capacityDelta),
      protectionDelta: normalizeCapacity(protectionDelta),
    };
    camp.storage.upgrades.push(upgrade);
    camp.storage.capacity = normalizeCapacity(camp.storage.capacity + upgrade.capacityDelta);
    camp.storage.protection = normalizeCapacity(Math.min(1, camp.storage.protection + upgrade.protectionDelta));
    camp.storage.label = upgrade.label;
    camp.updatedAt = gameTime.stamp();
    eventBus.emit('camp:changed', { camp: get(id), itemId: null, delta: 0, reason: 'storage:upgrade', storage: storageSnapshot(camp) });
    return getStorage(id);
  }

  return Object.freeze({ create, get, list, change, take, getStorage, applyStorageUpgrade });
}
