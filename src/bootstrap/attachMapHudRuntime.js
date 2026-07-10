function ensureToggle(mapWrap) {
  let toggle = mapWrap.querySelector('#map-hud-toggle');
  if (toggle) return toggle;
  toggle = document.createElement('button');
  toggle.id = 'map-hud-toggle';
  toggle.className = 'map-hud-toggle';
  toggle.type = 'button';
  toggle.setAttribute('aria-controls', 'map-canvas');
  mapWrap.append(toggle);
  return toggle;
}

function applyState(mapWrap, toggle, collapsed) {
  mapWrap.classList.toggle('is-hud-collapsed', collapsed);
  toggle.setAttribute('aria-expanded', String(!collapsed));
  toggle.textContent = collapsed ? '地图信息' : '收起信息';
  toggle.setAttribute('aria-label', collapsed ? '展开地图信息' : '收起地图信息');
}

export function attachMapHudRuntime() {
  const runtime = globalThis.shengling;
  if (!runtime) throw new Error('地图信息模块启动失败：世界运行时尚未初始化。');
  if (runtime.mapHudRuntime) return runtime.mapHudRuntime;

  const mapWrap = document.querySelector('.map-canvas-wrap');
  if (!mapWrap) throw new Error('地图信息模块启动失败：找不到地图容器。');
  const toggle = ensureToggle(mapWrap);
  let collapsed = true;

  applyState(mapWrap, toggle, collapsed);
  toggle.addEventListener('click', () => {
    collapsed = !collapsed;
    applyState(mapWrap, toggle, collapsed);
  });

  const api = Object.freeze({
    isCollapsed: () => collapsed,
    setCollapsed(next) {
      collapsed = Boolean(next);
      applyState(mapWrap, toggle, collapsed);
    },
  });
  globalThis.shengling = Object.freeze({ ...runtime, mapHudRuntime: api });
  return api;
}
