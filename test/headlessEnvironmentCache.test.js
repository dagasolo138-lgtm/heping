import test from 'node:test';
import assert from 'node:assert/strict';

import { createEventBus } from '../src/core/events/eventBus.js';
import { createHeadlessEventBus } from '../src/core/events/headlessEventBus.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { createFireSystem } from '../src/modules/environment/fireSystem.js';
import { createWeatherSystem } from '../src/modules/environment/weatherSystem.js';

test('headless 时间视图在同一 tick 内复用，推进后失效', () => {
  createHeadlessEventBus();
  const time = createGameTime({ year: 1, day: 1, minute: 480 });
  const firstNow = time.now();
  const secondNow = time.now();
  const firstStamp = time.stamp();
  const secondStamp = time.stamp();

  assert.strictEqual(secondNow, firstNow);
  assert.strictEqual(secondStamp, firstStamp);
  time.advanceMinutes(1);
  assert.notStrictEqual(time.now(), firstNow);
  assert.equal(time.getDiagnostics().mode, 'headless');
});

test('安全时间模式继续返回独立对象', () => {
  createEventBus();
  const time = createGameTime({ year: 1, day: 1, minute: 480 });
  assert.notStrictEqual(time.now(), time.now());
  assert.notStrictEqual(time.stamp(), time.stamp());
  assert.equal(time.getDiagnostics().mode, 'safe');
});

test('headless 天气只在四小时窗口变化时重建', () => {
  const bus = createHeadlessEventBus();
  const time = createGameTime({ year: 1, day: 2, minute: 480 });
  const weather = createWeatherSystem({ eventBus: bus, gameTime: time, seed: 'headless-weather-test' });
  const first = weather.get();
  const sameWindow = weather.sync();

  assert.strictEqual(sameWindow, first);
  time.advanceMinutes(239);
  assert.strictEqual(weather.sync(), first);
  time.advanceMinutes(1);
  const nextWindow = weather.sync();
  assert.notStrictEqual(nextWindow, first);
  assert.ok(weather.getDiagnostics().cacheHits >= 2);
});

test('headless 篝火视图复用并在状态推进后失效', () => {
  const bus = createHeadlessEventBus();
  const time = createGameTime({ year: 1, day: 1, minute: 1200 });
  const mapSystem = {
    get: () => ({ spawnPoint: { x: 1, y: 1 }, features: [] }),
  };
  const fire = createFireSystem({ eventBus: bus, gameTime: time, mapSystem });
  const first = fire.get();
  assert.strictEqual(fire.get(), first);

  time.advanceMinutes(1);
  const after = fire.sync({ weather: { requiresFire: true, isRain: false, temperature: 5 }, phase: { isNight: true } });
  assert.notStrictEqual(after, first);
  assert.ok(after.fuel < first.fuel);
  assert.equal(fire.getDiagnostics().mode, 'headless');
});
