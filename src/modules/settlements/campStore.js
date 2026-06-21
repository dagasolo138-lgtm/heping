export const CAMP_ITEM_LABELS = Object.freeze({
  wood: '木材',
  berries: '浆果',
  millet: '粟米',
  water: '清水',
  stone: '石料',
});

const FOOD_ITEM_IDS = new Set(['berries', 'millet']);
const FOOD_STARTING_FRESHNESS = 100;

function clone(value) {
  return structuredClone(value);
}

function normalize(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100) / 100);
}

function normalizeCapacity(value) {
  return Math.max(0, Math.round(Number(value || 0) * 100) / 100);
}

function signedRound(value) {
  return Math.round(Number(value || 0) * 100) / 100;
}

function isFood(itemId) {
  return FOOD_ITEM_IDS.has(itemId);
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

function ensureFoodState(camp) {
  if (!camp.food) {
    camp.food = { batches: [], spoiled: {}, nextBatchNumber: 1 };
  }
  if (!Array.isArray(camp.food.batches)) camp.food.batches = [];
  if (!camp.food.spoiled) camp.food.spoiled = {};
  if (!Number.isFinite(camp.food.nextBatchNumber)) camp.food.nextBatchNumber = 1;
  return camp.food;
}

function createFoodBatch(camp, itemId, amount, stamp) {
  const food = ensureFoodState(camp);
  const batch = {
    id: `food-${itemId}-${food.nextBatchNumber}`,
    itemId,
    amount: normalize(amount),
    freshness: FOOD_STARTING_FRESHNESS,
    acquiredAt: clone(stamp),
    updatedAt: clone(stamp),
  };
  food.nextBatchNumber += 1;
  food.batches.push(batch);
  return batch;
}

function foodBatchesFor(camp, itemId) {
  return ensureFoodState(camp).batches.filter((batch) => batch.itemId === itemId && batch.amount > 0);
}

function consumeFoodBatches(camp, itemId, amount, stamp) {
  let remaining = normalize(amount);
  let consumed = 0;
  const food = ensureFoodState(camp);
  const ordered = food.batches
    .filter((batch) => batch.itemId === itemId && batch.amount > 0)
    .sort((first, second) => first.freshness - second.freshness || first.acquiredAt.tick - second.acquiredAt.tick);

  ordered.forEach((batch) => {
    if (remaining <= 0) return;
    const used = Math.min(remaining, batch.amount);
    batch.amount = normalize(batch.amount - used);
    batch.updatedAt = clone(stamp);
    remaining = normalize(remaining - used);
    consumed = normalize(consumed + used);
  });
  food.batches = food.batches.filter((batch) => batch.amount > 0);
  return consumed;
}

function foodSummary(camp) {
  const food = ensureFoodState(camp);
  const items = {};
  [...FOOD_ITEM_IDS].forEach((itemId) => {
    const batches = foodBatchesFor(camp, itemId);
    const amount = normalize(batches.reduce((sum, batch) => sum + batch.amount, 0));
    const freshness = amount > 0
      ? Math.round(batches.reduce((sum, batch) => sum + batch.amount * batch.freshness, 0) / amount)
      : 0;
    items[itemId] = {
      amount,
      freshness,
      batches: batches.length,
      spoiled: normalize(food.spoiled[itemId]),
    };
  });
  return {
    items,
    totalSpoiled: normalize(Object.values(food.spoiled).reduce((sum, amount) => sum + normalize(amount), 0)),
  };
}

function emitCampChange(eventBus, id, camp, { itemId = null, delta = 0, reason = 'inventory', extra = {} } = {}) {
  eventBus.emit('camp:changed', {
    camp: clone(camp),
    itemId,
    delta,
    reason,
    storage: storageSnapshot(camp),
    food: foodSummary(camp),
    ...extra,
  });
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
    const stamp = gameTime.stamp();
    const normalizedItems = Object.fromEntries(Object.entries(items).map(([key, value]) => [key, normalize(value)]));
    const camp = {
      id,
      label: label ?? id,
      anchor: clone(anchor),
      items: normalizedItems,
      storage: {
        label: storageLabel,
        capacity: normalizeCapacity(capacity),
        protection: 0,
        upgrades: [],
      },
      food: { batches: [], spoiled: {}, nextBatchNumber: 1 },
      createdAt: stamp,
      updatedAt: stamp,
    };
    Object.entries(normalizedItems).forEach(([itemId, amount]) => {
      if (isFood(itemId) && amount > 0) createFoodBatch(camp, itemId, amount, stamp);
    });
    camps.set(id, camp);
    eventBus.emit('camp:created', { camp: get(id), food: foodSummary(camp) });
    return get(id);
  }

  function change(id, itemId, delta, reason = 'inventory') {
    const camp = camps.get(id);
    if (!camp) throw new Error(`找不到营地：${id}`);
    const before = normalize(camp.items[itemId]);
    const requested = Number(delta || 0);
    const deltaLimit = requested > 0 ? storageSnapshot(camp).available : Infinity;
    const actualRequest = requested > 0 ? Math.min(requested, deltaLimit) : requested;
    let actualDelta = 0;

    if (isFood(itemId) && actualRequest < 0) {
      const consumed = consumeFoodBatches(camp, itemId, Math.min(before, -actualRequest), gameTime.stamp());
      actualDelta = -consumed;
    } else {
      const after = normalize(before + actualRequest);
      actualDelta = signedRound(after - before);
      if (isFood(itemId) && actualDelta > 0) createFoodBatch(camp, itemId, actualDelta, gameTime.stamp());
    }

    const after = normalize(before + actualDelta);
    if (after === 0) delete camp.items[itemId];
    else camp.items[itemId] = after;
    camp.updatedAt = gameTime.stamp();
    emitCampChange(eventBus, id, camp, { itemId, delta: actualDelta, reason });
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

  function getFoodSummary(id) {
    const camp = camps.get(id);
    return camp ? foodSummary(camp) : null;
  }

  function ageFood(id, { elapsedMinutes = 0, decayPerMinute = {}, reason = 'food:decay' } = {}) {
    const camp = camps.get(id);
    if (!camp || elapsedMinutes <= 0) return null;
    const food = ensureFoodState(camp);
    const stamp = gameTime.stamp();
    const spoiled = {};
    let changed = false;

    food.batches.forEach((batch) => {
      const rate = Math.max(0, Number(decayPerMinute[batch.itemId] ?? 0));
      if (!rate || batch.amount <= 0) return;
      const beforeFreshness = batch.freshness;
      batch.freshness = Math.max(0, Math.round((batch.freshness - rate * elapsedMinutes) * 100) / 100);
      batch.updatedAt = clone(stamp);
      changed ||= beforeFreshness !== batch.freshness;
    });

    const remaining = [];
    food.batches.forEach((batch) => {
      if (batch.amount > 0 && batch.freshness <= 0) {
        const amount = normalize(batch.amount);
        camp.items[batch.itemId] = normalize(camp.items[batch.itemId] - amount);
        if (camp.items[batch.itemId] <= 0) delete camp.items[batch.itemId];
        food.spoiled[batch.itemId] = normalize(food.spoiled[batch.itemId] + amount);
        spoiled[batch.itemId] = normalize(spoiled[batch.itemId] + amount);
        changed = true;
        return;
      }
      remaining.push(batch);
    });
    food.batches = remaining;

    if (!changed) return { changed: false, spoiled: {}, food: foodSummary(camp) };
    camp.updatedAt = stamp;
    const result = { changed: true, spoiled, food: foodSummary(camp), elapsedMinutes };
    eventBus.emit('camp:food-changed', { camp: get(id), reason, ...clone(result), time: stamp });
    emitCampChange(eventBus, id, camp, { reason, extra: { foodDecay: clone(result) } });
    return result;
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
    emitCampChange(eventBus, id, camp, { reason: 'storage:upgrade' });
    return getStorage(id);
  }

  return Object.freeze({ create, get, list, change, take, getStorage, getFoodSummary, ageFood, applyStorageUpgrade });
}
