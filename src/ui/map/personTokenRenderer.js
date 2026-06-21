import { hashSeed } from '../../core/random/seededRandom.js';
import { isInViewport } from './terrainRenderer.js';

function tokenPalette(seed) {
  const value = hashSeed(seed);
  const hue = 12 + (value % 5) * 22;
  return {
    cloak: `hsl(${hue} 40% 52%)`,
    hair: value % 2 ? '#35271f' : '#1e1b19',
    skin: value % 3 === 0 ? '#d9a27c' : value % 3 === 1 ? '#edbd92' : '#bc7d5c',
  };
}

function toScreen(person, camera, viewport) {
  return {
    x: (person.location.tileX - camera.x) * camera.zoom + viewport.width / 2,
    y: (person.location.tileY - camera.y) * camera.zoom + viewport.height / 2,
  };
}

function drawToken(context, person, point, size, time, selected) {
  const unit = Math.max(3, size);
  const palette = tokenPalette(person.identity.portraitSeed);
  const bob = Math.sin(time / 480 + (hashSeed(person.id) % 17)) * Math.min(1.3, unit * 0.06);
  const cx = point.x + unit * 0.5;
  const cy = point.y + unit * 0.57 + bob;

  context.fillStyle = 'rgba(8, 12, 10, 0.32)';
  context.beginPath();
  context.ellipse(cx, point.y + unit * 0.83, unit * 0.26, unit * 0.1, 0, 0, Math.PI * 2);
  context.fill();

  if (selected) {
    context.strokeStyle = '#f4d48e';
    context.lineWidth = Math.max(1.5, unit * 0.09);
    context.beginPath();
    context.arc(cx, cy, unit * 0.46, 0, Math.PI * 2);
    context.stroke();
  }

  context.fillStyle = palette.cloak;
  context.beginPath();
  context.moveTo(cx - unit * 0.22, cy + unit * 0.1);
  context.lineTo(cx + unit * 0.22, cy + unit * 0.1);
  context.lineTo(cx + unit * 0.29, cy + unit * 0.46);
  context.lineTo(cx - unit * 0.29, cy + unit * 0.46);
  context.closePath();
  context.fill();

  context.fillStyle = palette.skin;
  context.beginPath();
  context.arc(cx, cy - unit * 0.09, unit * 0.19, 0, Math.PI * 2);
  context.fill();

  context.fillStyle = palette.hair;
  context.beginPath();
  context.arc(cx, cy - unit * 0.15, unit * 0.2, Math.PI, Math.PI * 2);
  context.fill();

  if (unit >= 12) {
    context.fillStyle = 'rgba(29, 24, 20, .8)';
    context.fillRect(cx - unit * 0.075, cy - unit * 0.08, unit * 0.035, unit * 0.035);
    context.fillRect(cx + unit * 0.04, cy - unit * 0.08, unit * 0.035, unit * 0.035);
  }
}

export function drawPeopleTokens(context, people, camera, viewport, time, selectedId) {
  people.forEach((person) => {
    if (!person.identity.alive || person.location.tileX === null || person.location.tileY === null) return;
    if (!isInViewport(person.location.tileX, person.location.tileY, camera, viewport)) return;
    drawToken(context, person, toScreen(person, camera, viewport), camera.zoom, time, person.id === selectedId);
  });
}
