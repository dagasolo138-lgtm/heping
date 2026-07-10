import { createWorldSaveSystem } from '../modules/persistence/worldSaveSystem.js';

const STYLESHEET_URL = new URL('../styles/worldSave.css', import.meta.url);
const MANUAL_SLOT = 'manual';
const AUTOSAVE_SLOT = 'autosave';
const AUTOSAVE_SETTING_KEY = 'shengling.save.autosave.enabled';
const AUTOSAVE_INTERVAL_MS = 60_000;

function ensureStylesheet() {
  let stylesheet = document.querySelector('link[data-shengling-world-save]');
  if (stylesheet) return stylesheet;
  stylesheet = document.createElement('link');
  stylesheet.rel = 'stylesheet';
  stylesheet.href = STYLESHEET_URL.href;
  stylesheet.dataset.shenglingWorldSave = 'true';
  document.head.append(stylesheet);
  return stylesheet;
}

function safeLocalStorageGet(key, fallback) {
  try {
    return localStorage.getItem(key) ?? fallback;
  } catch {
    return fallback;
  }
}

function safeLocalStorageSet(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 自动保存开关只是 UI 偏好；不可写时保持内存状态即可。
  }
}

function formatRealTime(value) {
  if (!value) return '暂无';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未知时间';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function safeGetMeta(worldSaveSystem, slot) {
  try {
    return worldSaveSystem.getMeta(slot);
  } catch {
    return null;
  }
}

function latestMeta(worldSaveSystem) {
  const manual = safeGetMeta(worldSaveSystem, MANUAL_SLOT);
  const autosave = safeGetMeta(worldSaveSystem, AUTOSAVE_SLOT);
  return { manual, autosave };
}

function newestSlot(meta) {
  if (meta.manual && meta.autosave) {
    const manualTime = Date.parse(meta.manual.savedAt?.realTime ?? 0);
    const autoTime = Date.parse(meta.autosave.savedAt?.realTime ?? 0);
    return autoTime > manualTime ? AUTOSAVE_SLOT : MANUAL_SLOT;
  }
  if (meta.manual) return MANUAL_SLOT;
  if (meta.autosave) return AUTOSAVE_SLOT;
  return null;
}

function loadFailureMessage({ error, rollbackSucceeded, rollbackError } = {}) {
  if (rollbackSucceeded) return `读取失败，已恢复原世界：${error?.message ?? '存档内容无效'}`;
  return `读取失败且回滚失败：${rollbackError?.message ?? error?.message ?? '未知错误'}`;
}

function ensurePanel() {
  let panel = document.querySelector('#world-save-panel');
  if (panel) return panel;
  panel = document.createElement('section');
  panel.id = 'world-save-panel';
  panel.className = 'world-save-panel';
  panel.setAttribute('aria-label', '世界存档');
  panel.innerHTML = `
    <div class="world-save-panel__copy">
      <span class="world-save-panel__kicker">WORLD SAVE</span>
      <strong data-save-status>存档准备中</strong>
      <small data-save-meta>暂无存档</small>
    </div>
    <div class="world-save-panel__buttons">
      <button type="button" data-save-action="save">保存</button>
      <button type="button" data-save-action="load">读取</button>
      <button type="button" data-save-action="toggle-autosave" aria-pressed="false">自动保存</button>
      <button type="button" data-save-action="reset" class="world-save-panel__danger">重置</button>
    </div>
  `;

  const systemTools = document.querySelector('[data-system-tools]');
  const speedControl = document.querySelector('.world-speed-control');
  if (systemTools) systemTools.append(panel);
  else if (speedControl?.parentElement) speedControl.insertAdjacentElement('afterend', panel);
  else document.querySelector('.map-panel')?.prepend(panel);
  return panel;
}

function renderPanel(panel, worldSaveSystem, { autosaveEnabled, message = '' } = {}) {
  const meta = latestMeta(worldSaveSystem);
  const status = panel.querySelector('[data-save-status]');
  const metaLine = panel.querySelector('[data-save-meta]');
  const loadButton = panel.querySelector('[data-save-action="load"]');
  const autoButton = panel.querySelector('[data-save-action="toggle-autosave"]');
  const slot = newestSlot(meta);
  const activeMeta = slot ? meta[slot] : null;

  if (status) status.textContent = message || (activeMeta ? `最近存档：${slot === AUTOSAVE_SLOT ? '自动' : '手动'}` : '暂无存档');
  if (metaLine) {
    metaLine.textContent = activeMeta
      ? `${activeMeta.savedAt?.gameTime?.label ?? '未知世界时间'} · ${formatRealTime(activeMeta.savedAt?.realTime)}`
      : '可手动保存，或开启自动保存';
  }
  if (loadButton) loadButton.disabled = !slot;
  if (autoButton) {
    autoButton.classList.toggle('is-active', autosaveEnabled);
    autoButton.setAttribute('aria-pressed', String(autosaveEnabled));
    autoButton.textContent = autosaveEnabled ? '自动保存开' : '自动保存关';
  }
}

