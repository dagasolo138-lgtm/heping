import { drawTerrain } from './terrainRenderer.js';
import { drawRoads } from './roadRenderer.js';
import { drawFarms } from './farmRenderer.js';
import { drawDaylightOverlay } from './daylightRenderer.js';
import { drawWeatherOverlay } from './weatherRenderer.js';
import { drawFeatures } from './featureRenderer.js';
import { drawBuildings } from './buildingRenderer.js';
import { drawPeopleTokens } from './personTokenRenderer.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

function distance(first, second) {
  return Math.hypot(first.x - second.x, first.y - second.y);
}

function midpoint(first, second) {
  return { x: (first.x + second.x) / 2, y: (first.y + second.y) / 2 };
}

export function createMapView({ canvas, mapSystem, peopleSystem, getRenderPeople, getRenderBuildings, getDayPhase, getWeather, getFire, controls = [], onPersonSelect, onReadout }) {
  const context = canvas.getContext('2d');
  let map = mapSystem.get();
  const camera = {
    x: map.spawnPoint.x,
    y: map.spawnPoint.y,
    zoom: window.innerWidth <= 820 ? 11 : 14,
  };
  let selectedId = null;
  let viewport = { width: 1, height: 1, dpr: 1 };
  const pointers = new Map();
  let drag = null;
  let pinch = null;
  let suppressTap = false;
  let frameId = null;
  let lastPaint = 0;
  let dirty = true;

  canvas.tabIndex = 0;

  function renderPeople() {
    return getRenderPeople ? getRenderPeople() : peopleSystem.getAlive();
  }

  function renderBuildings() {
    return getRenderBuildings ? getRenderBuildings() : [];
  }

  function renderRoads() {
    return globalThis.shengling?.roadSystem?.listRoads?.() ?? [];
  }

  function renderFarms() {
    return globalThis.shengling?.farmSystem?.listFields?.() ?? [];
  }

  function clampCamera() {
    const halfWidth = viewport.width / (2 * camera.zoom);
    const halfHeight = viewport.height / (2 * camera.zoom);
    camera.x = clamp(camera.x, Math.min(halfWidth, map.geometry.width / 2), Math.max(map.geometry.width - halfWidth, map.geometry.width / 2));
    camera.y = clamp(camera.y, Math.min(halfHeight, map.geometry.height / 2), Math.max(map.geometry.height - halfHeight, map.geometry.height / 2));
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    viewport = { width: Math.max(1, rect.width), height: Math.max(1, rect.height), dpr: Math.min(window.devicePixelRatio || 1, 2) };
    canvas.width = Math.round(viewport.width * viewport.dpr);
    canvas.height = Math.round(viewport.height * viewport.dpr);
    context.setTransform(viewport.dpr, 0, 0, viewport.dpr, 0, 0);
    clampCamera();
    dirty = true;
  }

  function worldFromClient(clientX, clientY) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: camera.x + (clientX - rect.left - viewport.width / 2) / camera.zoom,
      y: camera.y + (clientY - rect.top - viewport.height / 2) / camera.zoom,
    };
  }

  function canvasCenter() {
    const rect = canvas.getBoundingClientRect();
    return { x: rect.left + rect.width / 2, y: rect.top + rect.height / 2 };
  }

  function zoomAt(nextZoom, clientX, clientY) {
    const before = worldFromClient(clientX, clientY);
    camera.zoom = clamp(nextZoom, 6, 28);
    const after = worldFromClient(clientX, clientY);
    camera.x += before.x - after.x;
    camera.y += before.y - after.y;
    clampCamera();
    dirty = true;
  }

  function focusPerson(person) {
    if (!person || person.location.tileX === null) return;
    camera.x = person.location.tileX + 0.5;
    camera.y = person.location.tileY + 0.5;
    camera.zoom = Math.max(camera.zoom, 15);
    clampCamera();
    dirty = true;
  }

  function centerOnCamp() {
    camera.x = map.spawnPoint.x;
    camera.y = map.spawnPoint.y;
    camera.zoom = window.innerWidth <= 820 ? 11 : 14;
    clampCamera();
    dirty = true;
  }

  function paint(time) {
    frameId = requestAnimationFrame(paint);
    if (!dirty && time - lastPaint < 110) return;
    lastPaint = time;
    dirty = false;
    const phase = getDayPhase?.();
    const weather = getWeather?.();
    const fire = getFire?.();
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.fillStyle = '#172b28';
    context.fillRect(0, 0, viewport.width, viewport.height);
    drawTerrain(context, map, camera, viewport);
    drawRoads(context, renderRoads(), camera, viewport);
    drawFarms(context, renderFarms(), camera, viewport);
    drawDaylightOverlay(context, viewport, phase);
    drawFeatures(context, map, camera, viewport, time, fire);
    drawBuildings(context, renderBuildings(), camera, viewport);
    drawPeopleTokens(context, renderPeople(), camera, viewport, time, selectedId);
    drawWeatherOverlay(context, viewport, weather, time);
    onReadout?.({ x: Math.round(camera.x), y: Math.round(camera.y), zoom: camera.zoom });
  }

  function pickPerson(event) {
    const point = worldFromClient(event.clientX, event.clientY);
    const candidate = renderPeople()
      .filter((person) => person.location.tileX !== null)
      .map((person) => ({ person, distance: Math.hypot(person.location.tileX + 0.5 - point.x, person.location.tileY + 0.5 - point.y) }))
      .sort((first, second) => first.distance - second.distance)[0];
    if (candidate && candidate.distance < Math.max(0.9, 11 / camera.zoom)) onPersonSelect?.(candidate.person.id);
  }

  function startDrag(pointerId, point) {
    drag = { pointerId, lastX: point.x, lastY: point.y, moved: false };
  }

  function startPinch() {
    const [first, second] = [...pointers.values()];
    if (!first || !second) {
      pinch = null;
      return;
    }
    pinch = { distance: Math.max(1, distance(first, second)), center: midpoint(first, second), moved: false };
  }

  function releasePointer(event) {
    if (canvas.hasPointerCapture?.(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
  }

  canvas.addEventListener('pointerdown', (event) => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    if (event.cancelable) event.preventDefault();
    canvas.focus({ preventScroll: true });
    canvas.setPointerCapture(event.pointerId);
    pointers.set(event.pointerId, { x: event.clientX, y: event.clientY });

    if (pointers.size === 1) {
      suppressTap = false;
      pinch = null;
      startDrag(event.pointerId, pointers.get(event.pointerId));
    } else if (pointers.size === 2) {
      suppressTap = true;
      drag = null;
      startPinch();
    } else {
      suppressTap = true;
      drag = null;
      pinch = null;
    }
  });

  canvas.addEventListener('pointermove', (event) => {
    const previous = pointers.get(event.pointerId);
    if (!previous) return;
    if (event.cancelable) event.preventDefault();
    const point = { x: event.clientX, y: event.clientY };
    pointers.set(event.pointerId, point);

    if (pointers.size === 1 && drag?.pointerId === event.pointerId) {
      const dx = point.x - drag.lastX;
      const dy = point.y - drag.lastY;
      if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
      camera.x -= dx / camera.zoom;
      camera.y -= dy / camera.zoom;
      drag.lastX = point.x;
      drag.lastY = point.y;
      clampCamera();
      dirty = true;
      return;
    }

    if (pointers.size === 2) {
      if (!pinch) startPinch();
      if (!pinch) return;
      const [first, second] = [...pointers.values()];
      const nextDistance = Math.max(1, distance(first, second));
      const nextCenter = midpoint(first, second);
      const distanceDelta = nextDistance / pinch.distance;
      const panX = nextCenter.x - pinch.center.x;
      const panY = nextCenter.y - pinch.center.y;
      if (Math.abs(nextDistance - pinch.distance) + Math.abs(panX) + Math.abs(panY) > 2) pinch.moved = true;
      zoomAt(camera.zoom * distanceDelta, nextCenter.x, nextCenter.y);
      camera.x -= panX / camera.zoom;
      camera.y -= panY / camera.zoom;
      clampCamera();
      pinch.distance = nextDistance;
      pinch.center = nextCenter;
      dirty = true;
    }
  });

  function finishPointer(event, cancelled = false) {
    const wasTap = !cancelled && pointers.size === 1 && drag?.pointerId === event.pointerId && !drag.moved && !suppressTap;
    pointers.delete(event.pointerId);
    releasePointer(event);

    if (wasTap) pickPerson(event);
    if (pointers.size === 1) {
      const [pointerId, point] = [...pointers.entries()][0];
      pinch = null;
      suppressTap = true;
      startDrag(pointerId, point);
      return;
    }
    if (pointers.size === 2) {
      drag = null;
      suppressTap = true;
      startPinch();
      return;
    }
    drag = null;
    pinch = null;
    suppressTap = false;
  }

  canvas.addEventListener('pointerup', (event) => finishPointer(event));
  canvas.addEventListener('pointercancel', (event) => finishPointer(event, true));
  canvas.addEventListener('lostpointercapture', (event) => {
    if (pointers.has(event.pointerId)) finishPointer(event, true);
  });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY);
  }, { passive: false });
  canvas.addEventListener('keydown', (event) => {
    const center = canvasCenter();
    const panStep = Math.max(2, Math.min(12, viewport.width / camera.zoom * 0.08));
    let handled = true;
    if (event.key === 'ArrowLeft') camera.x -= panStep;
    else if (event.key === 'ArrowRight') camera.x += panStep;
    else if (event.key === 'ArrowUp') camera.y -= panStep;
    else if (event.key === 'ArrowDown') camera.y += panStep;
    else if (event.key === '+' || event.key === '=') zoomAt(camera.zoom * 1.18, center.x, center.y);
    else if (event.key === '-' || event.key === '_') zoomAt(camera.zoom / 1.18, center.x, center.y);
    else if (event.key === 'Home') centerOnCamp();
    else handled = false;
    if (!handled) return;
    event.preventDefault();
    clampCamera();
    dirty = true;
  });

  controls.forEach((control) => control.addEventListener('click', () => {
    const center = canvasCenter();
    if (control.dataset.mapControl === 'zoom-in') zoomAt(camera.zoom * 1.18, center.x, center.y);
    if (control.dataset.mapControl === 'zoom-out') zoomAt(camera.zoom / 1.18, center.x, center.y);
    if (control.dataset.mapControl === 'center') centerOnCamp();
  }));

  window.addEventListener('resize', resize);
  window.addEventListener('blur', () => {
    pointers.clear();
    drag = null;
    pinch = null;
    suppressTap = false;
  });
  resize();
  frameId = requestAnimationFrame(paint);

  return Object.freeze({
    setSelectedPerson(id) { selectedId = id; dirty = true; },
    setMap(nextMap) { map = nextMap; clampCamera(); dirty = true; },
    focusPerson,
    centerOnCamp,
    redraw() { dirty = true; },
    destroy() { window.removeEventListener('resize', resize); cancelAnimationFrame(frameId); },
  });
}
