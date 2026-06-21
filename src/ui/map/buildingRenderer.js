import { isInViewport } from './terrainRenderer.js';

function toScreen(x, y, camera, viewport) {
  return {
    x: (x - camera.x) * camera.zoom + viewport.width / 2,
    y: (y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

function visible(building, camera, viewport) {
  const centerX = building.anchor.x + building.footprint.width / 2;
  const centerY = building.anchor.y + building.footprint.height / 2;
  return isInViewport(centerX, centerY, camera, viewport, Math.max(building.footprint.width, building.footprint.height));
}

function drawSite(context, building, camera, viewport) {
  const origin = toScreen(building.anchor.x, building.anchor.y, camera, viewport);
  const width = building.footprint.width * camera.zoom;
  const height = building.footprint.height * camera.zoom;
  const progress = building.work.required ? building.work.completed / building.work.required : 0;

  context.save();
  context.fillStyle = 'rgba(117, 81, 43, 0.22)';
  context.fillRect(origin.x, origin.y, width, height);
  context.strokeStyle = 'rgba(224, 187, 112, 0.78)';
  context.lineWidth = Math.max(1, camera.zoom * 0.1);
  context.setLineDash([Math.max(3, camera.zoom * 0.35), Math.max(2, camera.zoom * 0.22)]);
  context.strokeRect(origin.x, origin.y, width, height);
  context.setLineDash([]);

  context.strokeStyle = '#745534';
  context.lineWidth = Math.max(1.5, camera.zoom * 0.13);
  for (let x = 1; x < building.footprint.width; x += 2) {
    context.beginPath();
    context.moveTo(origin.x + x * camera.zoom, origin.y + height);
    context.lineTo(origin.x + x * camera.zoom, origin.y + height * 0.32);
    context.stroke();
  }
  context.beginPath();
  context.moveTo(origin.x + camera.zoom * 0.6, origin.y + height * 0.35);
  context.lineTo(origin.x + width - camera.zoom * 0.6, origin.y + height * 0.35);
  context.stroke();

  context.fillStyle = 'rgba(7, 14, 12, 0.58)';
  context.fillRect(origin.x, origin.y - Math.max(15, camera.zoom * 0.85), width, Math.max(12, camera.zoom * 0.65));
  context.fillStyle = '#ecd59d';
  context.font = `${Math.max(10, camera.zoom * 0.48)}px sans-serif`;
  context.fillText(`草棚工地 ${Math.round(progress * 100)}%`, origin.x + Math.max(4, camera.zoom * 0.28), origin.y - Math.max(4, camera.zoom * 0.2));
  context.restore();
}

function drawShelter(context, building, camera, viewport) {
  const origin = toScreen(building.anchor.x, building.anchor.y, camera, viewport);
  const width = building.footprint.width * camera.zoom;
  const height = building.footprint.height * camera.zoom;
  const roofPeakY = origin.y - height * 0.28;

  context.save();
  context.fillStyle = 'rgba(7, 12, 10, 0.25)';
  context.beginPath();
  context.ellipse(origin.x + width * 0.56, origin.y + height * 0.92, width * 0.58, height * 0.15, -0.06, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = '#947047';
  context.fillRect(origin.x + width * 0.08, origin.y + height * 0.28, width * 0.84, height * 0.6);
  context.strokeStyle = '#60432b';
  context.lineWidth = Math.max(1, camera.zoom * 0.08);
  context.strokeRect(origin.x + width * 0.08, origin.y + height * 0.28, width * 0.84, height * 0.6);

  context.fillStyle = '#c4a55f';
  context.beginPath();
  context.moveTo(origin.x - width * 0.03, origin.y + height * 0.34);
  context.lineTo(origin.x + width * 0.5, roofPeakY);
  context.lineTo(origin.x + width * 1.03, origin.y + height * 0.34);
  context.closePath();
  context.fill();
  context.strokeStyle = '#806637';
  context.stroke();

  context.strokeStyle = 'rgba(108, 83, 37, .48)';
  context.lineWidth = Math.max(0.8, camera.zoom * 0.045);
  for (let row = 0; row < 4; row += 1) {
    const y = origin.y + height * (0.1 + row * 0.07);
    context.beginPath();
    context.moveTo(origin.x + width * (0.18 + row * 0.03), y);
    context.lineTo(origin.x + width * (0.82 - row * 0.03), y);
    context.stroke();
  }

  context.fillStyle = '#45301f';
  context.fillRect(origin.x + width * 0.42, origin.y + height * 0.53, width * 0.18, height * 0.35);
  context.restore();
}

export function drawBuildings(context, buildings, camera, viewport) {
  buildings.forEach((building) => {
    if (!visible(building, camera, viewport)) return;
    if (building.status === 'complete') drawShelter(context, building, camera, viewport);
    else drawSite(context, building, camera, viewport);
  });
}
