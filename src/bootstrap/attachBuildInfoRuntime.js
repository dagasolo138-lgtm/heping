const MANIFEST_URL = new URL('../../version.json', import.meta.url);

function ensureReadout() {
  let readout = document.querySelector('#build-info-readout');
  if (readout) return readout;
  readout = document.createElement('aside');
  readout.id = 'build-info-readout';
  readout.className = 'build-info-readout';
  readout.setAttribute('aria-live', 'polite');
  const systemTools = document.querySelector('[data-system-tools]');
  const shell = document.querySelector('.app-shell');
  (systemTools ?? shell ?? document.body).append(readout);
  return readout;
}

function render(readout, { state, manifest }) {
  readout.replaceChildren();

  const label = document.createElement('span');
  label.className = 'build-info-readout__label';
  if (state === 'loading') label.textContent = '构建信息读取中';
  if (state === 'unavailable') label.textContent = '构建信息未读取';
  if (state === 'ready') {
    const shortCommit = String(manifest.sourceCommit ?? '').slice(0, 7);
    label.textContent = `构建 ${manifest.version ?? '未知'} · ${manifest.buildId ?? '未知'}${shortCommit ? ` · ${shortCommit}` : ''}`;
  }

  const link = document.createElement('a');
  link.href = MANIFEST_URL.href;
  link.target = '_blank';
  link.rel = 'noreferrer';
  link.textContent = '部署清单';
  link.setAttribute('aria-label', '打开部署清单 version.json');

  readout.append(label, link);
}

export function attachBuildInfoRuntime() {
  const runtime = globalThis.shengling;
  if (!runtime) throw new Error('构建信息模块启动失败：世界运行时尚未初始化。');
  if (runtime.buildInfoRuntime) return runtime.buildInfoRuntime;

  const readout = ensureReadout();
  let manifest = null;
  let state = 'loading';

  async function refresh() {
    state = 'loading';
    render(readout, { state, manifest });
    try {
      const requestUrl = new URL(MANIFEST_URL.href);
      requestUrl.searchParams.set('cacheBust', String(Date.now()));
      const response = await fetch(requestUrl, { cache: 'no-store' });
      if (!response.ok) throw new Error(`部署清单读取失败：${response.status}`);
      const nextManifest = await response.json();
      if (!nextManifest || typeof nextManifest !== 'object') throw new Error('部署清单格式无效。');
      manifest = Object.freeze({ ...nextManifest });
      state = 'ready';
    } catch (error) {
      state = 'unavailable';
      console.warn('[shengling] 无法读取部署清单。', error);
    }
    render(readout, { state, manifest });
    return manifest;
  }

  const api = Object.freeze({
    get: () => manifest,
    getState: () => state,
    refresh,
    manifestUrl: MANIFEST_URL.href,
  });

  globalThis.shengling = Object.freeze({ ...runtime, buildInfoRuntime: api });
  refresh();
  return api;
}
