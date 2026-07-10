import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

import { attachObserverUiRuntime, resolveDrawerSwipe } from '../src/bootstrap/attachObserverUiRuntime.js';

const root = new URL('../', import.meta.url);

class FakeClassList {
  constructor() { this.values = new Set(); }
  add(name) { this.values.add(name); }
  remove(name) { this.values.delete(name); }
  toggle(name, force) {
    const enabled = force === undefined ? !this.values.has(name) : Boolean(force);
    if (enabled) this.values.add(name);
    else this.values.delete(name);
    return enabled;
  }
  contains(name) { return this.values.has(name); }
}

class FakeElement {
  constructor({ dataset = {}, withHint = false } = {}) {
    this.dataset = { ...dataset };
    this.classList = new FakeClassList();
    this.listeners = new Map();
    this.attributes = new Map();
    this.capturedPointers = new Set();
    this.hidden = false;
    this.tabIndex = 0;
    this.hint = withHint ? { textContent: '' } : null;
  }

  addEventListener(name, listener) {
    if (!this.listeners.has(name)) this.listeners.set(name, []);
    this.listeners.get(name).push(listener);
  }

  dispatch(name, values = {}) {
    const event = {
      target: this,
      pointerId: 1,
      pointerType: 'touch',
      isPrimary: true,
      clientX: 0,
      clientY: 0,
      defaultPrevented: false,
      preventDefault() { this.defaultPrevented = true; },
      ...values,
    };
    (this.listeners.get(name) ?? []).forEach((listener) => listener(event));
    return event;
  }

  setAttribute(name, value) { this.attributes.set(name, String(value)); }
  getAttribute(name) { return this.attributes.get(name); }
  querySelector(selector) { return selector === 'small' ? this.hint : null; }
  focus() {}
  setPointerCapture(pointerId) { this.capturedPointers.add(pointerId); }
  hasPointerCapture(pointerId) { return this.capturedPointers.has(pointerId); }
  releasePointerCapture(pointerId) { this.capturedPointers.delete(pointerId); }
}

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

test('移动端指针手势会展开和收起抽屉，并吞掉滑动后的合成点击', () => {
  const originalDocument = globalThis.document;
  const originalWindow = globalThis.window;
  const originalLocalStorage = globalThis.localStorage;
  const originalRuntime = globalThis.shengling;

  const drawer = new FakeElement();
  const toggle = new FakeElement({ withHint: true });
  const tab = new FakeElement({ dataset: { observerTab: 'people' } });
  const panel = new FakeElement({ dataset: { observerPanel: 'people' } });
  const documentListeners = new Map();
  const mediaListeners = [];

  globalThis.document = {
    querySelector(selector) {
      if (selector === '[data-observer-drawer]') return drawer;
      if (selector === '[data-observer-drawer-toggle]') return toggle;
      return null;
    },
    querySelectorAll(selector) {
      if (selector === '[data-observer-tab]') return [tab];
      if (selector === '[data-observer-panel]') return [panel];
      return [];
    },
    addEventListener(name, listener) {
      if (!documentListeners.has(name)) documentListeners.set(name, []);
      documentListeners.get(name).push(listener);
    },
  };
  globalThis.window = {
    matchMedia: () => ({
      matches: true,
      addEventListener(name, listener) { if (name === 'change') mediaListeners.push(listener); },
    }),
  };
  globalThis.localStorage = {
    getItem: () => null,
    setItem() {},
  };
  globalThis.shengling = {};

  try {
    const api = attachObserverUiRuntime();
    assert.equal(api.isOpen(), false);

    toggle.dispatch('pointerdown', { clientX: 100, clientY: 240 });
    const upwardMove = toggle.dispatch('pointermove', { clientX: 104, clientY: 170 });
    toggle.dispatch('pointerup', { clientX: 104, clientY: 170 });
    assert.equal(upwardMove.defaultPrevented, true);
    assert.equal(api.isOpen(), true);
    assert.equal(toggle.getAttribute('aria-expanded'), 'true');

    toggle.dispatch('click');
    assert.equal(api.isOpen(), true);

    toggle.dispatch('pointerdown', { clientX: 100, clientY: 170 });
    toggle.dispatch('pointermove', { clientX: 96, clientY: 235 });
    toggle.dispatch('pointerup', { clientX: 96, clientY: 235 });
    assert.equal(api.isOpen(), false);
    assert.equal(toggle.getAttribute('aria-expanded'), 'false');

    toggle.dispatch('click');
    assert.equal(api.isOpen(), false);
  } finally {
    globalThis.document = originalDocument;
    globalThis.window = originalWindow;
    globalThis.localStorage = originalLocalStorage;
    globalThis.shengling = originalRuntime;
  }
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
