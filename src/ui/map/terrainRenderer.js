import { hashSeed } from '../../core/random/seededRandom.js';
import { TERRAIN } from '../../data/constants/terrain.js';
import { getTerrainAt } from '../../modules/map/mapQueries.js';

function visibleBounds(camera, viewport, padding = 3) {
  const halfWidth = viewport.width / (2 * camera.zoom) + padding;
  const halfHeight = viewport.height / (2 * camera.zoom) + padding;
  return {
    startX: Math.floor(camera.x - halfWidth),
    endX: Math.ceil(camera.x + halfWidth),
    startY: Math.floor(camera.y - halfHeight),
    endY: Math.ceil(camera.y + halfHeight),
  };
}

function worldToScreen(x, y, camera, viewport) {
  return {
    x: (x - camera.x) * camera.zoom + viewport.width / 2,
    y: (y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

function findWaterBand(map, y, accepted) {
  let first = -1;
  let last = -1;
  for (let x = 0; x < map.geometry.width; x += 1) {
    if (!accepted.has(getTerrainAt(map, x, y))) continue;
    if (first === -1) first = x;
    last = x;
  }
  if (first === -1) return null;
  return { center: (first + last + 1) / 2, width: last - first + 1 };
}

function drawRiver(context, map, camera, viewport) {
  const shallowTypes = new Set([TERRAIN.SHALLOW_WATER, TERRAIN.DEEP_WATER]);
  const deepTypes = new Set([TERRAIN.DEEP_WATER]);
  const shallow = [];
  const deep = [];

  for (let y = 0; y < map.geometry.height; y += 1) {
    const shallowBand = findWaterBand(map, y, shallowTypes);
    const deepBand = findWaterBand(map, y, deepTypes);
    if (shallowBand) shallow.push({ y: y + 0.5, ...shallowBand });
    if (deepBand) deep.push({ y: y + 0.5, ...deepBand });
  }

  function strokeBand(points, color, widthMultiplier) {
    if (points.length < 2) return;
    context.beginPath();
    points.forEach((point, index) => {
      const screen = worldToScreen(point.center, point.y, camera, viewport);
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
    const averageWidth = points.reduce((sum, point) => sum + point.width, 0) / points.length;
    context.lineCap = 'round';
    context.lineJoin = 'round';
    context.strokeStyle = color;
    context.lineWidth = Math.max(3, averageWidth * camera.zoom * widthMultiplier);
    context.stroke();
  }

  context.save();
  strokeBand(shallow, 'rgba(153, 196, 191, 0.72)', 1.18);
  strokeBand(shallow, 'rgba(111, 165, 171, 0.84)', 0.93);
  strokeBand(deep, 'rgba(53, 112, 134, 0.94)', 0.95);

  if (deep.length > 1) {
    context.beginPath();
    deep.forEach((point, index) => {
      const screen = worldToScreen(point.center + Math.sin(point.y * 0.42) * 0.45, point.y, camera, viewport);
      if (index === 0) context.moveTo(screen.x, screen.y);
      else context.lineTo(screen.x, screen.y);
    });
    context.strokeStyle = 'rgba(219, 239, 229, 0.28)';
    context.lineWidth = Math.max(1, camera.zoom * 0.11);
    context.stroke();
  }
  context.restore();
}

function drawCampGround(context, map, camera, viewport) {
  const { x, y } = map.spawnPoint;
  const seed = hashSeed(`${map.seed}:camp`);
  context.save();
  context.beginPath();
  for (let index = 0; index <= 18; index += 1) {
    const angle = (Math.PI * 2 * index) / 18;
    const noise = ((seed >>> (index % 16)) & 7) / 8;
    const radiusX = 12.5 + Math.sin(index * 1.83) * 1.6 + noise;
    const radiusY = 10.5 + Math.cos(index * 1.47) * 1.35 + noise;
    const point = worldToScreen(x + Math.cos(angle) * radiusX, y + Math.sin(angle) * radiusY, camera, viewport);
    if (index === 0) context.moveTo(point.x, point.y);
    else context.lineTo(point.x, point.y);
  }
  context.closePath();
  context.fillStyle = '#977647';
  context.fill();
  context.strokeStyle = 'rgba(76, 56, 33, 0.38)';
  context.lineWidth = Math.max(1, camera.zoom * 0.075);
  context.stroke();

  context.globalAlpha = 0.22;
  for (let index = 0; index < 18; index += 1) {
    const point = worldToScreen(x - 9 + (index % 6) * 3.5, y - 6 + Math.floor(index / 6) * 5.5, camera, viewport);
    context.fillStyle = index % 2 ? '#b58d55' : '#765c39';
    context.beginPath();
    context.ellipse(point.x, point.y, camera.zoom * 0.75, camera.zoom * 0.26, -0.5, 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}

function drawTerrainWash(context, map, camera, viewport) {
  const bounds = visibleBounds(camera, viewport);
  const step = 4;
  context.save();

  for (let y = Math.max(0, bounds.startY); y <= Math.min(map.geometry.height - 1, bounds.endY); y += step) {
    for (let x = Math.max(0, bounds.startX); x <= Math.min(map.geometry.width - 1, bounds.endX); x += step) {
      const terrain = getTerrainAt(map, x, y);
      const random = hashSeed(`${map.seed}:${x}:${y}`) / 4294967295;
      const point = worldToScreen(x + 2, y + 2, camera, viewport);
      const radius = camera.zoom * (2.5 + random * 2.1);

      if (terrain === TERRAIN.FOREST_FLOOR) {
        context.fillStyle = `rgba(29, 73, 51, ${0.16 + random * 0.08})`;
        context.beginPath();
        context.ellipse(point.x, point.y, radius, radius * 0.72, random * Math.PI, 0, Math.PI * 2);
        context.fill();
      }

      if (terrain === TERRAIN.STONE_GROUND) {
        context.fillStyle = `rgba(132, 132, 119, ${0.18 + random * 0.1})`;
        context.beginPath();
        context.ellipse(point.x, point.y, radius * 0.92, radius * 0.48, random * Math.PI, 0, Math.PI * 2);
        context.fill();
      }

      if (terrain === TERRAIN.TALL_GRASS || terrain === TERRAIN.GRASS) {
        const bladeCount = terrain === TERRAIN.TALL_GRASS ? 4 : 2;
        context.strokeStyle = terrain === TERRAIN.TALL_GRASS ? 'rgba(45, 100, 62, 0.42)' : 'rgba(96, 137, 79, 0.24)';
        context.lineWidth = Math.max(0.6, camera.zoom * 0.045);
        for (let blade = 0; blade < bladeCount; blade += 1) {
          const offset = (blade - bladeCount / 2) * camera.zoom * 0.24;
          context.beginPath();
          context.moveTo(point.x + offset, point.y + camera.zoom * 0.54);
          context.quadraticCurveTo(point.x + offset + camera.zoom * (random - 0.5) * 0.8, point.y, point.x + offset + camera.zoom * (random - 0.5) * 0.45, point.y - camera.zoom * 0.3);
          context.stroke();
        }
      }
    }
  }
  context.restore();
}

function drawFineGrid(context, map, camera, viewport) {
  if (camera.zoom < 24) return;
  const bounds = visibleBounds(camera, viewport, 1);
  context.save();
  context.strokeStyle = 'rgba(240, 247, 231, 0.075)';
  context.lineWidth = 1;
  context.beginPath();
  for (let x = Math.max(0, bounds.startX); x <= Math.min(map.geometry.width, bounds.endX + 1); x += 1) {
    const point = worldToScreen(x, 0, camera, viewport);
    context.moveTo(point.x, 0);
    context.lineTo(point.x, viewport.height);
  }
  for (let y = Math.max(0, bounds.startY); y <= Math.min(map.geometry.height, bounds.endY + 1); y += 1) {
    const point = worldToScreen(0, y, camera, viewport);
    context.moveTo(0, point.y);
    context.lineTo(viewport.width, point.y);
  }
  context.stroke();
  context.restore();
}

export function drawTerrain(context, map, camera, viewport) {
  const gradient = context.createLinearGradient(0, 0, viewport.width, viewport.height);
  gradient.addColorStop(0, '#668e60');
  gradient.addColorStop(0.52, '#547f58');
  gradient.addColorStop(1, '#3d684c');
  context.fillStyle = gradient;
  context.fillRect(0, 0, viewport.width, viewport.height);

  drawTerrainWash(context, map, camera, viewport);
  drawRiver(context, map, camera, viewport);
  drawCampGround(context, map, camera, viewport);
  drawFineGrid(context, map, camera, viewport);
}

export function isInViewport(x, y, camera, viewport, padding = 2) {
  const halfWidth = viewport.width / (2 * camera.zoom) + padding;
  const halfHeight = viewport.height / (2 * camera.zoom) + padding;
  return x >= camera.x - halfWidth && x <= camera.x + halfWidth && y >= camera.y - halfHeight && y <= camera.y + halfHeight;
}
