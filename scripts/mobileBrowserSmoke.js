import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const APP_PORT = 4173;
const DEBUG_PORT = 9222;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const ARTIFACT_DIR = '.artifacts';
const PROCESS_LOG_LIMIT = 24_000;

function captureOutput(child) {
  let output = '';
  const append = (chunk) => {
    output += String(chunk);
    if (output.length > PROCESS_LOG_LIMIT) output = output.slice(-PROCESS_LOG_LIMIT);
  };
  child.stdout?.on('data', append);
  child.stderr?.on('data', append);
  return () => output;
}

function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try {
    process.kill(-child.pid, 'SIGTERM');
  } catch {
    try { child.kill('SIGTERM'); } catch { /* process already exited */ }
  }
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const startedAt = Date.now();
  let lastError = null;
  while (Date.now() - startedAt < timeoutMs) {
    try {
      const response = await fetch(url, { cache: 'no-store' });
      if (response.ok) return response;
      lastError = new Error(`${url} returned ${response.status}`);
    } catch (error) {
      lastError = error;
    }
    await delay(120);
  }
  throw new Error(`Timed out waiting for ${url}: ${lastError?.message ?? 'unknown error'}`);
}

async function findChrome() {
  const candidates = [
    process.env.CHROME_PATH,
    '/usr/bin/google-chrome',
    '/usr/bin/google-chrome-stable',
    '/usr/bin/chromium',
    '/usr/bin/chromium-browser',
  ].filter(Boolean);
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next browser path.
    }
  }
  throw new Error(`No executable Chromium browser found. Checked: ${candidates.join(', ')}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    this.listeners = new Map();

    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id) {
        const request = this.pending.get(message.id);
        if (!request) return;
        this.pending.delete(message.id);
        if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
        else request.resolve(message.result ?? {});
        return;
      }
      (this.listeners.get(message.method) ?? []).forEach((listener) => listener(message.params ?? {}));
    });

    socket.addEventListener('close', () => {
      for (const request of this.pending.values()) request.reject(new Error('Chromium DevTools connection closed.'));
      this.pending.clear();
    });
  }

  static async connect(url) {
    assert.equal(typeof WebSocket, 'function', 'Node runtime must expose the WebSocket API.');
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out opening Chromium DevTools connection.')), 10_000);
      socket.addEventListener('open', () => {
        clearTimeout(timer);
        resolve();
      }, { once: true });
      socket.addEventListener('error', () => {
        clearTimeout(timer);
        reject(new Error('Failed to open Chromium DevTools connection.'));
      }, { once: true });
    });
    return new CdpClient(socket);
  }

  on(method, listener) {
    if (!this.listeners.has(method)) this.listeners.set(method, []);
    this.listeners.get(method).push(listener);
  }

  waitFor(method, timeoutMs = 15_000) {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error(`Timed out waiting for ${method}.`)), timeoutMs);
      const listener = (params) => {
        clearTimeout(timer);
        const listeners = this.listeners.get(method) ?? [];
        this.listeners.set(method, listeners.filter((entry) => entry !== listener));
        resolve(params);
      };
      this.on(method, listener);
    });
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() {
    this.socket.close();
  }
}

async function evaluate(client, expression) {
  const payload = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
    userGesture: true,
  });
  if (payload.exceptionDetails) {
    const description = payload.exceptionDetails.exception?.description
      ?? payload.exceptionDetails.text
      ?? 'Browser evaluation failed.';
    throw new Error(description);
  }
  return payload.result?.value;
}

async function waitForCondition(client, expression, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (await evaluate(client, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for browser condition: ${expression}`);
}

function pointerSwipeExpression({ startY, endY, pointerId }) {
  return `(() => {
    const handle = document.querySelector('[data-observer-drawer-toggle]');
    const fire = (type, y) => handle.dispatchEvent(new PointerEvent(type, {
      bubbles: true,
      cancelable: true,
      composed: true,
      pointerId: ${pointerId},
      pointerType: 'touch',
      isPrimary: true,
      clientX: 195,
      clientY: y,
    }));
    fire('pointerdown', ${startY});
    fire('pointermove', ${endY});
    fire('pointerup', ${endY});
    return {
      open: document.querySelector('[data-observer-drawer]').classList.contains('is-open'),
      ariaExpanded: handle.getAttribute('aria-expanded'),
    };
  })()`;
}

let vite = null;
let chrome = null;
let client = null;
let userDataDir = null;
let readViteOutput = () => '';
let readChromeOutput = () => '';
const browserErrors = [];

