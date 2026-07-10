export function createUiRenderScheduler({
  render,
  maxFps = 10,
  now = () => performance.now(),
  requestFrame = (callback) => requestAnimationFrame(callback),
  cancelFrame = (id) => cancelAnimationFrame(id),
  setTimer = (callback, delay) => setTimeout(callback, delay),
  clearTimer = (id) => clearTimeout(id),
} = {}) {
  if (typeof render !== 'function') throw new Error('UI 调度器缺少 render 函数。');
  const intervalMs = 1000 / Math.max(1, Number(maxFps) || 10);
  const reasons = new Set();
  let frameId = null;
  let timerId = null;
  let lastRenderAt = -Infinity;
  let requestCount = 0;
  let renderCount = 0;

  function perform(timestamp = now()) {
    frameId = null;
    timerId = null;
    lastRenderAt = timestamp;
    const mergedReasons = [...reasons];
    reasons.clear();
    renderCount += 1;
    render(mergedReasons);
  }

  function schedule() {
    if (frameId !== null || timerId !== null) return;
    const delay = Math.max(0, intervalMs - (now() - lastRenderAt));
    if (delay > 0) {
      timerId = setTimer(() => {
        timerId = null;
        frameId = requestFrame(perform);
      }, delay);
      return;
    }
    frameId = requestFrame(perform);
  }

  function request(reason = 'unspecified') {
    requestCount += 1;
    reasons.add(reason);
    schedule();
  }

  function flush(reason = 'flush') {
    reasons.add(reason);
    if (timerId !== null) clearTimer(timerId);
    if (frameId !== null) cancelFrame(frameId);
    timerId = null;
    frameId = null;
    perform(now());
  }

  function stop() {
    if (timerId !== null) clearTimer(timerId);
    if (frameId !== null) cancelFrame(frameId);
    timerId = null;
    frameId = null;
    reasons.clear();
  }

  function getDiagnostics() {
    return {
      maxFps,
      intervalMs,
      requestCount,
      renderCount,
      pending: frameId !== null || timerId !== null,
      pendingReasons: [...reasons],
      lastRenderAt,
    };
  }

  return Object.freeze({ request, flush, stop, getDiagnostics });
}
