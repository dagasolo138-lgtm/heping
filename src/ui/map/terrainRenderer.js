import { TERRAIN_META } from '../../data/constants/terrain.js';
import { getTerrainAt } from '../../modules/map/mapQueries.js';

export function drawTerrain(context, map, camera, viewport) {
  const { zoom } = camera;
  const startX = Math.max(0, Math.floor(camera.x - viewport.width / (2 * zoom)) - 1);
  const endX = Math.min(map.geometry.width - 1, Math.ceil(camera.x + viewport.width / (2 * zoom)) + 1);
  const startY = Math.max(0, Math.floor(camera.y - viewport.height / (2 * zoom)) - 1);
  const endY = Math.min(map.geometry.height - 1, Math.ceil(camera.y + viewport.height / (2 * zoom)) + 1);

  for (let y = startY; y <= endY; y += 1) {
    for (let x = startX; x <= endX; x += 1) {
      const terrain = getTerrainAt(map, x, y);
      context.fillStyle = TERRAIN_META[terrain].color;
      context.fillRect((x - camera.x) * zoom + viewport.width / 2, (y - camera.y) * zoom + viewport.height / 2, zoom + 0.5, zoom + 0.5);
    }
  }

  if (zoom >= 18) {
    context.strokeStyle = 'rgba(229, 242, 234, 0.09)';
    context.lineWidth = 1;
    context.beginPath();
    for (let x = startX; x <= endX + 1; x += 1) {
      const screenX = (x - camera.x) * zoom + viewport.width / 2;
      context.moveTo(screenX, 0);
      context.lineTo(screenX, viewport.height);
    }
    for (let y = startY; y <= endY + 1; y += 1) {
      const screenY = (y - camera.y) * zoom + viewport.height / 2;
      context.moveTo(0, screenY);
      context.lineTo(viewport.width, screenY);
    }
    context.stroke();
  }
}

export function isInViewport(x, y, camera, viewport, padding = 2) {
  const halfWidth = viewport.width / (2 * camera.zoom) + padding;
  const halfHeight = viewport.height / (2 * camera.zoom) + padding;
  return x >= camera.x - halfWidth && x <= camera.x + halfWidth && y >= camera.y - halfHeight && y <= camera.y + halfHeight;
}
