const ACTIVE_TAB_KEY = 'shengling.ui.observer.activeTab';
const MOBILE_BREAKPOINT = '(max-width: 980px)';

function safeReadActiveTab() {
  try {
    return localStorage.getItem(ACTIVE_TAB_KEY) ?? 'people';
  } catch {
    return 'people';
  }
}

function safeWriteActiveTab(value) {
  try {
    localStorage.setItem(ACTIVE_TAB_KEY, value);
  } catch {
    // 标签页只是界面偏好；存储不可用时保持当前会话状态。
  }
}

export function attachObserverUiRuntime() {
  const runtime = globalThis.shengling;
  if (!runtime) throw new Error('观察面板启动失败：世界运行时尚未初始化。');
  if (runtime.observerUiRuntime) return runtime.observerUiRuntime;

  const drawer = document.querySelector('[data-observer-drawer]');
  const drawerToggle = document.querySelector('[data-observer-drawer-toggle]');
  const tabs = [...document.querySelectorAll('[data-observer-tab]')];
  const panels = [...document.querySelectorAll('[data-observer-panel]')];
  const mobileQuery = window.matchMedia(MOBILE_BREAKPOINT);
  const validTabs = new Set(tabs.map((tab) => tab.dataset.observerTab));
  let activeTab = validTabs.has(safeReadActiveTab()) ? safeReadActiveTab() : 'people';
  let open = !mobileQuery.matches;

  function renderDrawer() {
    if (!drawer || !drawerToggle) return;
    drawer.classList.toggle('is-open', open);
    drawerToggle.setAttribute('aria-expanded', String(open));
    const hint = drawerToggle.querySelector('small');
    if (hint) hint.textContent = open ? '下滑收起' : '上滑展开';
  }

  function activate(name, { reveal = true, focus = false } = {}) {
    if (!validTabs.has(name)) return activeTab;
    activeTab = name;
    safeWriteActiveTab(name);
    tabs.forEach((tab) => {
      const selected = tab.dataset.observerTab === name;
      tab.setAttribute('aria-selected', String(selected));
      tab.tabIndex = selected ? 0 : -1;
      if (selected && focus) tab.focus();
    });
    panels.forEach((panel) => { panel.hidden = panel.dataset.observerPanel !== name; });
    if (reveal && mobileQuery.matches) open = true;
    renderDrawer();
    return activeTab;
  }

  tabs.forEach((tab) => {
    tab.addEventListener('click', () => activate(tab.dataset.observerTab, { reveal: true }));
    tab.addEventListener('keydown', (event) => {
      if (!['ArrowLeft', 'ArrowRight'].includes(event.key)) return;
      event.preventDefault();
      const index = tabs.indexOf(tab);
      const offset = event.key === 'ArrowRight' ? 1 : -1;
      const next = tabs[(index + offset + tabs.length) % tabs.length];
      activate(next.dataset.observerTab, { reveal: true, focus: true });
    });
  });

  drawerToggle?.addEventListener('click', () => {
    open = !open;
    renderDrawer();
  });

  document.addEventListener('observer:person-selected', () => activate('people', { reveal: true }));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !mobileQuery.matches || !open) return;
    open = false;
    renderDrawer();
  });

  mobileQuery.addEventListener?.('change', (event) => {
    open = !event.matches;
    renderDrawer();
  });

  activate(activeTab, { reveal: false });
  const api = Object.freeze({
    activate,
    getActiveTab: () => activeTab,
    isOpen: () => open,
    setOpen(next) {
      open = Boolean(next);
      renderDrawer();
      return open;
    },
  });
  globalThis.shengling = Object.freeze({ ...runtime, observerUiRuntime: api });
  return api;
}
