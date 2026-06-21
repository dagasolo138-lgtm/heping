import { drawTerrain } from './terrainRenderer.js';
import { drawDaylightOverlay } from './daylightRenderer.js';
import { drawFeatures } from './featureRenderer.js';
import { drawBuildings } from './buildingRenderer.js';
import { drawPeopleTokens } from './personTokenRenderer.js';

function clamp(value, min, max) {
  return Math.max(min, Math.min(max, value));
}

export function createMapView({ canvas, mapSystem, peopleSystem, getRenderPeople, getRenderBuildings, getDayPhase, controls = [], onPersonSelect, onReadout }) {
  const context = canvas.getContext('2d');
  let map = mapSystem.get();
  const camera = {
    x: map.spawnPoint.x,
    y: map.spawnPoint.y,
    zoom: window.innerWidth <= 820 ? 11 : 14,
  };
  let selectedId = null;
  let viewport = { width: 1, height: 1, dpr: 1 };
  let drag = null;
  let frameId = null;
  let lastPaint = 0;
  let dirty = true;

  function renderPeople() {
    return getRenderPeople ? getRenderPeople() : peopleSystem.getAlive();
  }

  function renderBuildings() {
    return getRenderBuildings ? getRenderBuildings() : [];
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

  function paint(time) {
    frameId = requestAnimationFrame(paint);
    if (!dirty && time - lastPaint < 110) return;
    lastPaint = time;
    dirty = false;
    context.clearRect(0, 0, viewport.width, viewport.height);
    context.fillStyle = '#172b28';
    context.fillRect(0, 0, viewport.width, viewport.height);
    drawTerrain(context, map, camera, viewport);
    drawDaylightOverlay(context, viewport, getDayPhase?.());
    drawFeatures(context, map, camera, viewport, time);
    drawBuildings(context, renderBuildings(), camera, viewport);
    drawPeopleTokens(context, renderPeople(), camera, viewport, time, selectedId);
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

  canvas.addEventListener('pointerdown', (event) => {
    canvas.setPointerCapture(event.pointerId);
    drag = { pointerId: event.pointerId, lastX: event.clientX, lastY: event.clientY, moved: false };
  });

  canvas.addEventListener('pointermove', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const dx = event.clientX - drag.lastX;
    const dy = event.clientY - drag.lastY;
    if (Math.abs(dx) + Math.abs(dy) > 2) drag.moved = true;
    camera.x -= dx / camera.zoom;
    camera.y -= dy / camera.zoom;
    drag.lastX = event.clientX;
    drag.lastY = event.clientY;
    clampCamera();
    dirty = true;
  });

  canvas.addEventListener('pointerup', (event) => {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.moved) pickPerson(event);
    drag = null;
  });

  canvas.addEventListener('pointercancel', () => { drag = null; });
  canvas.addEventListener('wheel', (event) => {
    event.preventDefault();
    zoomAt(camera.zoom * (event.deltaY > 0 ? 0.9 : 1.1), event.clientX, event.clientY);
  }, { passive: false });

  controls.forEach((control) => control.addEventListener('click', () => {
    const rect = canvas.getBoundingClientRect();
    if (control.dataset.mapControl === 'zoom-in') zoomAt(camera.zoom * 1.18, rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (control.dataset.mapControl === 'zoom-out') zoomAt(camera.zoom / 1.18, rect.left + rect.width / 2, rect.top + rect.height / 2);
    if (control.dataset.mapControl === 'center') {
      camera.x = map.spawnPoint.x;
      camera.y = map.spawnPoint.y;
      camera.zoom = window.innerWidth <= 820 ? 11 : 14;
      clampCamera();
      dirty = true;
    }
  }));

  window.addEventListener('resize', resize);
  resize();
  frameId = requestAnimationFrame(paint);

  return Object.freeze({
    setSelectedPerson(id) { selectedId = id; dirty = true; },
    setMap(nextMap) { map = nextMap; clampCamera(); dirty = true; },
    focusPerson,
    redraw() { dirty = true; },
    destroy() { window.removeEventListener('resize', resize); cancelAnimationFrame(frameId); },
  });
}
