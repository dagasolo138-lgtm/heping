import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { constants } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const APP_PORT = 4174;
const DEBUG_PORT = 9223;
const APP_URL = `http://127.0.0.1:${APP_PORT}`;
const DEBUG_URL = `http://127.0.0.1:${DEBUG_PORT}`;
const ARTIFACT_DIR = '.artifacts';

function stopProcess(child) {
  if (!child?.pid || child.exitCode !== null) return;
  try { process.kill(-child.pid, 'SIGTERM'); }
  catch { try { child.kill('SIGTERM'); } catch { /* already stopped */ } }
}

async function waitForHttp(url, timeoutMs = 20_000) {
  const started = Date.now();
  let lastError = null;
  while (Date.now() - started < timeoutMs) {
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
    } catch { /* try next */ }
  }
  throw new Error(`No executable Chromium browser found. Checked: ${candidates.join(', ')}`);
}

class CdpClient {
  constructor(socket) {
    this.socket = socket;
    this.sequence = 0;
    this.pending = new Map();
    socket.addEventListener('message', (event) => {
      const message = JSON.parse(String(event.data));
      if (!message.id) return;
      const request = this.pending.get(message.id);
      if (!request) return;
      this.pending.delete(message.id);
      if (message.error) request.reject(new Error(`${request.method}: ${message.error.message}`));
      else request.resolve(message.result ?? {});
    });
  }

  static async connect(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Timed out opening Chromium DevTools connection.')), 10_000);
      socket.addEventListener('open', () => { clearTimeout(timer); resolve(); }, { once: true });
      socket.addEventListener('error', () => { clearTimeout(timer); reject(new Error('Failed to open Chromium DevTools connection.')); }, { once: true });
    });
    return new CdpClient(socket);
  }

  send(method, params = {}) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { method, resolve, reject });
      this.socket.send(JSON.stringify({ id, method, params }));
    });
  }

  close() { this.socket.close(); }
}

async function evaluate(client, expression) {
  const payload = await client.send('Runtime.evaluate', {
    expression,
    awaitPromise: true,
    returnByValue: true,
  });
  if (payload.exceptionDetails) {
    throw new Error(payload.exceptionDetails.exception?.description ?? payload.exceptionDetails.text ?? 'Browser evaluation failed.');
  }
  return payload.result?.value;
}

async function waitForCondition(client, expression, timeoutMs = 20_000) {
  const started = Date.now();
  while (Date.now() - started < timeoutMs) {
    if (await evaluate(client, expression)) return;
    await delay(100);
  }
  throw new Error(`Timed out waiting for browser condition: ${expression}`);
}

let vite = null;
let chrome = null;
let client = null;
let userDataDir = null;

try {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  userDataDir = await mkdtemp(join(tmpdir(), 'shengling-test-speed-smoke-'));
  vite = spawn(process.platform === 'win32' ? 'npm.cmd' : 'npm', [
    'run', 'dev', '--', '--host', '127.0.0.1', '--port', String(APP_PORT), '--strictPort',
  ], {
    detached: process.platform !== 'win32',
    env: { ...process.env, BROWSER: 'none' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHttp(APP_URL);

  const chromePath = await findChrome();
  chrome = spawn(chromePath, [
    '--headless=new', '--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu',
    '--disable-background-networking', '--disable-component-update', '--disable-default-apps',
    '--disable-extensions', '--disable-sync', '--metrics-recording-only', '--mute-audio',
    '--remote-debugging-address=127.0.0.1', `--remote-debugging-port=${DEBUG_PORT}`,
    `--user-data-dir=${userDataDir}`, '--window-size=390,844', 'about:blank',
  ], {
    detached: process.platform !== 'win32',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  await waitForHttp(`${DEBUG_URL}/json/version`);

  const targetResponse = await fetch(`${DEBUG_URL}/json/new?${encodeURIComponent('about:blank')}`, { method: 'PUT' });
  assert.equal(targetResponse.ok, true);
  const target = await targetResponse.json();
  client = await CdpClient.connect(target.webSocketDebuggerUrl);
  await client.send('Page.enable');
  await client.send('Runtime.enable');

  await client.send('Page.navigate', { url: APP_URL });
  await waitForCondition(client, `Boolean(
    window.shengling?.actionSystem
    && window.shengling?.worldSpeedRuntime
    && window.shengling?.worldDynamicsSystem
    && window.shengling?.dailyEconomySystem
    && document.querySelector('#people-list')?.children.length === 10
  )`);

  const result = await evaluate(client, `(() => {
    const runtime = window.shengling;
    runtime.actionSystem.stop();
    const before = runtime.gameTime.stamp();
    const advance = runtime.worldSpeedRuntime.advanceTestSeconds(0.1, { multiplier: 100, publishUi: true });
    const after = runtime.gameTime.stamp();
    return {
      before,
      after,
      advance,
      visible100Button: Boolean(document.querySelector('[data-world-speed="100"]')),
      publicSupports100: runtime.worldSpeedSystem.isSupported(100),
      publicOptions: runtime.worldSpeedSystem.options(),
      testMultipliers: runtime.worldSpeedRuntime.testMultipliers(),
      actionRunning: runtime.actionSystem.isRunning(),
      simulationError: runtime.actionSystem.getDiagnostics().lastSimulationError,
      economyOk: runtime.dailyEconomySystem.verify().ok,
      dynamicsOk: runtime.worldDynamicsSystem.verify().ok,
    };
  })()`);

  assert.equal(result.advance.multiplier, 100);
  assert.equal(result.advance.ticks, 60);
  assert.equal(result.advance.advanced, 60);
  assert.equal(result.after.tick - result.before.tick, 60);
  assert.equal(result.visible100Button, false);
  assert.equal(result.publicSupports100, false);
  assert.deepEqual(result.publicOptions, [0.5, 1, 2, 5, 10]);
  assert.deepEqual(result.testMultipliers, [100]);
  assert.equal(result.actionRunning, false);
  assert.equal(result.simulationError, null);
  assert.equal(result.economyOk, true);
  assert.equal(result.dynamicsOk, true);

  await writeFile(join(ARTIFACT_DIR, 'test-speed-smoke-state.json'), `${JSON.stringify(result, null, 2)}\n`);
  console.log('TEST_SPEED_BROWSER_SMOKE=PASS');
} catch (error) {
  await mkdir(ARTIFACT_DIR, { recursive: true });
  await writeFile(join(ARTIFACT_DIR, 'test-speed-smoke-failure.json'), `${JSON.stringify({
    message: error?.message ?? String(error),
    stack: error?.stack ?? null,
  }, null, 2)}\n`);
  throw error;
} finally {
  try { client?.close(); } catch { /* cleanup must not mask a completed smoke test */ }
  stopProcess(chrome);
  stopProcess(vite);
  await delay(120);
  if (userDataDir) {
    try { await rm(userDataDir, { recursive: true, force: true, maxRetries: 3, retryDelay: 100 }); }
    catch { /* the runner will discard its temporary filesystem */ }
  }
}