try {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  const chromePath = await findChrome();
  userDataDir = await mkdtemp(join(tmpdir(), 'shengling-mobile-smoke-'));

  vite = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(APP_PORT), '--strictPort',
  ], {
    detached: process.platform !== 'win32',
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  readViteOutput = captureOutput(vite);
  await waitForHttp(APP_URL);

  chrome = spawn(chromePath, [
    '--headless=new',
    '--no-sandbox',
    '--disable-dev-shm-usage',
    '--disable-gpu',
    '--disable-background-networking',
    '--disable-component-update',
    '--disable-default-apps',
    '--disable-extensions',
    '--disable-sync',
    '--metrics-recording-only',
    '--mute-audio',
    `--remote-debugging-address=127.0.0.1`,
    `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`,
    '--window-size=390,844',
    'about:blank',
  ], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  readChromeOutput = captureOutput(chrome);
  await waitForHttp(`${DEBUG_URL}/json/version`);

  const targetResponse = await fetch(`${DEBUG_URL}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  assert.equal(targetResponse.ok, true, `Unable to create Chromium target: ${targetResponse.status}`);
  const target = await targetResponse.json();
  client = await CdpClient.connect(target.webSocketDebuggerUrl);

  client.on('Runtime.exceptionThrown', ({ exceptionDetails }) => {
    browserErrors.push(exceptionDetails?.exception?.description ?? exceptionDetails?.text ?? 'Uncaught browser exception');
  });
  client.on('Runtime.consoleAPICalled', ({ type, args = [] }) => {
    if (type !== 'error') return;
    browserErrors.push(args.map((entry) => entry.value ?? entry.description ?? '').join(' '));
  });

  await client.send('Page.enable');
  await client.send('Runtime.enable');
  await client.send('Network.enable');
  await client.send('Emulation.setDeviceMetricsOverride', {
    width: 390,
    height: 844,
    deviceScaleFactor: 3,
    mobile: true,
    screenWidth: 390,
    screenHeight: 844,
    positionX: 0,
    positionY: 0,
  });
  await client.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 });
  await client.send('Network.setUserAgentOverride', {
    userAgent: 'Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.0 Mobile/15E148 Safari/604.1',
    platform: 'iPhone',
    userAgentMetadata: {
      brands: [{ brand: 'Chromium', version: '130' }],
      fullVersionList: [{ brand: 'Chromium', version: '130.0.0.0' }],
      platform: 'iOS',
      platformVersion: '18.0.0',
      architecture: '',
      model: 'iPhone',
      mobile: true,
    },
  });

  const loaded = client.waitFor('Page.loadEventFired');
  await client.send('Page.navigate', { url: APP_URL });
  await loaded;
  await waitForCondition(client, `Boolean(
    window.shengling?.observerUiRuntime
    && window.shengling?.taskLifecycleSystem
    && window.shengling?.dailyEconomySystem
    && window.shengling?.resourceFlowSystem
    && window.shengling?.worldSaveRuntime
    && document.querySelector('#people-list')?.children.length === 10
  )`);

  const initial = await evaluate(client, `(() => {
    const root = document.documentElement;
    const body = document.body;
    const drawer = document.querySelector('[data-observer-drawer]');
    const handle = document.querySelector('[data-observer-drawer-toggle]');
    const canvas = document.querySelector('#map-canvas');
    return {
      innerWidth,
      innerHeight,
      scrollWidth: Math.max(root.scrollWidth, body.scrollWidth),
      drawerOpen: drawer.classList.contains('is-open'),
      drawerState: drawer.dataset.drawerState,
      ariaExpanded: handle.getAttribute('aria-expanded'),
      mapTouchAction: getComputedStyle(canvas).touchAction,
      handleTouchAction: getComputedStyle(handle).touchAction,
      peopleCount: document.querySelector('#people-list').children.length,
      runtimeReady: Boolean(
        window.shengling?.taskLifecycleSystem
        && window.shengling?.dailyEconomySystem
        && window.shengling?.resourceFlowSystem
        && window.shengling?.worldSaveRuntime
      ),
      simulationError: window.shengling?.actionSystem?.getDiagnostics?.().lastSimulationError ?? null,
    };
  })()`);

  assert.equal(initial.innerWidth, 390);
  assert.equal(initial.innerHeight, 844);
  assert.ok(initial.scrollWidth <= initial.innerWidth + 1, `Mobile layout overflows horizontally: ${initial.scrollWidth}px > ${initial.innerWidth}px`);
  assert.equal(initial.drawerOpen, false);
  assert.equal(initial.drawerState, 'closed');
  assert.equal(initial.ariaExpanded, 'false');
  assert.match(initial.mapTouchAction, /pan-y/);
  assert.match(initial.handleTouchAction, /pan-x/);
  assert.equal(initial.peopleCount, 10);
  assert.equal(initial.runtimeReady, true);
  assert.equal(initial.simulationError, null);

  const opened = await evaluate(client, pointerSwipeExpression({ startY: 780, endY: 700, pointerId: 71 }));
  assert.deepEqual(opened, { open: true, ariaExpanded: 'true' });

  await evaluate(client, `document.querySelector('[data-observer-tab="camp"]').click()`);
  await waitForCondition(client, `Boolean(
    document.querySelector('#daily-economy-detail')?.textContent?.trim()
    && document.querySelector('#resource-flow-detail')?.textContent?.trim()
    && document.querySelector('#tool-inventory-detail')?.textContent?.trim()
  )`);

  const campState = await evaluate(client, `(() => {
    const report = window.shengling.dailyEconomySystem.getCurrentReport();
    const flow = window.shengling.resourceFlowSystem.getDailySummary({ year: report.year, day: report.day });
    const root = document.documentElement;
    return {
      activeTab: window.shengling.observerUiRuntime.getActiveTab(),
      drawerOpen: window.shengling.observerUiRuntime.isOpen(),
      scrollWidth: Math.max(root.scrollWidth, document.body.scrollWidth),
      dailyText: document.querySelector('#daily-economy-detail').textContent.trim(),
      flowText: document.querySelector('#resource-flow-detail').textContent.trim(),
      toolText: document.querySelector('#tool-inventory-detail').textContent.trim(),
      economicMetricsVersion: report.economicMetricsVersion,
      hasStockGapRatios: Boolean(report.stockGapRatios),
      hasSpoilagePressure: Boolean(report.spoilagePressure),
      flowEntries: flow.totalEntries,
      lifecycleOk: window.shengling.taskLifecycleSystem.verify().ok,
      economyOk: window.shengling.dailyEconomySystem.verify().ok,
    };
  })()`);

  assert.equal(campState.activeTab, 'camp');
  assert.equal(campState.drawerOpen, true);
  assert.ok(campState.scrollWidth <= 391, `Open mobile drawer overflows horizontally: ${campState.scrollWidth}px`);
  assert.ok(campState.dailyText.length > 0);
  assert.ok(campState.flowText.length > 0);
  assert.ok(campState.toolText.length > 0);
  assert.equal(campState.economicMetricsVersion, 2);
  assert.equal(campState.hasStockGapRatios, true);
  assert.equal(campState.hasSpoilagePressure, true);
  assert.ok(campState.flowEntries >= 0);
  assert.equal(campState.lifecycleOk, true);
  assert.equal(campState.economyOk, true);

  const dragMode = await evaluate(client, `(() => {
    const button = document.querySelector('[data-map-control="drag-mode"]');
    const canvas = document.querySelector('#map-canvas');
    button.click();
    const enabled = { pressed: button.getAttribute('aria-pressed'), touchAction: getComputedStyle(canvas).touchAction };
    button.click();
    const disabled = { pressed: button.getAttribute('aria-pressed'), touchAction: getComputedStyle(canvas).touchAction };
    return { enabled, disabled };
  })()`);
  assert.equal(dragMode.enabled.pressed, 'true');
  assert.equal(dragMode.enabled.touchAction, 'none');
  assert.equal(dragMode.disabled.pressed, 'false');
  assert.match(dragMode.disabled.touchAction, /pan-y/);

  const saveLoad = await evaluate(client, `(async () => {
    const runtime = window.shengling;
    const actionSystem = runtime.actionSystem;
    const saveRuntime = runtime.worldSaveRuntime;
    const systemMenu = document.querySelector('.system-menu');
    const saveButton = document.querySelector('[data-save-action="save"]');
    const loadButton = document.querySelector('[data-save-action="load"]');
    const status = document.querySelector('[data-save-status]');
    const wasRunning = actionSystem.isRunning();

    saveRuntime.setAutosaveEnabled(false);
    actionSystem.stop();
    systemMenu.open = true;
    const savedTick = runtime.gameTime.stamp().tick;
    saveButton.click();
    const savedStatus = status.textContent.trim();
    const hasManualSave = runtime.worldSaveSystem.hasSave('manual');

    actionSystem.advanceTicks(30, { publishUi: true });
    const advancedTick = runtime.gameTime.stamp().tick;
    window.confirm = () => true;
    loadButton.click();
    const firstLoadedTick = runtime.gameTime.stamp().tick;
    const firstStatus = status.textContent.trim();
    const firstVerification = {
      lifecycle: runtime.taskLifecycleSystem.verify().ok,
      resourceFlow: runtime.resourceFlowSystem.verify().ok,
      economy: runtime.dailyEconomySystem.verify().ok,
      simulationError: actionSystem.getDiagnostics().lastSimulationError,
    };

    loadButton.click();
    const secondLoadedTick = runtime.gameTime.stamp().tick;
    const secondStatus = status.textContent.trim();
    const secondVerification = {
      lifecycle: runtime.taskLifecycleSystem.verify().ok,
      resourceFlow: runtime.resourceFlowSystem.verify().ok,
      economy: runtime.dailyEconomySystem.verify().ok,
      simulationError: actionSystem.getDiagnostics().lastSimulationError,
    };
    const scrollWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
    systemMenu.open = false;
    if (wasRunning) actionSystem.start();

    return {
      savedTick,
      advancedTick,
      firstLoadedTick,
      secondLoadedTick,
      savedStatus,
      firstStatus,
      secondStatus,
      hasManualSave,
      firstVerification,
      secondVerification,
      scrollWidth,
    };
  })()`);

  assert.equal(saveLoad.hasManualSave, true);
  assert.ok(saveLoad.advancedTick >= saveLoad.savedTick + 30);
  assert.equal(saveLoad.firstLoadedTick, saveLoad.savedTick);
  assert.equal(saveLoad.secondLoadedTick, saveLoad.savedTick);
  assert.match(saveLoad.savedStatus, /保存完成|最近存档/);
  assert.match(saveLoad.firstStatus, /读取存档完成/);
  assert.match(saveLoad.secondStatus, /读取存档完成/);
  assert.deepEqual(saveLoad.firstVerification, {
    lifecycle: true,
    resourceFlow: true,
    economy: true,
    simulationError: null,
  });
  assert.deepEqual(saveLoad.secondVerification, saveLoad.firstVerification);
  assert.ok(saveLoad.scrollWidth <= 391, `Open system menu overflows horizontally: ${saveLoad.scrollWidth}px`);

  await evaluate(client, `document.querySelector('[data-world-speed="10"]').click()`);
  await delay(650);
  const running = await evaluate(client, `(() => ({
    speed: window.shengling.worldSpeedSystem.get().value,
    speedLabel: document.querySelector('#world-speed-status').textContent.trim(),
    simulationError: window.shengling.actionSystem.getDiagnostics().lastSimulationError,
  }))()`);
  assert.equal(running.speed, 10);
  assert.equal(running.speedLabel, '10×');
  assert.equal(running.simulationError, null);

  const closed = await evaluate(client, pointerSwipeExpression({ startY: 700, endY: 780, pointerId: 72 }));
  assert.deepEqual(closed, { open: false, ariaExpanded: 'false' });
  assert.deepEqual(browserErrors, [], `Browser errors: ${browserErrors.join('\n')}`);

  const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
  await writeFile(join(ARTIFACT_DIR, 'mobile-smoke.png'), Buffer.from(screenshot.data, 'base64'));
  await writeFile(join(ARTIFACT_DIR, 'mobile-smoke-state.json'), `${JSON.stringify({ initial, campState, dragMode, saveLoad, running, browserErrors }, null, 2)}\n`);
  console.log('MOBILE_BROWSER_SMOKE=PASS');
} catch (error) {
  const failure = {
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
    browserErrors,
    viteOutput: readViteOutput(),
    chromeOutput: readChromeOutput(),
  };
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(join(ARTIFACT_DIR, 'mobile-smoke-failure.json'), `${JSON.stringify(failure, null, 2)}\n`);
  if (client) {
    try {
      const screenshot = await client.send('Page.captureScreenshot', { format: 'png', fromSurface: true });
      await writeFile(join(ARTIFACT_DIR, 'mobile-smoke-failure.png'), Buffer.from(screenshot.data, 'base64'));
    } catch {
      // The browser may already be unavailable; the JSON diagnostics remain useful.
    }
  }
  throw error;
} finally {
  client?.close();
  stopProcess(chrome);
  stopProcess(vite);
  if (userDataDir) await rm(userDataDir, { recursive: true, force: true });
}
