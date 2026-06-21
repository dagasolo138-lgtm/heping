export const SECOND_FIELD_EXPANSION = Object.freeze({
  id: 'second-millet-field',
  label: '第二块粟田',
  footprint: Object.freeze({ width: 6, height: 4 }),
  clearingWorkRequired: 10,
  requiredHarvests: 1,
});

const SECOND_FIELD_OFFSETS = Object.freeze([
  { x: 22, y: 17 },
  { x: -27, y: 17 },
  { x: 23, y: -23 },
  { x: -28, y: -24 },
  { x: 8, y: 24 },
  { x: -13, y: 24 },
  { x: 28, y: 4 },
  { x: -33, y: 4 },
]);

export function canPlanSecondField(fields) {
  if (fields.length >= 2 || fields.some((field) => field.id === SECOND_FIELD_EXPANSION.id)) return false;
  const firstField = fields.find((field) => field.id === 'first-millet-field');
  return Number(firstField?.harvestCount ?? 0) >= SECOND_FIELD_EXPANSION.requiredHarvests;
}

export function findSecondFieldAnchor({ campAnchor, isAvailable }) {
  return SECOND_FIELD_OFFSETS
    .map((offset) => ({ x: campAnchor.x + offset.x, y: campAnchor.y + offset.y }))
    .find((candidate) => isAvailable(candidate)) ?? null;
}
