import { isInViewport } from './terrainRenderer.js';

function toScreen(x, y, camera, viewport) {
  return {
    x: (x - camera.x) * camera.zoom + viewport.width / 2,
    y: (y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

function drawTrail(context, road, point, zoom) {
  const inset = Math.max(1, zoom * 0.18);
  const size = Math.max(2, zoom - inset * 2);
  context.fillStyle = road.stage === 'dirtRoad' ? 'rgba(135, 97, 57, .52)' : 'rgba(125, 98, 62, .23)';
  context.fillRect(point.x + inset, point.y + inset, size, size);

  if (road.stage === 'dirtRoad') {
    context.strokeStyle = 'rgba(91, 67, 42, .34)';
    context.lineWidth = Math.max(.7, zoom * .045);
    context.beginPath();
    context.moveTo(point.x + zoom * .24, point.y + zoom * .2);
    context.lineTo(point.x + zoom * .24, point.y + zoom * .8);
    context.moveTo(point.x + zoom * .7, point.y + zoom * .2);
    context.lineTo(point.x + zoom * .7, point.y + zoom * .8);
    context.stroke();
  }
}

export function drawRoads(context, roads, camera, viewport) {
  if (!roads?.length) return;
  context.save();
  roads.forEach((road) => {
    if (!isInViewport(road.x, road.y, camera, viewport, 1)) return;
    const point = toScreen(road.x, road.y, camera, viewport);
    drawTrail(context, road, point, camera.zoom);
  });
  context.restore();
}
