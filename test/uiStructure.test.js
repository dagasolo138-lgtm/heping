import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const root = new URL('../', import.meta.url);

test('观察器界面保留模拟运行所需的唯一 DOM 挂载点', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  const requiredIds = [
    'topbar-time',
    'weather-readout',
    'world-speed-status',
    'system-status',
    'map-canvas',
    'world-time',
    'map-readout',
    'people-count',
    'people-list',
    'person-detail',
    'camp-resources',
    'construction-status',
    'action-log',
  ];

  requiredIds.forEach((id) => {
    const matches = html.match(new RegExp(`id=["']${id}["']`, 'g')) ?? [];
    assert.equal(matches.length, 1, `${id} 应当只出现一次`);
  });
});

test('人物、营地、事件和史书都进入响应式观察面板', async () => {
  const html = await readFile(new URL('index.html', root), 'utf8');
  ['people', 'camp', 'events', 'chronicle'].forEach((name) => {
    assert.match(html, new RegExp(`data-observer-tab=["']${name}["']`));
    assert.match(html, new RegExp(`data-observer-panel=["']${name}["']`));
  });
  assert.doesNotMatch(html, /class=["'][^"']*phase-note/);
  assert.doesNotMatch(html, /class=["'][^"']*foundation-grid/);
});

test('观察面板运行时已接入启动链', async () => {
  const app = await readFile(new URL('src/app.js', root), 'utf8');
  assert.match(app, /attachObserverUiRuntime/);
  assert.match(app, /attachWorldSaveRuntime\(\);[\s\S]*attachMapHudRuntime\(\);[\s\S]*attachObserverUiRuntime\(\);/);
});
