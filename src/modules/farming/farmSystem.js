import { TERRAIN } from '../../data/constants/terrain.js';
import { cropGrowthMultiplier, getCropType } from './cropCatalog.js';
import { SECOND_FIELD_EXPANSION, canPlanSecondField, findSecondFieldAnchor } from './fieldExpansionPlanner.js';
import { SOIL_LIMITS, createSoil, depleteSoil, describeSoil, recoverSoil, soilGrowthMultiplier, soilYieldMultiplier } from './soilModel.js';

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

function isResting(field) {
  return field.status === 'planned' || field.status === 'clearing' || field.status === 'readyToSow';
}

export function createFarmSystem({ eventBus, gameTime, mapSystem, buildingSystem, seasonSystem = null }) {
  const fields = new Map();
  let seedStock = 2;

  function getSeason() {
    return seasonSystem?.get?.() ?? null;
  }

  function getCropRule(cropId) {
    return seasonSystem?.getCropRule?.(cropId) ?? { canSow: true, growthMultiplier: 1, waitingLabel: '可播种' };
  }

  function fieldSeasonalState(field) {
    const season = getSeason();
    const rule = getCropRule(field.cropId);
    if (field.status === 'readyToSow') {
      return rule.canSow
        ? { id: 'sowable', label: '可播种', seasonId: season?.id ?? null }
        : { id: 'waiting-spring', label: rule.waitingLabel ?? '等待春播', seasonId: season?.id ?? null };
    }
    if (field.status === 'growing' && Number(rule.growthMultiplier) <= 0) {
      return { id: 'dormant', label: '冬季停长', seasonId: season?.id ?? null };
    }
    if (field.status === 'growing') return { id: 'growing', label: '生长中', seasonId: season?.id ?? null };
    if (field.status === 'mature') return { id: 'mature', label: '成熟待收', seasonId: season?.id ?? null };
    if (field.status === 'clearing') return { id: 'clearing', label: '开垦中', seasonId: season?.id ?? null };
    return { id: 'planned', label: '待开垦', seasonId: season?.id ?? null };
  }

  function viewField(field) {
    return clone({ ...field, soil: describeSoil(field.soil), seasonal: fieldSeasonalState(field) });
  }

  function listFields() {
    return [...fields.values()].map(viewField);
  }

  function get(fieldId) {
    const field = fields.get(fieldId);
    return field ? viewField(field) : null;
  }

  function getSummary() {
    const list = [...fields.values()];
    const readyToSow = list.filter((field) => field.status === 'readyToSow');
    const firstField = list.find((field) => field.id === 'first-millet-field') ?? null;
    const secondField = list.find((field) => field.id === SECOND_FIELD_EXPANSION.id) ?? null;
    const soilValues = list.map((field) => Number(field.soil?.fertility ?? SOIL_LIMITS.initialFertility));
    const averageFertility = soilValues.length ? Math.round(soilValues.reduce((total, value) => total + value, 0) / soilValues.length) : null;
    return {
      total: list.length,
      clearing: list.filter((field) => field.status === 'clearing' || field.status === 'planned').length,
      growing: list.filter((field) => field.status === 'growing').length,
      mature: list.filter((field) => field.status === 'mature').length,
      readyToSow: readyToSow.length,
      sowable: readyToSow.filter((field) => getCropRule(field.cropId).canSow).length,
      waitingToSow: readyToSow.filter((field) => !getCropRule(field.cropId).canSow).length,
      expanding: list.filter((field) => field.origin === 'manual-expansion' && (field.status === 'planned' || field.status === 'clearing')).length,
      expansionUnlocked: Number(firstField?.harvestCount ?? 0) >= SECOND_FIELD_EXPANSION.requiredHarvests,
      expansionAvailable: canPlanSecondField(list),
      secondFieldStatus: secondField?.status ?? null,
      soil: {
        averageFertility,
        poorFields: list.filter((field) => Number(field.soil?.fertility ?? SOIL_LIMITS.initialFertility) < 55).length,
        thinFields: list.filter((field) => Number(field.soil?.fertility ?? SOIL_LIMITS.initialFertility) < 30).length,
      },
      seedStock,
      season: getSeason(),
    };
  }

  function emit(reason, field = null) {
    eventBus.emit('farms:changed', {
      reason,
      field: field ? viewField(field) : null,
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

  function createField({ id, label, anchor, footprint, clearingWorkRequired, origin, expansion = null }) {
    const stamp = gameTime.stamp();
    const tick = Number(gameTime.now().tick ?? 0);
    return {
      id,
      label,
      anchor,
      footprint: clone(footprint),
      cropId: 'millet',
      origin,
      expansion,
      status: 'planned',
      clearing: { required: clearingWorkRequired, completed: 0 },
      soil: createSoil(tick),
      growth: { progressed: 0, required: getCropType('millet').growthRequiredMinutes, lastTick: tick },
      plantedAt: null,
      matureAt: null,
      harvestCount: 0,
      createdAt: stamp,
      updatedAt: stamp,
    };
  }

  function ensureFirstField({ campAnchor }) {
    if (fields.size || !buildingSystem.completedByType('storageShed')) return null;
    const anchor = candidateAnchors(campAnchor).find((candidate) => !overlapsAny(candidate, FIELD_FOOTPRINT));
    if (!anchor) return null;
    const field = createField({
      id: 'first-millet-field',
      label: '第一块粟田',
      anchor,
      footprint: FIELD_FOOTPRINT,
      clearingWorkRequired: CLEARING_WORK_REQUIRED,
      origin: 'initial',
    });
    fields.set(field.id, field);
    emit('field:planned', field);
    return get(field.id);
  }

  function ensureExpansionField({ campAnchor }) {
    const list = [...fields.values()];
    if (!buildingSystem.completedByType('storageShed') || !canPlanSecondField(list)) return null;
    const anchor = findSecondFieldAnchor({
      campAnchor,
      isAvailable: (candidate) => !overlapsAny(candidate, SECOND_FIELD_EXPANSION.footprint),
    });
    if (!anchor) return null;
    const firstField = fields.get('first-millet-field');
    const field = createField({
      id: SECOND_FIELD_EXPANSION.id,
      label: SECOND_FIELD_EXPANSION.label,
      anchor,
      footprint: SECOND_FIELD_EXPANSION.footprint,
      clearingWorkRequired: SECOND_FIELD_EXPANSION.clearingWorkRequired,
      origin: 'manual-expansion',
      expansion: {
        unlockedByFieldId: firstField.id,
        unlockedAtHarvest: firstField.harvestCount,
      },
    });
    fields.set(field.id, field);
    emit('field:expansion-planned', field);
    return get(field.id);
  }

  function nextWorkField() {
    const mature = [...fields.values()].find((field) => field.status === 'mature');
    if (mature) return viewField(mature);
    const sowable = [...fields.values()].find((field) => field.status === 'readyToSow' && getCropRule(field.cropId).canSow);
    if (sowable) return viewField(sowable);
    const clearing = [...fields.values()].find((field) => field.status === 'planned' || field.status === 'clearing');
    return clearing ? viewField(clearing) : null;
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
    const rule = field ? getCropRule(field.cropId) : null;
    if (!field || field.status !== 'readyToSow' || !rule?.canSow || seedStock < 1) return null;
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
    const soilBefore = describeSoil(field.soil);
    const amount = Math.max(3, Math.round(crop.harvestYield * soilYieldMultiplier(field.soil)));
    const soil = depleteSoil(field.soil, crop.soilDepletion ?? SOIL_LIMITS.harvestDepletion);
    const result = {
      itemId: crop.itemId,
      amount,
      seedReturn: crop.seedReturn,
      label: crop.label,
      soilBefore,
      soil,
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

  function syncSoil(nowTick) {
    let changed = false;
    fields.forEach((field) => {
      if (!field.soil) field.soil = createSoil(nowTick);
      const lastTick = Number(field.soil.lastTick ?? nowTick);
      const elapsed = Math.max(0, nowTick - lastTick);
      if (elapsed && recoverSoil(field.soil, elapsed, isResting(field))) {
        field.updatedAt = gameTime.stamp();
        changed = true;
      }
      field.soil.lastTick = nowTick;
    });
    return changed;
  }

  function syncGrowth(weather) {
    const nowTick = Number(gameTime.now().tick ?? 0);
    const soilChanged = syncSoil(nowTick);
    let growthChanged = false;
    fields.forEach((field) => {
      if (field.status !== 'growing') return;
      const elapsed = Math.max(0, nowTick - Number(field.growth.lastTick ?? nowTick));
      if (!elapsed) return;
      const rule = getCropRule(field.cropId);
      const multiplier = cropGrowthMultiplier(weather)
        * Math.max(0, Number(rule.growthMultiplier ?? 1))
        * soilGrowthMultiplier(field.soil);
      field.growth.progressed = Math.min(field.growth.required, field.growth.progressed + elapsed * multiplier);
      field.growth.lastTick = nowTick;
      field.updatedAt = gameTime.stamp();
      if (field.growth.progressed >= field.growth.required) {
        field.status = 'mature';
        field.matureAt = gameTime.stamp();
        eventBus.emit('farms:matured', { field: viewField(field), time: gameTime.stamp() });
      }
      growthChanged = true;
    });
    if (growthChanged || soilChanged) emit(growthChanged ? 'field:growing' : 'soil:recovered');
    return getSummary();
  }

  eventBus.on('simulation:time', ({ weather }) => { syncGrowth(weather); });
  eventBus.on('seasons:changed', () => emit('season:changed'));

  return Object.freeze({
    ensureFirstField,
    ensureExpansionField,
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