export function attachWorldSaveRuntime() {
  const runtime = globalThis.shengling;
  const eventBus = globalThis.__shenglingEventBus;
  if (!runtime || !eventBus) throw new Error('世界存档模块启动失败：世界运行时尚未初始化。');
  if (runtime.worldSaveSystem) return runtime.worldSaveSystem;

  ensureStylesheet();
  const worldSaveSystem = createWorldSaveSystem({
    eventBus,
    gameTime: runtime.gameTime,
    peopleSystem: runtime.peopleSystem,
    mapSystem: runtime.mapSystem,
    campStore: runtime.campStore,
    campRulesSystem: runtime.campRulesSystem,
    buildingSystem: runtime.buildingSystem,
    fireSystem: runtime.fireSystem,
    ecologySystem: runtime.ecologySystem,
    roadSystem: runtime.roadSystem,
    farmSystem: runtime.farmSystem,
    foodStorageSystem: runtime.foodStorageSystem,
    socialEventSystem: runtime.socialEventSystem,
    chronicleSystem: runtime.chronicleSystem,
    getRuntime: () => globalThis.shengling,
  });

  const panel = ensurePanel();
  let autosaveEnabled = safeLocalStorageGet(AUTOSAVE_SETTING_KEY, 'true') !== 'false';
  let lastAutosaveAt = Date.now();
  let lastAutosaveDayKey = `${runtime.gameTime.now().year}:${runtime.gameTime.now().day}`;

  function autosave(reason = 'timer') {
    if (!autosaveEnabled) return null;
    const snapshot = worldSaveSystem.save(AUTOSAVE_SLOT);
    lastAutosaveAt = Date.now();
    renderPanel(panel, worldSaveSystem, { autosaveEnabled, message: reason === 'day' ? '跨日自动保存完成' : '自动保存完成' });
    return snapshot;
  }

  panel.addEventListener('click', (event) => {
    const button = event.target.closest('[data-save-action]');
    if (!button) return;
    const action = button.dataset.saveAction;

    if (action === 'save') {
      worldSaveSystem.save(MANUAL_SLOT);
      renderPanel(panel, worldSaveSystem, { autosaveEnabled, message: '手动保存完成' });
      return;
    }

    if (action === 'load') {
      const meta = latestMeta(worldSaveSystem);
      const slot = newestSlot(meta);
      if (!slot) return;
      const ok = confirm(`读取${slot === AUTOSAVE_SLOT ? '自动' : '手动'}存档？当前未保存的进度会被覆盖。`);
      if (!ok) return;
      try {
        worldSaveSystem.load(slot);
        renderPanel(panel, worldSaveSystem, { autosaveEnabled, message: '读取存档完成' });
      } catch (error) {
        console.error('[shengling:save-load-error]', error);
        renderPanel(panel, worldSaveSystem, { autosaveEnabled, message: error?.message ?? '读取存档失败' });
      }
      return;
    }

    if (action === 'toggle-autosave') {
      autosaveEnabled = !autosaveEnabled;
      safeLocalStorageSet(AUTOSAVE_SETTING_KEY, String(autosaveEnabled));
      renderPanel(panel, worldSaveSystem, { autosaveEnabled, message: autosaveEnabled ? '自动保存已开启' : '自动保存已关闭' });
      return;
    }

    if (action === 'reset') {
      const ok = confirm('重置会删除手动存档和自动存档，并刷新为新世界。确定继续？');
      if (!ok) return;
      worldSaveSystem.clear(MANUAL_SLOT);
      worldSaveSystem.clear(AUTOSAVE_SLOT);
      location.reload();
    }
  });

  eventBus.on('save:written', ({ slot }) => {
    renderPanel(panel, worldSaveSystem, { autosaveEnabled, message: slot === AUTOSAVE_SLOT ? '自动保存完成' : '手动保存完成' });
  });
  eventBus.on('save:loaded', () => renderPanel(panel, worldSaveSystem, { autosaveEnabled, message: '读取存档完成' }));
  eventBus.on('save:load-failed', (failure) => {
    renderPanel(panel, worldSaveSystem, { autosaveEnabled, message: loadFailureMessage(failure) });
  });
  eventBus.on('save:cleared', () => renderPanel(panel, worldSaveSystem, { autosaveEnabled, message: '存档已清除' }));
  eventBus.on('simulation:time', ({ time }) => {
    const dayKey = `${time.year}:${time.day}`;
    if (dayKey !== lastAutosaveDayKey) {
      lastAutosaveDayKey = dayKey;
      autosave('day');
    }
  });

  const intervalId = setInterval(() => {
    if (!autosaveEnabled || Date.now() - lastAutosaveAt < AUTOSAVE_INTERVAL_MS) return;
    autosave('timer');
  }, 5_000);

  window.addEventListener('beforeunload', () => { if (autosaveEnabled) worldSaveSystem.save(AUTOSAVE_SLOT); });
  renderPanel(panel, worldSaveSystem, { autosaveEnabled });

  const worldSaveRuntime = Object.freeze({
    save: (slot = MANUAL_SLOT) => worldSaveSystem.save(slot),
    load: (slot) => worldSaveSystem.load(slot ?? newestSlot(latestMeta(worldSaveSystem)) ?? MANUAL_SLOT),
    autosave,
    isAutosaveEnabled: () => autosaveEnabled,
    setAutosaveEnabled(next) {
      autosaveEnabled = Boolean(next);
      safeLocalStorageSet(AUTOSAVE_SETTING_KEY, String(autosaveEnabled));
      renderPanel(panel, worldSaveSystem, { autosaveEnabled });
      return autosaveEnabled;
    },
    stop() { clearInterval(intervalId); },
  });

  globalThis.shengling = Object.freeze({ ...runtime, worldSaveSystem, worldSaveRuntime });
  return worldSaveSystem;
}
