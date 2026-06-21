import { getBuildingType } from './buildingCatalog.js';

function isFootprintWalkable(mapSystem, anchor, footprint) {
  for (let y = anchor.y; y < anchor.y + footprint.height; y += 1) {
    for (let x = anchor.x; x < anchor.x + footprint.width; x += 1) {
      if (!mapSystem.isWalkable(x, y)) return false;
    }
  }
  return true;
}

function overlaps(firstAnchor, firstFootprint, secondAnchor, secondFootprint) {
  return firstAnchor.x < secondAnchor.x + secondFootprint.width
    && firstAnchor.x + firstFootprint.width > secondAnchor.x
    && firstAnchor.y < secondAnchor.y + secondFootprint.height
    && firstAnchor.y + firstFootprint.height > secondAnchor.y;
}

function isFootprintClear(mapSystem, anchor, footprint, buildings = []) {
  if (!isFootprintWalkable(mapSystem, anchor, footprint)) return false;
  return !buildings.some((building) => overlaps(anchor, footprint, building.anchor, building.footprint));
}

function findPlacement({ typeId, mapSystem, campAnchor, buildings = [], candidates }) {
  const type = getBuildingType(typeId);
  return candidates.find((anchor) => isFootprintClear(mapSystem, anchor, type.footprint, buildings)) ?? null;
}

export function findInitialShelterPlacement({ mapSystem, campAnchor, buildings = [] }) {
  return findPlacement({
    typeId: 'communalShelter',
    mapSystem,
    campAnchor,
    buildings,
    candidates: [
      { x: campAnchor.x + 8, y: campAnchor.y - 9 },
      { x: campAnchor.x - 15, y: campAnchor.y - 8 },
      { x: campAnchor.x + 8, y: campAnchor.y + 7 },
      { x: campAnchor.x - 15, y: campAnchor.y + 7 },
    ],
  });
}

export function findStorageShedPlacement({ mapSystem, campAnchor, buildings = [] }) {
  return findPlacement({
    typeId: 'storageShed',
    mapSystem,
    campAnchor,
    buildings,
    candidates: [
      { x: campAnchor.x - 9, y: campAnchor.y + 6 },
      { x: campAnchor.x + 10, y: campAnchor.y + 7 },
      { x: campAnchor.x - 9, y: campAnchor.y - 8 },
      { x: campAnchor.x + 10, y: campAnchor.y - 8 },
      { x: campAnchor.x - 4, y: campAnchor.y + 10 },
    ],
  });
}

export function buildingCenter(building) {
  return {
    x: building.anchor.x + building.footprint.width / 2,
    y: building.anchor.y + building.footprint.height / 2,
  };
}
