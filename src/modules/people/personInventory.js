function normalizeAmount(value) {
  if (!Number.isFinite(value)) throw new Error('物品数量必须是数字。');
  return Math.max(0, Math.round(value * 100) / 100);
}

export function changeItem(person, itemId, delta) {
  if (!itemId) throw new Error('物品必须有 itemId。');
  const next = normalizeAmount((person.inventory.items[itemId] ?? 0) + delta);
  if (next === 0) delete person.inventory.items[itemId];
  else person.inventory.items[itemId] = next;
  return next;
}

export function equipItem(person, slot, itemId) {
  if (!slot) throw new Error('装备必须指定槽位。');
  if (itemId) person.inventory.equipment[slot] = itemId;
  else delete person.inventory.equipment[slot];
}

export function addClaim(person, claim) {
  const id = claim?.id;
  if (!id) throw new Error('所有权声明必须有 id。');
  if (!person.inventory.claims.some((item) => item.id === id)) person.inventory.claims.push(structuredClone(claim));
}
