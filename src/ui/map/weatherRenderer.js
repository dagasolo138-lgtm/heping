function randomUnit(index, time) {
  const value = Math.sin(index * 92.17 + time * 0.0031) * 43758.5453;
  return value - Math.floor(value);
}

export function drawWeatherOverlay(context, viewport, weather, time) {
  if (!weather?.isRain) return;
  const density = weather.id === 'coldRain' ? 105 : 68;
  const length = weather.id === 'coldRain' ? 15 : 11;
  context.save();
  context.strokeStyle = weather.id === 'coldRain' ? 'rgba(185, 211, 231, .38)' : 'rgba(179, 210, 225, .3)';
  context.lineWidth = 1;
  for (let index = 0; index < density; index += 1) {
    const x = randomUnit(index, time) * viewport.width;
    const y = (randomUnit(index + 300, time) * viewport.height + time * 0.17) % viewport.height;
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x - length * 0.27, y + length);
    context.stroke();
  }
  context.restore();
}
