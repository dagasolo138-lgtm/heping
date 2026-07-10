import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { resolveDrawerSwipe } from '../src/bootstrap/attachObserverUiRuntime.js';

const root = new URL('../', import.meta.url);

test('收起状态向上滑动会展开观察抽屉', () => {
  assert.equal(resolveDrawerSwipe({
    startX: 120,
    startY: 240,
    endX: 124,
    endY: 180,
    open: false,
  }), true);
});

test('展开状态向下滑动会收起观察抽屉', () => {
  assert.equal(resolveDrawerSwipe({
    startX: 120,
    startY: 180,
    endX: 116,
    endY: 236,
    open: true,
  }), false);
});

test('短距离或横向滑动不会改变观察抽屉状态', () => {
  assert.equal(resolveDrawerSwipe({
    startX: 100,
    startY: 100,
    endX: 104,
    endY: 128,
    open: false,
  }), null);
  assert.equal(resolveDrawerSwipe({
    startX: 100,
    startY: 100,
    endX: 180,
    endY: 150,
    open: false,
  }), null);
});

test('与当前状态方向相反的滑动保持原状态', () => {
  assert.equal(resolveDrawerSwipe({
    startX: 100,
    startY: 160,
    endX: 100,
    endY: 100,
    open: true,
  }), null);
  assert.equal(resolveDrawerSwipe({
    startX: 100,
    startY: 100,
    endX: 100,
    endY: 160,
    open: false,
  }), null);
});

test('移动端抽屉已接入指针手势和纵向触控接管样式', async () => {
  const runtime = await readFile(new URL('src/bootstrap/attachObserverUiRuntime.js', root), 'utf8');
  const css = await readFile(new URL('src/styles/observerGesture.css', root), 'utf8');
  const html = await readFile(new URL('index.html', root), 'utf8');

  assert.match(runtime, /addEventListener\('pointerdown'/);
  assert.match(runtime, /addEventListener\('pointermove'/);
  assert.match(runtime, /addEventListener\('pointerup'/);
  assert.match(runtime, /addEventListener\('pointercancel'/);
  assert.match(css, /touch-action:\s*pan-x/);
  assert.match(html, /observerGesture\.css/);
});
