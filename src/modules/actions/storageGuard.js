export function availableCampStorage(camp, storage) {
  const explicit = Number(storage?.available);
  if (Number.isFinite(explicit)) return Math.max(0, explicit);
  const capacity = Number(camp?.storage?.capacity);
  if (!Number.isFinite(capacity)) return Infinity;
  const used = Object.values(camp?.items ?? {}).reduce((total, value) => total + Math.max(0, Number(value) || 0), 0);
  return Math.max(0, capacity - used);
}
