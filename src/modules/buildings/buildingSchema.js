import { createId } from '../../core/ids/createId.js';
import { getBuildingType } from './buildingCatalog.js';

export const BUILDING_SCHEMA_VERSION = 1;

function zeroedMaterials(materials) {
  return Object.fromEntries(Object.keys(materials).map((itemId) => [itemId, 0]));
}

export function createConstructionSite({ typeId, anchor, createdAt }) {
  const type = getBuildingType(typeId);
  return {
    schemaVersion: BUILDING_SCHEMA_VERSION,
    id: createId('building'),
    typeId,
    label: type.label,
    status: 'planned',
    anchor: { x: Math.round(anchor.x), y: Math.round(anchor.y) },
    footprint: { ...type.footprint },
    materials: {
      required: { ...type.materials },
      delivered: zeroedMaterials(type.materials),
      reservations: [],
    },
    work: { required: type.workRequired, completed: 0 },
    occupants: [],
    capacity: type.capacity,
    effects: { ...type.effects },
    createdAt,
    completedAt: null,
  };
}
