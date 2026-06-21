import { isInViewport } from './terrainRenderer.js';

function toScreen(feature, camera, viewport) {
  return {
    x: (feature.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (feature.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

function drawTree(context, point, size) {
  const unit = Math.max(3, size);
  context.fillStyle = 'rgba(10, 18, 14, 0.28)';
  context.beginPath();
  context.ellipse(point.x + unit * 0.54, point.y + unit * 0.76, unit * 0.38, unit * 0.14, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#6e4a2f';
  context.fillRect(point.x + unit * 0.43, point.y + unit * 0.42, unit * 0.16, unit * 0.36);
  context.fillStyle = '#1f4f37';
  context.beginPath();
  context.arc(point.x + unit * 0.52, point.y + unit * 0.35, unit * 0.34, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#326b49';
  context.beginPath();
  context.arc(point.x + unit * 0.38, point.y + unit * 0.28, unit * 0.22, 0, Math.PI * 2);
  context.arc(point.x + unit * 0.65, point.y + unit * 0.26, unit * 0.2, 0, Math.PI * 2);
  context.fill();
}

function drawStone(context, point, size) {
  const unit = Math.max(3, size);
  context.fillStyle = 'rgba(9, 13, 12, 0.25)';
  context.beginPath();
  context.ellipse(point.x + unit * 0.56, point.y + unit * 0.75, unit * 0.34, unit * 0.11, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#9b9c91';
  context.beginPath();
  context.moveTo(point.x + unit * 0.24, point.y + unit * 0.7);
  context.lineTo(point.x + unit * 0.34, point.y + unit * 0.36);
  context.lineTo(point.x + unit * 0.68, point.y + unit * 0.27);
  context.lineTo(point.x + unit * 0.82, point.y + unit * 0.67);
  context.closePath();
  context.fill();
}

function drawBerryBush(context, point, size) {
  const unit = Math.max(3, size);
  context.fillStyle = '#315741';
  context.beginPath();
  context.arc(point.x + unit * 0.48, point.y + unit * 0.56, unit * 0.32, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#bc4c68';
  [[0.38, 0.48], [0.6, 0.56], [0.48, 0.67]].forEach(([x, y]) => {
    context.beginPath();
    context.arc(point.x + unit * x, point.y + unit * y, Math.max(1, unit * 0.06), 0, Math.PI * 2);
    context.fill();
  });
}

function drawCampfire(context, point, size, time) {
  const unit = Math.max(3, size);
  context.fillStyle = '#5b4530';
  context.fillRect(point.x + unit * 0.22, point.y + unit * 0.62, unit * 0.56, unit * 0.16);
  const flame = 0.36 + Math.sin(time / 170) * 0.06;
  context.fillStyle = '#f0a44c';
  context.beginPath();
  context.arc(point.x + unit * 0.5, point.y + unit * 0.58, unit * flame, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#ffe1a0';
  context.beginPath();
  context.arc(point.x + unit * 0.5, point.y + unit * 0.57, unit * 0.14, 0, Math.PI * 2);
  context.fill();
}

function drawSupplyCrate(context, point, size) {
  const unit = Math.max(3, size);
  context.fillStyle = '#8e623a';
  context.fillRect(point.x + unit * 0.2, point.y + unit * 0.34, unit * 0.6, unit * 0.48);
  context.strokeStyle = '#4a3020';
  context.lineWidth = Math.max(1, unit * 0.08);
  context.strokeRect(point.x + unit * 0.2, point.y + unit * 0.34, unit * 0.6, unit * 0.48);
}

export function drawFeatures(context, map, camera, viewport, time) {
  map.features.forEach((feature) => {
    if (!isInViewport(feature.x, feature.y, camera, viewport)) return;
    const point = toScreen(feature, camera, viewport);
    if (feature.kind === 'tree') drawTree(context, point, camera.zoom);
    if (feature.kind === 'stone') drawStone(context, point, camera.zoom);
    if (feature.kind === 'berryBush') drawBerryBush(context, point, camera.zoom);
    if (feature.kind === 'campfire') drawCampfire(context, point, camera.zoom, time);
    if (feature.kind === 'supplyCrate') drawSupplyCrate(context, point, camera.zoom);
  });
}
