import { TERRAIN } from '../../data/constants/terrain.js';
import { cropGrowthMultiplier, getCropType } from './cropCatalog.js';
import { SECOND_FIELD_EXPANSION, canPlanSecondField, findSecondFieldAnchor } from './fieldExpansionPlanner.js';
import { buildSeedStockTarget, splitMilletHarvest, verifyHarvestSplit } from './seedPolicy.js';
import { SOIL_LIMITS, createSoil, depleteSoil, describeSoil, recoverSoil, soilGrowthMultiplier, soilYieldMultiplier } from './soilModel.js';

export const FARM_SCHEMA_VERSION = 2;
export const FARM_SEED_CARGO_RESERVATION_TYPE = 'farm-seed-cargo';

const FIELD_FOOTPRINT = Object.freeze({ width: 6, height: 4 });
const CLEARING_WORK_REQUIRED = 8;
const INITIAL_MILLET_SEEDS = 2;
const DEFAULT_CAMP_ID = 'starting-camp';

function clone(value) {
  return structuredClone(value);
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
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

function distance(first, second) {
  return Math.hypot(Number(first?.x ?? first?.tileX ?? 0) - Number(second?.x ?? second?.tileX ?? 0), Number(first?.y ?? first?.tileY ?? 0) - Number(second?.y ?? second?.tileY ?? 0));
}

function seedReservationId(taskId) {
  return `${taskId}:millet-seed-cargo`;
}

export function createFarmSystem({ eventBus, gameTime, mapSystem, buildingSystem, seasonSystem = null, campId = DEFAULT_CAMP_ID }) {
  const fields = new Map();
  let initialSeedsProvisioned = false;
  let pendingLegacySeedStock = 0;

  function runtime() {
    return globalThis.shengling ?? {};
  }

  function seedDependencies() {
    const current = runtime();
    return {
      campStore: current.campStore ?? null,
      peopleSystem: current.peopleSystem ?? null,
      reservationLedger: current.reservationLedger ?? current.actionSystem?.getReservationLedger?.() ?? null,
    };
  }

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

  function seedAmounts() {
    const { campStore, peopleSystem, reservationLedger } = seedDependencies();
    const seedItemId = getCropType('millet').seedItemId;
    const campAmount = Number(campStore?.get?.(campId)?.items?.[seedItemId] ?? 0);
    const carriedAmount = (peopleSystem?.list?.() ?? []).reduce((total, person) => total + Number(person.inventory?.items?.[seedItemId] ?? 0), 0);
    const inTransitAmount = Number(reservationLedger?.amount?.({ type: FARM_SEED_CARGO_RESERVATION_TYPE }) ?? 0);
    return { seedItemId, campAmount, carriedAmount, inTransitAmount };
  }

  function getSeedSummary() {
    const amounts = seedAmounts();
    return buildSeedStockTarget({
      fields: [...fields.values()],
      campAmount: amounts.campAmount,
      carriedAmount: amounts.carriedAmount,
      inTransitAmount: amounts.inTransitAmount,
    });
  }

  function getSummary() {
    const list = [...fields.values()];
    const readyToSow = list.filter((field) => field.status === 'readyToSow');
    const firstField = list.find((field) => field.id === 'first-millet-field') ?? null;
    const secondField = list.find((field) => field.id === SECOND_FIELD_EXPANSION.id) ?? null;
    const soilValues = list.map((field) => Number(field.soil?.fertility ?? SOIL_LIMITS.initialFertility));
    const averageFertility = soilValues.length ? Math.round(soilValues.reduce((total, value) => total + value, 0) / soilValues.length) : null;
    const seed = getSeedSummary();
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
      seed,
      seedStock: seed.onHand,
      season: getSeason(),
    };
  }

  function emit(reason, field = null, extra = {}) {
    eventBus.emit('farms:changed', {
      reason,
      field: field ? viewField(field) : null,
      fields: listFields(),
      summary: getSummary(),
      time: gameTime.stamp(),
      ...clone(extra),
    });
  }

  function emitSeedFailure({ personId, task, reason, details = {} }) {
    eventBus.emit('actions:failed', {
      personId: personId ?? null,
      taskId: task?.id ?? null,
      task: clone(task ?? null),
      reason,
      details: clone(details),
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

  function depositPendingLegacySeeds() {
    if (!(pendingLegacySeedStock > 0)) return 0;
    const { campStore } = seedDependencies();
    if (!campStore?.change) return 0;
    const actual = campStore.change(campId, getCropType('millet').seedItemId, pendingLegacySeedStock, 'farm-seed-migration');
    pendingLegacySeedStock = round(Math.max(0, pendingLegacySeedStock - Math.max(0, actual)));
    if (pendingLegacySeedStock <= 0) initialSeedsProvisioned = true;
    return actual;
  }

  function ensureInitialSeedStock() {
    depositPendingLegacySeeds();
    if (initialSeedsProvisioned) return getSeedSummary();
    const { campStore } = seedDependencies();
    if (!campStore?.change) return getSeedSummary();
    const current = getSeedSummary();
    const missing = Math.max(0, INITIAL_MILLET_SEEDS - current.onHand);
    if (missing > 0) campStore.change(campId, getCropType('millet').seedItemId, missing, 'farm-seed-bootstrap');
    const after = getSeedSummary();
    if (after.onHand >= INITIAL_MILLET_SEEDS) initialSeedsProvisioned = true;
    return after;
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
      planting: null,
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
    ensureInitialSeedStock();
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

  function getSeedPlan(fieldId) {
    const field = fields.get(fieldId);
    if (!field) return null;
    const crop = getCropType(field.cropId);
    const seed = getSeedSummary();
    return {
      fieldId,
      cropId: field.cropId,
      seedItemId: crop.seedItemId,
      seedAmount: crop.seedsPerPlanting,
      availableAtCamp: seed.availableAtCamp,
      target: seed.target,
      shortage: seed.shortage,
    };
  }

  function canStartSowing({ person, fieldId }) {
    const field = fields.get(fieldId);
    const { campStore } = seedDependencies();
    const camp = campStore?.get?.(campId);
    const plan = getSeedPlan(fieldId);
    if (!field || field.status !== 'readyToSow' || !getCropRule(field.cropId).canSow || !camp || !person || !plan) return false;
    if (distance(person.location, camp.anchor) > 3) return false;
    return Number(camp.items?.[plan.seedItemId] ?? 0) >= plan.seedAmount;
  }

  function sow(fieldId, { seedAmount = 0, personId = null, taskId = null } = {}) {
    const field = fields.get(fieldId);
    const rule = field ? getCropRule(field.cropId) : null;
    if (!field || field.status !== 'readyToSow' || !rule?.canSow) return null;
    const crop = getCropType(field.cropId);
    const actualSeeds = Math.max(0, Number(seedAmount) || 0);
    if (actualSeeds < crop.seedsPerPlanting) return null;
    field.status = 'growing';
    field.growth.progressed = 0;
    field.growth.lastTick = Number(gameTime.now().tick ?? 0);
    field.planting = {
      seedItemId: crop.seedItemId,
      seedAmount: crop.seedsPerPlanting,
      personId,
      taskId,
      plantedAt: gameTime.stamp(),
    };
    field.plantedAt = gameTime.stamp();
    field.matureAt = null;
    field.updatedAt = gameTime.stamp();
    emit('field:sown', field, { planting: field.planting });
    return get(fieldId);
  }

  function harvest(fieldId) {
    const field = fields.get(fieldId);
    if (!field || field.status !== 'mature') return null;
    const crop = getCropType(field.cropId);
    const soilBefore = describeSoil(field.soil);
    const totalAmount = Math.max(3, Math.round(crop.harvestYield * soilYieldMultiplier(field.soil)));
    const split = splitMilletHarvest(totalAmount, { seedShare: crop.seedShare, minimumSeedReturn: crop.minimumSeedReturn });
    const splitVerification = verifyHarvestSplit(split);
    if (!splitVerification.ok) throw new Error('收获留种守恒失败。');
    const soil = depleteSoil(field.soil, crop.soilDepletion ?? SOIL_LIMITS.harvestDepletion);
    const result = {
      itemId: crop.itemId,
      amount: split.foodAmount,
      foodAmount: split.foodAmount,
      seedItemId: crop.seedItemId,
      seedAmount: split.seedAmount,
      seedReturn: split.seedAmount,
      totalAmount: split.totalAmount,
      label: crop.label,
      seedLabel: crop.seedLabel,
      soilBefore,
      soil,
    };
    field.status = 'readyToSow';
    field.growth.progressed = 0;
    field.growth.lastTick = Number(gameTime.now().tick ?? 0);
    field.planting = null;
    field.harvestCount += 1;
    field.updatedAt = gameTime.stamp();
    emit('field:harvested', field, { harvest: result });
    eventBus.emit('farms:harvested', { field: viewField(field), harvest: clone(result), time: gameTime.stamp() });
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

  function pickupSeedForTask({ personId, task }) {
    if (task?.type !== 'sowMillet') return null;
    const field = fields.get(task.data?.fieldId);
    const crop = field ? getCropType(field.cropId) : null;
    const amount = Math.max(0, Number(task.data?.seedAmount ?? crop?.seedsPerPlanting ?? 0));
    const { campStore, peopleSystem, reservationLedger } = seedDependencies();
    const person = peopleSystem?.get?.(personId);
    const camp = campStore?.get?.(campId);
    if (!field || !crop || !person || !camp || !reservationLedger || amount <= 0) {
      emitSeedFailure({ personId, task, reason: 'seed-runtime-unavailable', details: { fieldId: task.data?.fieldId ?? null } });
      return null;
    }
    if (distance(person.location, camp.anchor) > 3) {
      emitSeedFailure({ personId, task, reason: 'seed-pickup-not-at-camp', details: { fieldId: field.id, campId } });
      return null;
    }
    if (Number(camp.items?.[crop.seedItemId] ?? 0) < amount) {
      emitSeedFailure({ personId, task, reason: 'seed-stock-insufficient', details: { fieldId: field.id, seedItemId: crop.seedItemId, required: amount } });
      return null;
    }
    const taken = campStore.take(campId, crop.seedItemId, amount, `farm-seed-pickup:${task.id}:${personId}:${field.id}`);
    if (taken < amount) {
      if (taken > 0) campStore.change(campId, crop.seedItemId, taken, `farm-seed-pickup-rollback:${task.id}`);
      emitSeedFailure({ personId, task, reason: 'seed-stock-insufficient', details: { fieldId: field.id, seedItemId: crop.seedItemId, required: amount, taken } });
      return null;
    }
    peopleSystem.changeItem(personId, crop.seedItemId, taken);
    const reservation = reservationLedger.reserve({
      id: seedReservationId(task.id),
      type: FARM_SEED_CARGO_RESERVATION_TYPE,
      key: `${personId}:${crop.seedItemId}`,
      taskId: task.id,
      ownerId: personId,
      amount: taken,
      capacity: Number(peopleSystem.get(personId)?.inventory?.items?.[crop.seedItemId] ?? taken),
      metadata: { fieldId: field.id, seedItemId: crop.seedItemId, actionType: task.type },
    });
    if (!reservation) {
      peopleSystem.changeItem(personId, crop.seedItemId, -taken);
      campStore.change(campId, crop.seedItemId, taken, `farm-seed-pickup-rollback:${task.id}`);
      emitSeedFailure({ personId, task, reason: 'seed-cargo-reservation-conflict', details: { fieldId: field.id, seedItemId: crop.seedItemId } });
      return null;
    }
    eventBus.emit('farms:seed-picked', {
      personId,
      taskId: task.id,
      fieldId: field.id,
      seedItemId: crop.seedItemId,
      amount: taken,
      reservation,
      time: gameTime.stamp(),
    });
    return reservation;
  }

  function releaseSeedCargo(taskId) {
    if (!taskId) return null;
    const { reservationLedger } = seedDependencies();
    return reservationLedger?.release?.(seedReservationId(taskId)) ?? null;
  }

  function verifySeeds() {
    const issues = [];
    const { peopleSystem, campStore, reservationLedger } = seedDependencies();
    const crop = getCropType('millet');
    const camp = campStore?.get?.(campId);
    if (Number(camp?.items?.[crop.seedItemId] ?? 0) < -0.001) issues.push({ type: 'negative-camp-seed-stock' });
    const people = peopleSystem?.list?.() ?? [];
    people.forEach((person) => {
      const amount = Number(person.inventory?.items?.[crop.seedItemId] ?? 0);
      if (amount < -0.001) issues.push({ type: 'negative-person-seed-stock', personId: person.id, amount });
    });
    fields.forEach((field) => {
      if (['growing', 'mature'].includes(field.status)) {
        if (!field.planting || Number(field.planting.seedAmount ?? 0) < getCropType(field.cropId).seedsPerPlanting) {
          issues.push({ type: 'growing-field-missing-seed-fact', fieldId: field.id });
        }
      }
      if (['planned', 'clearing', 'readyToSow'].includes(field.status) && field.planting) {
        issues.push({ type: 'resting-field-has-stale-planting', fieldId: field.id });
      }
    });
    const reservations = reservationLedger?.list?.({ type: FARM_SEED_CARGO_RESERVATION_TYPE }) ?? [];
    const seenTasks = new Set();
    reservations.forEach((entry) => {
      if (!entry.taskId || seenTasks.has(entry.taskId)) issues.push({ type: 'duplicate-or-missing-seed-task', reservationId: entry.id, taskId: entry.taskId });
      seenTasks.add(entry.taskId);
      const person = people.find((item) => item.id === entry.ownerId);
      const carried = Number(person?.inventory?.items?.[entry.metadata?.seedItemId ?? crop.seedItemId] ?? 0);
      if (!person || carried + 0.001 < Number(entry.amount ?? 0)) {
        issues.push({ type: 'seed-reservation-exceeds-cargo', reservationId: entry.id, ownerId: entry.ownerId, carried, reserved: entry.amount });
      }
      const current = person?.activity?.current;
      if (current?.id !== entry.taskId || current?.type !== 'sowMillet') {
        issues.push({ type: 'orphan-seed-cargo-reservation', reservationId: entry.id, taskId: entry.taskId, ownerId: entry.ownerId });
      }
    });
    return { ok: issues.length === 0, issues, summary: getSeedSummary(), reservations: reservations.length };
  }

  function exportState() {
    return {
      schemaVersion: FARM_SCHEMA_VERSION,
      exportedAt: gameTime.stamp(),
      initialSeedsProvisioned,
      fields: [...fields.values()].map(clone),
    };
  }

  function normalizeImportedField(field) {
    const draft = clone(field);
    if (!draft.soil) draft.soil = createSoil(Number(gameTime.now().tick ?? 0));
    if (!('planting' in draft)) {
      draft.planting = ['growing', 'mature'].includes(draft.status)
        ? {
          seedItemId: getCropType(draft.cropId ?? 'millet').seedItemId,
          seedAmount: getCropType(draft.cropId ?? 'millet').seedsPerPlanting,
          personId: null,
          taskId: null,
          plantedAt: draft.plantedAt ?? draft.updatedAt ?? gameTime.stamp(),
          migrated: true,
        }
        : null;
    }
    return draft;
  }

  function importState(snapshot) {
    if (![1, FARM_SCHEMA_VERSION].includes(snapshot?.schemaVersion) || !Array.isArray(snapshot.fields)) {
      throw new Error('农田存档格式不兼容。');
    }
    const next = new Map();
    snapshot.fields.forEach((field) => {
      if (!field?.id) throw new Error('农田存档缺少 id。');
      next.set(field.id, normalizeImportedField(field));
    });
    fields.clear();
    next.forEach((field, id) => fields.set(id, field));
    if (snapshot.schemaVersion === 1) {
      pendingLegacySeedStock = Math.max(0, Number(snapshot.seedStock ?? 0));
      initialSeedsProvisioned = pendingLegacySeedStock > 0;
    } else {
      pendingLegacySeedStock = 0;
      initialSeedsProvisioned = Boolean(snapshot.initialSeedsProvisioned);
    }
    depositPendingLegacySeeds();
    emit('farms:hydrated');
    return getSummary();
  }

  eventBus.on('actions:assigned', pickupSeedForTask);
  eventBus.on('actions:completed', ({ task }) => releaseSeedCargo(task?.id));
  eventBus.on('actions:failed', ({ taskId, task }) => releaseSeedCargo(taskId ?? task?.id));
  eventBus.on('people:changed', ({ reason, person }) => {
    if (reason !== 'activity:set' || person?.activity?.current) return;
    const { reservationLedger } = seedDependencies();
    (reservationLedger?.list?.({ type: FARM_SEED_CARGO_RESERVATION_TYPE, ownerId: person?.id }) ?? []).forEach((entry) => reservationLedger.release(entry.id));
  });
  eventBus.on('camp:hydrated', depositPendingLegacySeeds);
  eventBus.on('simulation:time', ({ weather }) => { syncGrowth(weather); });
  eventBus.on('seasons:changed', () => emit('season:changed'));

  return Object.freeze({
    ensureFirstField,
    ensureExpansionField,
    ensureInitialSeedStock,
    nextWorkField,
    clearField,
    getSeedPlan,
    getSeedSummary,
    canStartSowing,
    sow,
    harvest,
    syncGrowth,
    get,
    listFields,
    getSummary,
    getFieldCenter: (field) => fieldCenter(field),
    verifySeeds,
    exportState,
    importState,
  });
}
