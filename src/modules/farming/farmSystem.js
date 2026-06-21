import { TERRAIN } from '../../data/constants/terrain.js';
import { cropGrowthMultiplier, getCropType } from './cropCatalog.js';

const FIELD_FOOTPRINT = Object.freeze({ width: 6, height: 4 });
const CLEARING_WORK_REQUIRED = 8;

function clone(value) {
  return structuredClone(value);
}

function inside(point, area) {
  return point.x >= area.anchor.x
    && point.x < area.anchor.x + area.footprint.width
    && point.y >= area.anchor.y
    && point.y < area.anchor.y + area.footprint.height;
}

function allTiles(field) {
  const tiles = [];
  for (let y = field.anchor.y; y < field.anchor.y + field.footprint.height; y += 1) {
    for (let x = field.anchor.x; x < field.anchor.x + field.footprint.width; x += 1) tiles.push({ x, y });
  }
  return tiles;
}

function fieldCenter(field) {
  return {
    x: field.anchor.x + field.footprint.width / 2,
    y: field.anchor.y + field.footprint.height / 2,
  };
}

function eligibleTerrain(terrain) {
  return terrain === TERRAIN.GRASS || terrain === TERRAIN.TALL_GRASS;
}

export function createFarmSystem({ eventBus, gameTime, mapSystem, buildingSystem }) {
  const fields = new Map();
  let seedStock = 2;

  function listFields() {
    return [...fields.values()].map(clone);
  }

  function get(fieldId) {
    const field = fields.get(fieldId);
    return field ? clone(field) : null;
  }

  function getSummary() {
    const list = [...fields.values()];
    return {
      total: list.length,
      clearing: list.filter((field) => field.status === 'clearing' || field.status === 'planned').length,
      growing: list.filter((field) => field.status === 'growing').length,
      mature: list.filter((field) => field.status === 'mature').length,
      seedStock,
    };
  }

  function emit(reason, field = null) {
    eventBus.emit('farms:changed', {
      reason,
      field: field ? clone(field) : null,
      fields: listFields(),
      summary: getSummary(),
      time: gameTime.stamp(),
    });
  }

  function overlapsAny(anchor, footprint) {
    const points = allTiles({ anchor, footprint });
    return points.some((point) => {
      if (fields.size && [...fields.values()].some((field) => inside(point, field))) return true;
      if (buildingSystem.list().some((building) => inside(point, building))) return true;
      const tile = mapSystem.getTile(point.x, point.y);
      return !tile || !eligibleTerrain(tile.terrain) || tile.features.length > 0;
    });
  }

  function candidateAnchors(campAnchor) {
    return [
      { x: campAnchor.x - 18, y: campAnchor.y + 12 },
      { x: campAnchor.x + 13, y: campAnchor.y + 13 },
      { x: campAnchor.x - 19, y: campAnchor.y - 17 },
      { x: campAnchor.x + 14, y: campAnchor.y - 18 },
      { x: campAnchor.x - 6, y: campAnchor.y + 16 },
      { x: campAnchor.x + 4, y: campAnchor.y + 17 },
    ];
  }

  function ensureFirstField({ campAnchor }) {
    if (fields.size || !buildingSystem.completedByType('storageShed')) return null;
    const anchor = candidateAnchors(campAnchor).find((candidate) => !overlapsAny(candidate, FIELD_FOOTPRINT));
    if (!anchor) return null;
    const field = {
      id: 'first-millet-field',
      label: '第一块粟田',
      anchor,
      footprint: clone(FIELD_FOOTPRINT),
      cropId: 'millet',
      status: 'planned',
      clearing: { required: CLEARING_WORK_REQUIRED, completed: 0 },
      growth: { progressed: 0, required: getCropType('millet').growthRequiredMinutes, lastTick: Number(gameTime.now().tick ?? 0) },
      plantedAt: null,
      matureAt: null,
      harvestCount: 0,
      createdAt: gameTime.stamp(),
      updatedAt: gameTime.stamp(),
    };
    fields.set(field.id, field);
    emit('field:planned', field);
    return get(field.id);
  }

  function nextWorkField() {
    const priority = ['mature', 'readyToSow', 'planned', 'clearing'];
    for (const status of priority) {
      const field = [...fields.values()].find((item) => item.status === status);
      if (field) return clone(field);
    }
    return null;
  }

  function clearField(fieldId, workAmount) {
    const field = fields.get(fieldId);
    if (!field || (field.status !== 'planned' && field.status !== 'clearing')) return null;
    field.status = 'clearing';
    field.clearing.completed = Math.min(field.clearing.required, field.clearing.completed + Math.max(0, Number(workAmount ?? 0)));
    field.updatedAt = gameTime.stamp();
    if (field.clearing.completed >= field.clearing.required) {
      mapSystem.setTerrainBatch(allTiles(field), TERRAIN.FARMLAND, 'farm:cleared');
      field.status = 'readyToSow';
      emit('field:cleared', field);
    } else {
      emit('field:clearing', field);
    }
    return get(fieldId);
  }

  function sow(fieldId) {
    const field = fields.get(fieldId);
    if (!field || field.status !== 'readyToSow' || seedStock < 1) return null;
    const crop = getCropType(field.cropId);
    seedStock -= crop.seedsPerPlanting;
    field.status = 'growing';
    field.growth.progressed = 0;
    field.growth.lastTick = Number(gameTime.now().tick ?? 0);
    field.plantedAt = gameTime.stamp();
    field.updatedAt = gameTime.stamp();
    emit('field:sown', field);
    return get(fieldId);
  }

  function harvest(fieldId) {
    const field = fields.get(fieldId);
    if (!field || field.status !== 'mature') return null;
    const crop = getCropType(field.cropId);
    const result = {
      itemId: crop.itemId,
      amount: crop.harvestYield,
      seedReturn: crop.seedReturn,
      label: crop.label,
    };
    seedStock += crop.seedReturn;
    field.status = 'readyToSow';
    field.growth.progressed = 0;
    field.growth.lastTick = Number(gameTime.now().tick ?? 0);
    field.harvestCount += 1;
    field.updatedAt = gameTime.stamp();
    emit('field:harvested', field);
    return result;
  }

  function syncGrowth(weather) {
    const nowTick = Number(gameTime.now().tick ?? 0);
    let changed = false;
    fields.forEach((field) => {
      if (field.status !== 'growing') return;
      const elapsed = Math.max(0, nowTick - Number(field.growth.lastTick ?? nowTick));
      if (!elapsed) return;
      field.growth.progressed = Math.min(field.growth.required, field.growth.progressed + elapsed * cropGrowthMultiplier(weather));
      field.growth.lastTick = nowTick;
      field.updatedAt = gameTime.stamp();
      if (field.growth.progressed >= field.growth.required) {
        field.status = 'mature';
        field.matureAt = gameTime.stamp();
        eventBus.emit('farms:matured', { field: clone(field), time: gameTime.stamp() });
      }
      changed = true;
    });
    if (changed) emit('field:growing');
    return getSummary();
  }

  eventBus.on('simulation:time', ({ weather }) => { syncGrowth(weather); });

  return Object.freeze({
    ensureFirstField,
    nextWorkField,
    clearField,
    sow,
    harvest,
    syncGrowth,
    get,
    listFields,
    getSummary,
    getFieldCenter: (field) => fieldCenter(field),
  });
}
