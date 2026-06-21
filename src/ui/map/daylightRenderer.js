export function drawDaylightOverlay(context, viewport, phase) {
  const opacity = Number(phase?.lightOpacity ?? 0);
  if (opacity <= 0) return;

  context.save();
  const gradient = context.createLinearGradient(0, 0, 0, viewport.height);
  if (phase.id === 'dusk') {
    gradient.addColorStop(0, 'rgba(95, 59, 48, 0.14)');
    gradient.addColorStop(1, `rgba(15, 26, 31, ${opacity})`);
  } else if (phase.id === 'dawn') {
    gradient.addColorStop(0, 'rgba(218, 170, 114, 0.1)');
    gradient.addColorStop(1, `rgba(31, 50, 63, ${opacity})`);
  } else {
    gradient.addColorStop(0, `rgba(10, 20, 43, ${opacity * 0.72})`);
    gradient.addColorStop(1, `rgba(3, 10, 22, ${opacity})`);
  }
  context.fillStyle = gradient;
  context.fillRect(0, 0, viewport.width, viewport.height);

  if (phase.id === 'night') {
    context.fillStyle = 'rgba(219, 230, 250, 0.28)';
    context.beginPath();
    context.arc(viewport.width * 0.82, viewport.height * 0.14, Math.max(8, viewport.width * 0.018), 0, Math.PI * 2);
    context.fill();
  }
  context.restore();
}
