import { hashSeed } from '../../core/random/seededRandom.js';
import { isInViewport } from './terrainRenderer.js';

function toScreen(feature, camera, viewport) {
  return {
    x: (feature.x - camera.x) * camera.zoom + viewport.width / 2,
    y: (feature.y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

function drawTree(context, feature, point, size) {
  const unit = Math.max(5, size);
  const seed = hashSeed(feature.id);
  const scale = 0.82 + (seed % 19) / 100;
  const cx = point.x + unit * 0.5;
  const cy = point.y + unit * 0.54;
  const canopy = unit * scale;
  context.save();
  context.fillStyle = 'rgba(10, 20, 14, 0.24)';
  context.beginPath();
  context.ellipse(cx + canopy * 0.14, point.y + unit * 0.92, canopy * 0.6, canopy * 0.17, -0.15, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#65462c';
  context.lineWidth = Math.max(1.1, unit * 0.13);
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(cx, point.y + unit * 0.72);
  context.quadraticCurveTo(cx - unit * 0.04, point.y + unit * 0.55, cx + unit * 0.08, point.y + unit * 0.42);
  context.stroke();
  [
    [-0.22, 0.35, 0.29, '#254f38'], [0.18, 0.29, 0.33, '#1e4632'], [0.02, 0.12, 0.37, '#315f40'],
    [-0.18, 0.09, 0.24, '#40734b'], [0.23, 0.12, 0.22, '#376747'],
  ].forEach(([x, y, radius, color]) => {
    context.fillStyle = color;
    context.beginPath();
    context.arc(cx + canopy * x, point.y + canopy * y + unit * 0.12, canopy * radius, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

function drawStone(context, feature, point, size) {
  const unit = Math.max(5, size);
  const seed = hashSeed(feature.id);
  const cx = point.x + unit * 0.5;
  const cy = point.y + unit * 0.67;
  const radius = unit * (0.32 + (seed % 10) / 100);
  context.save();
  context.fillStyle = 'rgba(9, 13, 12, 0.2)';
  context.beginPath();
  context.ellipse(cx + radius * 0.18, cy + radius * 0.62, radius * 1.2, radius * 0.32, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#aaa89b';
  context.beginPath();
  context.moveTo(cx - radius, cy + radius * 0.55);
  context.quadraticCurveTo(cx - radius * 0.75, cy - radius * 0.75, cx - radius * 0.05, cy - radius);
  context.quadraticCurveTo(cx + radius * 0.78, cy - radius * 0.62, cx + radius, cy + radius * 0.55);
  context.closePath();
  context.fill();
  context.strokeStyle = 'rgba(77, 79, 75, 0.45)';
  context.lineWidth = Math.max(0.8, unit * 0.05);
  context.stroke();
  context.restore();
}

function drawBerryBush(context, feature, point, size) {
  const unit = Math.max(5, size);
  const seed = hashSeed(feature.id);
  const cx = point.x + unit * 0.5;
  const cy = point.y + unit * 0.62;
  context.save();
  ['#315840', '#3e6848', '#275039'].forEach((color, index) => {
    context.fillStyle = color;
    context.beginPath();
    context.arc(cx + (index - 1) * unit * 0.16, cy - (index % 2) * unit * 0.12, unit * (0.25 + index * 0.02), 0, Math.PI * 2);
    context.fill();
  });
  context.fillStyle = '#ba4560';
  for (let index = 0; index < 3; index += 1) {
    const offset = ((seed >>> (index * 4)) & 7) / 7;
    context.beginPath();
    context.arc(cx - unit * 0.18 + index * unit * 0.18, cy - unit * (0.03 + offset * 0.16), Math.max(1.2, unit * 0.07), 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawTreeStump(context, point, size) {
  const unit = Math.max(5, size);
  const cx = point.x + unit * 0.5;
  const cy = point.y + unit * 0.68;
  context.save();
  context.fillStyle = 'rgba(16, 20, 12, .2)';
  context.beginPath();
  context.ellipse(cx + unit * 0.08, cy + unit * 0.18, unit * 0.28, unit * 0.1, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#745033';
  context.beginPath();
  context.ellipse(cx, cy, unit * 0.22, unit * 0.14, 0, 0, Math.PI * 2);
  context.fill();
  context.fillStyle = '#b88a55';
  context.beginPath();
  context.ellipse(cx, cy - unit * 0.02, unit * 0.17, unit * 0.08, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = 'rgba(83, 58, 37, .65)';
  context.lineWidth = Math.max(.7, unit * .045);
  context.beginPath();
  context.arc(cx, cy - unit * 0.02, unit * 0.08, 0, Math.PI * 2);
  context.stroke();
  context.strokeStyle = '#59834b';
  context.lineWidth = Math.max(1, unit * 0.07);
  context.beginPath();
  context.moveTo(cx + unit * 0.06, cy - unit * 0.05);
  context.lineTo(cx + unit * 0.12, cy - unit * 0.27);
  context.stroke();
  context.restore();
}

function drawBerryPatch(context, point, size) {
  const unit = Math.max(5, size);
  const cx = point.x + unit * 0.5;
  const cy = point.y + unit * 0.68;
  context.save();
  context.fillStyle = 'rgba(24, 51, 33, .18)';
  context.beginPath();
  context.ellipse(cx, cy + unit * 0.12, unit * 0.3, unit * 0.1, 0, 0, Math.PI * 2);
  context.fill();
  context.strokeStyle = '#537d48';
  context.lineWidth = Math.max(.8, unit * .05);
  for (let index = -1; index <= 1; index += 1) {
    context.beginPath();
    context.moveTo(cx + index * unit * 0.12, cy + unit * 0.08);
    context.lineTo(cx + index * unit * 0.1, cy - unit * (0.08 + Math.abs(index) * 0.03));
    context.stroke();
  }
  context.fillStyle = '#6ea45d';
  [-0.12, 0, 0.12].forEach((offset) => {
    context.beginPath();
    context.ellipse(cx + offset * unit, cy - unit * 0.1, unit * 0.075, unit * 0.04, -0.45, 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}

function drawCampfire(context, point, size, time, fire) {
  const unit = Math.max(5, size);
  const cx = point.x + unit * 0.5;
  const cy = point.y + unit * 0.65;
  const lit = fire?.lit ?? true;
  const fuelRatio = fire ? Math.max(0, Math.min(1, fire.fuel / fire.maxFuel)) : 1;
  const flame = (0.24 + Math.sin(time / 170) * 0.045) * (0.55 + fuelRatio * 0.45);
  context.save();
  context.strokeStyle = '#65452a';
  context.lineWidth = Math.max(1, unit * 0.12);
  context.lineCap = 'round';
  context.beginPath();
  context.moveTo(cx - unit * 0.25, cy + unit * 0.13);
  context.lineTo(cx + unit * 0.25, cy - unit * 0.06);
  context.moveTo(cx + unit * 0.25, cy + unit * 0.13);
  context.lineTo(cx - unit * 0.25, cy - unit * 0.06);
  context.stroke();

  if (lit) {
    context.fillStyle = `rgba(237, 146, 63, ${0.12 + fuelRatio * 0.16})`;
    context.beginPath();
    context.arc(cx, cy - unit * 0.12, unit * (0.38 + fuelRatio * 0.28), 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#e9903f';
    context.beginPath();
    context.arc(cx, cy - unit * 0.12, unit * flame, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = '#ffe1a0';
    context.beginPath();
    context.arc(cx, cy - unit * 0.16, unit * 0.1, 0, Math.PI * 2);
    context.fill();
  } else {
    context.fillStyle = '#514b44';
    context.beginPath();
    context.ellipse(cx, cy - unit * 0.02, unit * 0.2, unit * 0.09, 0, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawSupplyCrate(context, point, size) {
  const unit = Math.max(5, size);
  const x = point.x + unit * 0.2;
  const y = point.y + unit * 0.37;
  context.save();
  context.fillStyle = '#9a6b3f';
  context.fillRect(x, y, unit * 0.62, unit * 0.46);
  context.strokeStyle = '#4d3220';
  context.lineWidth = Math.max(0.8, unit * 0.06);
  context.strokeRect(x, y, unit * 0.62, unit * 0.46);
  context.beginPath();
  context.moveTo(x, y + unit * 0.12);
  context.lineTo(x + unit * 0.62, y + unit * 0.34);
  context.stroke();
  context.restore();
}

export function drawFeatures(context, map, camera, viewport, time, fire) {
  map.features.forEach((feature) => {
    if (!isInViewport(feature.x, feature.y, camera, viewport, 3)) return;
    const point = toScreen(feature, camera, viewport);
    if (feature.kind === 'tree') drawTree(context, feature, point, camera.zoom);
    if (feature.kind === 'treeStump') drawTreeStump(context, point, camera.zoom);
    if (feature.kind === 'stone') drawStone(context, feature, point, camera.zoom);
    if (feature.kind === 'berryBush') drawBerryBush(context, feature, point, camera.zoom);
    if (feature.kind === 'berryPatch') drawBerryPatch(context, point, camera.zoom);
    if (feature.kind === 'campfire') drawCampfire(context, point, camera.zoom, time, fire);
    if (feature.kind === 'supplyCrate') drawSupplyCrate(context, point, camera.zoom);
  });
}
