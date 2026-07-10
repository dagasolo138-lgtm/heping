const ACTIVE_TAB_KEY = 'shengling.ui.observer.activeTab';
const MOBILE_BREAKPOINT = '(max-width: 980px)';
const DRAWER_SWIPE_THRESHOLD = 42;
const DRAWER_SWIPE_AXIS_RATIO = 1.2;
const DRAWER_GESTURE_SLOP = 8;

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

function safeCapturePointer(target, pointerId) {
  try {
    target?.setPointerCapture?.(pointerId);
  } catch {
    // 部分旧版移动浏览器会在指针已结束时拒绝捕获；手势仍可按当前事件完成。
  }
}

function safeReleasePointer(target, pointerId) {
  try {
    if (target?.hasPointerCapture?.(pointerId)) target.releasePointerCapture(pointerId);
  } catch {
    // 指针取消后浏览器可能已自动释放捕获。
  }
}

export function resolveDrawerSwipe({
  startX = 0,
  startY = 0,
  endX = startX,
  endY = startY,
  open = false,
  threshold = DRAWER_SWIPE_THRESHOLD,
  axisRatio = DRAWER_SWIPE_AXIS_RATIO,
} = {}) {
  const deltaX = Number(endX) - Number(startX);
  const deltaY = Number(endY) - Number(startY);
  const verticalDistance = Math.abs(deltaY);
  const horizontalDistance = Math.abs(deltaX);

  if (verticalDistance < threshold) return null;
  if (verticalDistance < horizontalDistance * axisRatio) return null;
  if (deltaY < 0 && !open) return true;
  if (deltaY > 0 && open) return false;
  return null;
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
  let drawerGesture = null;
  let suppressToggleClick = false;
  let suppressToggleTimer = null;

  function renderDrawer() {
    if (!drawer || !drawerToggle) return;
    drawer.classList.toggle('is-open', open);
    drawer.dataset.drawerState = open ? 'open' : 'closed';
    drawerToggle.setAttribute('aria-expanded', String(open));
    drawerToggle.setAttribute('aria-label', open ? '收起聚落观察，可下滑操作' : '展开聚落观察，可上滑操作');
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

  function suppressSyntheticClick() {
    suppressToggleClick = true;
    if (suppressToggleTimer) clearTimeout(suppressToggleTimer);
    suppressToggleTimer = setTimeout(() => { suppressToggleClick = false; }, 500);
  }

  function finishDrawerGesture(event, { cancelled = false } = {}) {
    const gesture = drawerGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    drawerGesture = null;
    drawer?.classList.remove('is-swiping');
    safeReleasePointer(drawerToggle, gesture.pointerId);
    if (cancelled) return;

    const nextOpen = resolveDrawerSwipe({
      startX: gesture.startX,
      startY: gesture.startY,
      endX: event.clientX,
      endY: event.clientY,
      open,
    });
    if (gesture.moved) suppressSyntheticClick();
    if (nextOpen === null) return;
    open = nextOpen;
    renderDrawer();
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
    if (suppressToggleClick) {
      suppressToggleClick = false;
      if (suppressToggleTimer) clearTimeout(suppressToggleTimer);
      suppressToggleTimer = null;
      return;
    }
    open = !open;
    renderDrawer();
  });

  drawerToggle?.addEventListener('pointerdown', (event) => {
    if (!mobileQuery.matches || event.isPrimary === false || event.pointerType === 'mouse') return;
    drawerGesture = {
      pointerId: event.pointerId,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    drawer?.classList.add('is-swiping');
    safeCapturePointer(drawerToggle, event.pointerId);
  });

  drawerToggle?.addEventListener('pointermove', (event) => {
    const gesture = drawerGesture;
    if (!gesture || event.pointerId !== gesture.pointerId) return;
    const deltaX = event.clientX - gesture.startX;
    const deltaY = event.clientY - gesture.startY;
    if (Math.abs(deltaY) < DRAWER_GESTURE_SLOP || Math.abs(deltaY) < Math.abs(deltaX)) return;
    gesture.moved = true;
    event.preventDefault();
  });

  drawerToggle?.addEventListener('pointerup', (event) => finishDrawerGesture(event));
  drawerToggle?.addEventListener('pointercancel', (event) => finishDrawerGesture(event, { cancelled: true }));

  document.addEventListener('observer:person-selected', () => activate('people', { reveal: true }));
  document.addEventListener('keydown', (event) => {
    if (event.key !== 'Escape' || !mobileQuery.matches || !open) return;
    open = false;
    renderDrawer();
  });

  mobileQuery.addEventListener?.('change', (event) => {
    drawerGesture = null;
    drawer?.classList.remove('is-swiping');
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
