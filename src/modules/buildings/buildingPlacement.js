import { getBuildingType } from './buildingCatalog.js';

function isFootprintWalkable(mapSystem, anchor, footprint) {
  for (let y = anchor.y; y < anchor.y + footprint.height; y += 1) {
    for (let x = anchor.x; x < anchor.x + footprint.width; x += 1) {
      if (!mapSystem.isWalkable(x, y)) return false;
    }
  }
  return true;
}

export function findInitialShelterPlacement({ mapSystem, campAnchor }) {
  const type = getBuildingType('communalShelter');
  const candidates = [
    { x: campAnchor.x + 8, y: campAnchor.y - 9 },
    { x: campAnchor.x - 15, y: campAnchor.y - 8 },
    { x: campAnchor.x + 8, y: campAnchor.y + 7 },
    { x: campAnchor.x - 15, y: campAnchor.y + 7 },
  ];
  return candidates.find((anchor) => isFootprintWalkable(mapSystem, anchor, type.footprint)) ?? null;
}

export function buildingCenter(building) {
  return {
    x: building.anchor.x + building.footprint.width / 2,
    y: building.anchor.y + building.footprint.height / 2,
  };
}
