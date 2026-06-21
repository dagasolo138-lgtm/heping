import { hashSeed } from '../../core/random/seededRandom.js';
import { isInViewport } from './terrainRenderer.js';

function tokenPalette(seed) {
  const value = hashSeed(seed);
  const robes = ['#ba755e', '#80975b', '#6686a2', '#a46b87', '#bc9659', '#6d9a8d'];
  return {
    robe: robes[value % robes.length],
    collar: robes[(value >>> 4) % robes.length],
    hair: value % 3 === 0 ? '#332720' : value % 3 === 1 ? '#201d1b' : '#48342a',
    skin: value % 4 === 0 ? '#d49c77' : value % 4 === 1 ? '#efc095' : value % 4 === 2 ? '#be805f' : '#dfaa83',
  };
}

function toScreen(person, camera, viewport) {
  return {
    x: (person.location.tileX - camera.x) * camera.zoom + viewport.width / 2,
    y: (person.location.tileY - camera.y) * camera.zoom + viewport.height / 2,
  };
}

function drawToken(context, person, point, tileSize, time, selected) {
  const sprite = Math.max(10, tileSize * 1.28);
  const palette = tokenPalette(person.identity.portraitSeed);
  const phase = (hashSeed(person.id) % 29) / 29;
  const bob = Math.sin(time / 500 + phase * Math.PI * 2) * Math.min(1.2, sprite * 0.035);
  const cx = point.x + tileSize * 0.5;
  const cy = point.y + tileSize * 0.58 + bob;

  context.save();
  context.fillStyle = 'rgba(8, 12, 10, 0.3)';
  context.beginPath();
  context.ellipse(cx + sprite * 0.04, point.y + tileSize * 0.93, sprite * 0.33, sprite * 0.1, 0, 0, Math.PI * 2);
  context.fill();

  if (selected) {
    context.strokeStyle = '#f4d48e';
    context.lineWidth = Math.max(1.5, sprite * 0.08);
    context.beginPath();
    context.arc(cx, cy, sprite * 0.48, 0, Math.PI * 2);
    context.stroke();
  }

  context.fillStyle = palette.rope;
  context.fillStyle = palette.robe;
  context.beginPath();
  context.moveTo(cx - sprite * 0.26, cy + sprite * 0.04);
  context.quadraticCurveTo(cx, cy - sprite * 0.01, cx + sprite * 0.26, cy + sprite * 0.04);
  context.lineTo(cx + sprite * 0.3, cy + sprite * 0.42);
  context.quadraticCurveTo(cx, cy + sprite * 0.53, cx - sprite * 0.3, cy + sprite * 0.42);
  context.closePath();
  context.fill();

  context.fillStyle = palette.collar;
  context.globalAlpha = 0.65;
  context.beginPath();
  context.moveTo(cx - sprite * 0.12, cy + sprite * 0.06);
  context.lineTo(cx + sprite * 0.12, cy + sprite * 0.06);
  context.lineTo(cx, cy + sprite * 0.23);
  context.closePath();
  context.fill();
  context.globalAlpha = 1;

  context.fillStyle = palette.skin;
  context.beginPath();
  context.arc(cx, cy - sprite * 0.12, sprite * 0.19, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = palette.hair;
  context.beginPath();
  context.arc(cx, cy - sprite * 0.17, sprite * 0.21, Math.PI, Math.PI * 2);
  context.lineTo(cx + sprite * 0.19, cy - sprite * 0.05);
  context.quadraticCurveTo(cx, cy - sprite * 0.13, cx - sprite * 0.19, cy - sprite * 0.05);
  context.closePath();
  context.fill();

  if (sprite >= 15) {
    context.fillStyle = 'rgba(38, 27, 21, .78)';
    context.beginPath();
    context.arc(cx - sprite * 0.065, cy - sprite * 0.115, Math.max(0.75, sprite * 0.025), 0, Math.PI * 2);
    context.arc(cx + sprite * 0.065, cy - sprite * 0.115, Math.max(0.75, sprite * 0.025), 0, Math.PI * 2);
    context.fill();
  }

  context.restore();
}

export function drawPeopleTokens(context, people, camera, viewport, time, selectedId) {
  people.forEach((person) => {
    if (!person.identity.alive || person.location.tileX === null || person.location.tileY === null) return;
    if (!isInViewport(person.location.tileX, person.location.tileY, camera, viewport, 2)) return;
    drawToken(context, person, toScreen(person, camera, viewport), camera.zoom, time, person.id === selectedId);
  });
}
