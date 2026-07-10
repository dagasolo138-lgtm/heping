import { migrateWorldSave } from './worldMigrations.js';
import { exportActionRuntimeSnapshot, restoreActionRuntimeSnapshot, validateActionRuntimeCoordinates } from './actionRuntimeSnapshot.js';
import { WORLD_SAVE_APP_VERSION, WORLD_SAVE_DEFAULT_SLOT, WORLD_SAVE_SCHEMA_VERSION, slotKey } from './worldSaveSchema.js';

function clone(value) {
  return structuredClone(value);
}

function canUseLocalStorage() {
  try {
    return typeof localStorage !== 'undefined';
  } catch {
    return false;
  }
}

function requireStorage() {
  if (!canUseLocalStorage()) throw new Error('当前环境不支持 localStorage 存档。');
  return localStorage;
}

function maybeExport(system) {
  return system?.exportState ? system.exportState() : null;
}

function maybeImport(system, snapshot, label) {
  if (snapshot === null || snapshot === undefined) return null;
  if (!system?.importState) throw new Error(`${label} 系统不支持读取存档。`);
  return system.importState(snapshot);
}

function summarizeError(error) {
  return {
    name: error?.name ?? 'Error',
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  };
}

export function createWorldSaveSystem({
  eventBus,
  gameTime,
  peopleSystem,
  mapSystem,
  campStore,
  campRulesSystem = null,
  buildingSystem,
  fireSystem,
  ecologySystem = null,
  roadSystem = null,
  farmSystem = null,
  foodStorageSystem = null,
  socialEventSystem = null,
  chronicleSystem = null,
  getRuntime = () => globalThis.shengling,
} = {}) {
  function stamp() {
    return gameTime.stamp();
  }

  function exportSnapshot() {
    const time = stamp();
    const runtime = getRuntime?.();
    return {
      schemaVersion: WORLD_SAVE_SCHEMA_VERSION,
      appVersion: WORLD_SAVE_APP_VERSION,
      savedAt: {
        realTime: new Date().toISOString(),
        gameTime: time,
      },
      world: {
        id: mapSystem.get()?.regionId ?? 'starting-valley',
        label: campStore.get('starting-camp')?.label ?? '起始河谷',
        seed: mapSystem.get()?.seed ?? null,
      },
      systems: {
        gameTime: maybeExport(gameTime),
        people: maybeExport(peopleSystem),
        map: maybeExport(mapSystem),
        camp: maybeExport(campStore),
        campRules: maybeExport(campRulesSystem),
        buildings: maybeExport(buildingSystem),
        fire: maybeExport(fireSystem),
        ecology: maybeExport(ecologySystem),
        roads: maybeExport(roadSystem),
        farms: maybeExport(farmSystem),
        foodStorage: maybeExport(foodStorageSystem),
        foodDistribution: maybeExport(runtime?.actionSystem?.getFoodDistributionSystem?.()),
        socialEvents: maybeExport(socialEventSystem),
        chronicles: maybeExport(chronicleSystem),
        actionRuntime: exportActionRuntimeSnapshot({
          actionSystem: runtime?.actionSystem,
          peopleSystem,
          exportedAt: time,
        }),
      },
    };
  }

  function writeSnapshot(snapshot, slot = WORLD_SAVE_DEFAULT_SLOT) {
    const storage = requireStorage();
    const migrated = migrateWorldSave(snapshot);
    storage.setItem(slotKey(slot), JSON.stringify(migrated));
    eventBus.emit('save:written', { slot, key: slotKey(slot), snapshot: clone(migrated), time: stamp() });
    return clone(migrated);
  }

  function save(slot = WORLD_SAVE_DEFAULT_SLOT) {
    return writeSnapshot(exportSnapshot(), slot);
  }

  function readSnapshot(slot = WORLD_SAVE_DEFAULT_SLOT) {
    const storage = requireStorage();
    const raw = storage.getItem(slotKey(slot));
    if (!raw) return null;
    try {
      return migrateWorldSave(JSON.parse(raw));
    } catch (error) {
      throw new Error(`读取世界存档失败：${error.message}`);
    }
  }

  function importTargets(runtime) {
    return [
      ['gameTime', '时间', gameTime],
      ['people', '人物', peopleSystem],
      ['map', '地图', mapSystem],
      ['camp', '营地', campStore],
      ['campRules', '营地规则', campRulesSystem],
      ['buildings', '建筑', buildingSystem],
      ['fire', '篝火', fireSystem],
      ['ecology', '生态', ecologySystem],
      ['roads', '道路', roadSystem],
      ['farms', '农田', farmSystem],
      ['foodStorage', '食物储存', foodStorageSystem],
      ['foodDistribution', '食物分配', runtime?.actionSystem?.getFoodDistributionSystem?.()],
      ['socialEvents', '社会事件', socialEventSystem],
      ['chronicles', '史书', chronicleSystem],
    ];
  }

  function validateImportTargets(snapshot, runtime) {
    importTargets(runtime).forEach(([key, label, system]) => {
      const state = snapshot.systems[key];
      if (state === null || state === undefined) return;
      if (!system?.importState) throw new Error(`${label} 系统不支持读取存档。`);
    });
    validateActionRuntimeCoordinates(snapshot.systems.actionRuntime, snapshot.systems.map);
  }

  function importSystems(snapshot, runtime) {
    importTargets(runtime).forEach(([key, label, system]) => {
      maybeImport(system, snapshot.systems[key], label);
    });
  }

  function refreshRuntime(runtime, snapshot) {
    const actionRuntime = restoreActionRuntimeSnapshot({
      snapshot: snapshot.systems.actionRuntime,
      peopleSystem,
      mapSystem,
    });
    runtime?.actionSystem?.resetRuntimeAgents?.({ clearActivities: false });
    runtime?.mapView?.setMap?.(mapSystem.get());
    runtime?.mapView?.redraw?.();
    return actionRuntime;
  }

  function importSnapshot(rawSnapshot) {
    const snapshot = migrateWorldSave(rawSnapshot);
    const runtime = getRuntime?.();
    validateImportTargets(snapshot, runtime);
    const rollbackSnapshot = exportSnapshot();
    const wasRunning = Boolean(runtime?.actionSystem?.isRunning?.());
    runtime?.actionSystem?.stop?.();

    try {
      importSystems(snapshot, runtime);
      const actionRuntime = refreshRuntime(runtime, snapshot);
      eventBus.emit('save:loaded', { snapshot: clone(snapshot), actionRuntime: clone(actionRuntime), time: stamp() });
      return clone(snapshot);
    } catch (error) {
      let rollbackError = null;
      try {
        importSystems(rollbackSnapshot, runtime);
        refreshRuntime(runtime, rollbackSnapshot);
      } catch (nextError) {
        rollbackError = nextError;
      }

      const failure = {
        error: summarizeError(error),
        rollbackSucceeded: rollbackError === null,
        rollbackError: rollbackError ? summarizeError(rollbackError) : null,
        requestedAppVersion: snapshot.appVersion ?? null,
        time: stamp(),
      };
      eventBus.emit('save:load-failed', failure);

      if (rollbackError) {
        throw new Error(`读取世界存档失败，且恢复读取前状态失败：${failure.error.message}；回滚错误：${failure.rollbackError.message}`, { cause: error });
      }
      throw new Error(`读取世界存档失败，已恢复读取前状态：${failure.error.message}`, { cause: error });
    } finally {
      if (wasRunning) runtime?.actionSystem?.start?.();
    }
  }

  function load(slot = WORLD_SAVE_DEFAULT_SLOT) {
    const snapshot = readSnapshot(slot);
    if (!snapshot) return null;
    return importSnapshot(snapshot);
  }

  function clear(slot = WORLD_SAVE_DEFAULT_SLOT) {
    const storage = requireStorage();
    storage.removeItem(slotKey(slot));
    eventBus.emit('save:cleared', { slot, key: slotKey(slot), time: stamp() });
    return true;
  }

  function hasSave(slot = WORLD_SAVE_DEFAULT_SLOT) {
    return Boolean(canUseLocalStorage() && localStorage.getItem(slotKey(slot)));
  }

  function getMeta(slot = WORLD_SAVE_DEFAULT_SLOT) {
    const snapshot = readSnapshot(slot);
    if (!snapshot) return null;
    return clone({
      schemaVersion: snapshot.schemaVersion,
      appVersion: snapshot.appVersion,
      savedAt: snapshot.savedAt,
      world: snapshot.world,
    });
  }

  return Object.freeze({
    exportSnapshot,
    importSnapshot,
    save,
    load,
    clear,
    hasSave,
    getMeta,
    keyForSlot: slotKey,
  });
}
