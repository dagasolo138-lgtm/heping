import { isInViewport } from './terrainRenderer.js';

function toScreen(x, y, camera, viewport) {
  return {
    x: (x - camera.x) * camera.zoom + viewport.width / 2,
    y: (y - camera.y) * camera.zoom + viewport.height / 2,
  };
}

function visible(field, camera, viewport) {
  const centerX = field.anchor.x + field.footprint.width / 2;
  const centerY = field.anchor.y + field.footprint.height / 2;
  return isInViewport(centerX, centerY, camera, viewport, Math.max(field.footprint.width, field.footprint.height));
}

function soilPalette(field) {
  return ({
    rich: { fill: [105, 87, 47], rows: 'rgba(227, 196, 118, .34)', dot: '#d9c36b' },
    steady: { fill: [93, 70, 42], rows: 'rgba(199, 157, 91, .3)', dot: '#b8bd70' },
    poor: { fill: [77, 61, 45], rows: 'rgba(161, 130, 93, .26)', dot: '#d69a6c' },
    thin: { fill: [62, 55, 48], rows: 'rgba(129, 116, 94, .24)', dot: '#c47a70' },
  }[field.soil?.id] ?? { fill: [93, 70, 42], rows: 'rgba(199, 157, 91, .3)', dot: '#b8bd70' });
}

function drawSoil(context, field, origin, zoom) {
  const width = field.footprint.width * zoom;
  const height = field.footprint.height * zoom;
  const progress = field.clearing.required ? field.clearing.completed / field.clearing.required : 0;
  const alpha = field.status === 'planned' ? 0.16 : 0.72;
  const palette = soilPalette(field);
  context.fillStyle = `rgba(${palette.fill.join(', ')}, ${alpha})`;
  context.fillRect(origin.x, origin.y, width, height);

  context.strokeStyle = field.status === 'planned' ? 'rgba(224, 190, 110, .55)' : 'rgba(73, 49, 30, .55)';
  context.lineWidth = Math.max(.7, zoom * .045);
  context.setLineDash(field.status === 'planned' ? [Math.max(3, zoom * .22), Math.max(2, zoom * .12)] : []);
  context.strokeRect(origin.x, origin.y, width, height);
  context.setLineDash([]);

  if (field.status !== 'planned') {
    context.strokeStyle = palette.rows;
    for (let row = 0; row < field.footprint.height; row += 1) {
      const y = origin.y + (row + .55) * zoom;
      context.beginPath();
      context.moveTo(origin.x + zoom * .2, y);
      context.lineTo(origin.x + width - zoom * .2, y);
      context.stroke();
    }
  }

  if (field.status === 'clearing') {
    context.fillStyle = 'rgba(229, 199, 123, .76)';
    context.fillRect(origin.x, origin.y - Math.max(11, zoom * .58), width * Math.max(.08, progress), Math.max(6, zoom * .22));
  }
}

function drawCrop(context, field, origin, zoom) {
  const growth = Math.max(0, Math.min(1, field.growth.progressed / field.growth.required));
  const mature = field.status === 'mature';
  const dormant = field.seasonal?.id === 'dormant';
  const stalkHeight = zoom * (0.16 + growth * 0.34);
  const color = mature ? '#d7b955' : dormant ? '#8d9a78' : '#7faa4e';

  context.strokeStyle = color;
  context.lineWidth = Math.max(.7, zoom * .045);
  for (let row = 0; row < field.footprint.height; row += 1) {
    for (let column = 0; column < field.footprint.width; column += 1) {
      const x = origin.x + (column + .5) * zoom;
      const y = origin.y + (row + .67) * zoom;
      context.beginPath();
      context.moveTo(x, y);
      context.lineTo(x + ((row + column) % 2 ? zoom * .06 : -zoom * .05), y - stalkHeight);
      context.stroke();
      if (mature) {
        context.fillStyle = '#ead172';
        context.beginPath();
        context.ellipse(x, y - stalkHeight, Math.max(1, zoom * .055), Math.max(1.4, zoom * .1), -.35, 0, Math.PI * 2);
        context.fill();
      }
    }
  }
}

function fieldLabel(field) {
  if (field.status === 'mature') return '成熟待收';
  if (field.status === 'growing') {
    if (field.seasonal?.id === 'dormant') return field.seasonal.label;
    return `生长中 ${Math.round((field.growth.progressed / field.growth.required) * 100)}%`;
  }
  if (field.status === 'readyToSow') return field.seasonal?.label ?? '待播种';
  if (field.status === 'clearing') return '开垦中';
  return '待开垦';
}

export function drawFarms(context, fields, camera, viewport) {
  if (!fields?.length) return;
  context.save();
  fields.forEach((field) => {
    if (!visible(field, camera, viewport)) return;
    const origin = toScreen(field.anchor.x, field.anchor.y, camera, viewport);
    drawSoil(context, field, origin, camera.zoom);
    if (field.status === 'growing' || field.status === 'mature') drawCrop(context, field, origin, camera.zoom);

    const label = fieldLabel(field);
    const labelHeight = Math.max(11, camera.zoom * .55);
    context.fillStyle = 'rgba(10, 17, 13, .58)';
    context.fillRect(origin.x, origin.y - Math.max(14, camera.zoom * .72), field.footprint.width * camera.zoom, labelHeight);
    context.fillStyle = '#e7d5a0';
    context.font = `${Math.max(9, camera.zoom * .4)}px sans-serif`;
    context.fillText(`${field.label} · ${label}`, origin.x + Math.max(3, camera.zoom * .18), origin.y - Math.max(4, camera.zoom * .18));
    const palette = soilPalette(field);
    context.fillStyle = palette.dot;
    context.beginPath();
    context.arc(origin.x + field.footprint.width * camera.zoom - Math.max(5, camera.zoom * .28), origin.y - labelHeight / 2, Math.max(2, camera.zoom * .1), 0, Math.PI * 2);
    context.fill();
  });
  context.restore();
}
