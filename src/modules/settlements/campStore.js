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

export function createCampStore({ eventBus, gameTime }) {
  const camps = new Map();

  function get(id) {
    const camp = camps.get(id);
    return camp ? clone(camp) : null;
  }

  function list() {
    return [...camps.values()].map(clone);
  }

  function create({ id, label, anchor, items = {} }) {
    if (!id || camps.has(id)) throw new Error('营地 id 缺失或重复。');
    const camp = {
      id,
      label: label ?? id,
      anchor: clone(anchor),
      items: Object.fromEntries(Object.entries(items).map(([key, value]) => [key, normalize(value)])),
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
    const after = normalize(before + Number(delta || 0));
    const actualDelta = after - before;
    if (after === 0) delete camp.items[itemId];
    else camp.items[itemId] = after;
    camp.updatedAt = gameTime.stamp();
    eventBus.emit('camp:changed', { camp: get(id), itemId, delta: actualDelta, reason });
    return actualDelta;
  }

  function take(id, itemId, amount, reason = 'consume') {
    const camp = camps.get(id);
    if (!camp) return 0;
    const taken = Math.min(normalize(amount), normalize(camp.items[itemId]));
    if (taken > 0) change(id, itemId, -taken, reason);
    return taken;
  }

  return Object.freeze({ create, get, list, change, take });
}
