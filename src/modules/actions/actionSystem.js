import { createId } from '../../core/ids/createId.js';
import { getDayPhase } from '../environment/dayCycle.js';
import { EXPOSURE_KEY, evaluateExposure, getExposure } from '../environment/exposureSystem.js';
import { ACTION_TYPES } from './actionTypes.js';
import { createRuntimeTask, advanceRuntimeTask } from './actionExecutor.js';
import { completeAction } from './actionEffects.js';
import { collectConstructionMaterial, deliverConstructionMaterial, performConstructionWork } from './constructionEffects.js';
import { ensureInitialShelter, planConstructionAction } from './constructionPlanner.js';
import { completeFarmAction } from './farmEffects.js';
import { planFarmAction } from './farmPlanner.js';
import { completeTendFire, completeWarmByFire } from './fireEffects.js';
import { planFireTask, planWarmingTask } from './weatherPlanner.js';
import { planNightSleep } from './nightPlanner.js';
import { completeSleep } from './sleepEffects.js';
import { planNextAction } from './actionPlanner.js';

const CAMP_ID = 'starting-camp';
const WORLD_MINUTES_PER_REAL_SECOND = 6;
const WEATHER_SENSITIVE_ACTIONS = new Set([
  ACTION_TYPES.FETCH_WATER,
  ACTION_TYPES.GATHER_BERRIES,
  ACTION_TYPES.CHOP_TREE,
  ACTION_TYPES.HAUL_TO_CAMP,
  ACTION_TYPES.DELIVER_MATERIALS,
  ACTION_TYPES.BUILD_SITE,
  ACTION_TYPES.CLEAR_FIELD,
  ACTION_TYPES.SOW_MILLET,
  ACTION_TYPES.HARVEST_MILLET,
]);
const FARM_ACTIONS = new Set([ACTION_TYPES.CLEAR_FIELD, ACTION_TYPES.SOW_MILLET, ACTION_TYPES.HARVEST_MILLET]);

function copy(value) { return structuredClone(value); }
function near(first, second) { return Math.hypot(first.x - second.x, first.y - second.y) <= 3; }
function taskView(task, phase) { return { id: task.id, type: task.type, label: task.label, phase, destination: copy(task.destination) }; }
function currentFarmSystem() { return globalThis.shengling?.farmSystem ?? null; }

export function createActionSystem({ peopleSystem, mapSystem, campStore, buildingSystem, weatherSystem, fireSystem, eventBus, gameTime, worldSpeedSystem = null }) {
  const agents = new Map();
  const logs = [];
  let running = false;
  let frameId = null;
  let previous = 0;
  let plannerTimer = 0;
  let clockTimer = 0;
  let needsTimer = 0;
  let phaseId = getDayPhase(gameTime.now()).id;

  function activeWorldSpeedSystem() {
    return worldSpeedSystem ?? globalThis.shengling?.worldSpeedSystem ?? null;
  }

  function getWorldSpeed() {
    return Math.max(0.5, Math.min(10, Number(activeWorldSpeedSystem()?.get?.().value ?? 1)));
  }

  function getWorldSpeedView() {
    return activeWorldSpeedSystem()?.get?.() ?? Object.freeze({
      value: getWorldSpeed(),
      label: `${getWorldSpeed()}×`,
      worldMinutesPerRealSecond: WORLD_MINUTES_PER_REAL_SECOND * getWorldSpeed(),
    });
  }

  function log(summary, type = 'world', personId = null) {
    const entry = { id: createId('log'), summary, type, personId, time: gameTime.stamp() };
    logs.unshift(entry);
    logs.splice(40);
    eventBus.emit('actions:log', { entry: copy(entry), logs: recentLogs() });
  }

  function recentLogs(limit = 10) { return logs.slice(0, limit).map(copy); }

  function ensureAgents() {
    peopleSystem.getAlive().forEach((person) => {
      if (agents.has(person.id)) return;
      agents.set(person.id, { personId: person.id, x: Number(person.location.tileX ?? 0), y: Number(person.location.tileY ?? 0), task: null });
    });
  }

  function renderPeople() {
    ensureAgents();
    return peopleSystem.getAlive().map((person) => {
      const agent = agents.get(person.id);
      return agent ? { ...person, location: { ...person.location, tileX: agent.x, tileY: agent.y } } : person;
    });
  }

  function counts() {
    const result = {};
    agents.forEach((agent) => { if (agent.task) result[agent.task.type] = (result[agent.task.type] ?? 0) + 1; });
    return result;
  }

  function reservations() {
    const ids = new Set();
    agents.forEach((agent) => { if (agent.task?.data?.featureId) ids.add(agent.task.data.featureId); });
    return ids;
  }

  function setActivity(person, task, phase) {
    const restful = task.type === ACTION_TYPES.REST || task.type === ACTION_TYPES.SLEEP || task.type === ACTION_TYPES.WARM_BY_FIRE;
    peopleSystem.setActivity(person.id, {
      status: task.phase === 'moving' ? 'moving' : restful ? 'resting' : 'working',
      current: taskView(task, phase ?? (task.phase === 'moving' ? '前往目标' : task.phaseLabel)),
    });
  }

  function syncTag(person, tag, enabled) {
    const exists = person.state.statusTags.includes(tag);
    if (enabled && !exists) peopleSystem.addStatusTag(person.id, tag);
    if (!enabled && exists) peopleSystem.removeStatusTag(person.id, tag);
  }

  function syncExposureTags(person, evaluation) {
    syncTag(person, 'soaked', evaluation.tags.soaked);
    syncTag(person, 'chilled', evaluation.tags.chilled);
    syncTag(person, 'warm', evaluation.tags.warm);
    syncTag(person, 'dry', evaluation.tags.dry);
  }

  function applySleepTags(personId, task) {
    if (task.type !== ACTION_TYPES.SLEEP) return;
    peopleSystem.addStatusTag(personId, 'sleeping');
    if (task.data?.sheltered) {
      peopleSystem.addStatusTag(personId, 'sheltered');
      peopleSystem.removeStatusTag(personId, 'exposed');
    } else {
      peopleSystem.addStatusTag(personId, 'exposed');
    }
  }

  function weatherAdjustedTask(planned) {
    const weather = weatherSystem.get();
    if (!WEATHER_SENSITIVE_ACTIONS.has(planned.type)) return planned;
    return {
      ...planned,
      workDuration: planned.workDuration / Math.max(0.45, Number(weather.workMultiplier ?? 1)),
      data: { ...planned.data, weatherKey: weather.key },
    };
  }

  function assign(person, agent, planned) {
    const task = createRuntimeTask(weatherAdjustedTask(planned), agent, mapSystem);
    if (!task) return false;
    agent.task = task;
    applySleepTags(person.id, task);
    setActivity(person, task);
    eventBus.emit('actions:assigned', { personId: person.id, task: copy(task) });
    return true;
  }

  function hasCargo(person) {
    return Object.values(person.inventory.items).some((value) => Number(value) > 0);
  }

  function isEmergency(person) {
    return person.state.thirst >= 62 || person.state.hunger >= 62 || person.state.energy <= 28 || hasCargo(person);
  }

  function mustStayAwake(person) {
    return person.state.thirst >= 86 || person.state.hunger >= 86 || hasCargo(person);
  }

  function plan() {
    ensureAgents();
    const camp = campStore.get(CAMP_ID);
    if (!camp) return;
    const started = ensureInitialShelter({ buildingSystem, mapSystem, camp });
    if (started) log(`村民在营地旁划定了${started.label}的工地。`, 'construction');

    const farmSystem = currentFarmSystem();
    const field = farmSystem?.ensureFirstField({ campAnchor: camp.anchor });
    if (field) log('储物棚建成后，村民在营地附近选出第一块可开垦的草地。', 'farming');

    const phase = getDayPhase(gameTime.now());
    const weather = weatherSystem.get();
    const actionCounts = counts();
    const reservedFeatureIds = reservations();
    const people = peopleSystem.getAlive();
    people.forEach((person) => {
      const agent = agents.get(person.id);
      if (!agent || agent.task) return;

      const fireTask = !isEmergency(person)
        ? planFireTask({ camp, fireSystem, weather, phase, actionCounts })
        : null;
      const warmthTask = !hasCargo(person)
        ? planWarmingTask({ person, fireSystem, actionCounts })
        : null;
      const sleep = phase.isNight && !mustStayAwake(person)
        ? planNightSleep({ person, camp, buildingSystem, time: gameTime.now(), worldMinutesPerSecond: WORLD_MINUTES_PER_REAL_SECOND })
        : null;
      const construction = !phase.isNight && !isEmergency(person)
        ? planConstructionAction({ person, camp, buildingSystem, actionCounts })
        : null;
      const farming = farmSystem && !phase.isNight && !isEmergency(person)
        ? planFarmAction({ person, farmSystem, actionCounts })
        : null;
      const generic = planNextAction({ person, camp, population: people.length, mapSystem, actionCounts, reservedFeatureIds });
      const planned = fireTask ?? warmthTask ?? sleep ?? construction ?? farming ?? generic;
      if (!planned || !assign(person, agent, planned)) return;
      actionCounts[planned.type] = (actionCounts[planned.type] ?? 0) + 1;
      if (planned.data.featureId) reservedFeatureIds.add(planned.data.featureId);
    });
  }

  function clearTask(agent, personId) {
    if (agent.task?.type === ACTION_TYPES.SLEEP) peopleSystem.removeStatusTag(personId, 'sleeping');
    agent.task = null;
    peopleSystem.setActivity(personId, { status: 'idle', current: null });
  }

  function continueMaterialDelivery(agent, task) {
    const transition = collectConstructionMaterial({ agent, task, peopleSystem, campStore, buildingSystem, campId: CAMP_ID });
    if (!transition.nextTask) {
      clearTask(agent, agent.personId);
      if (transition.summary) log(transition.summary, task.type, agent.personId);
      return;
    }
    const nextTask = createRuntimeTask(weatherAdjustedTask(transition.nextTask), agent, mapSystem);
    if (!nextTask) {
      buildingSystem.cancelReservation(task.data.siteId, task.data.reservationId);
      clearTask(agent, agent.personId);
      log('运送建材的路线被阻断，调拨已取消。', task.type, agent.personId);
      return;
    }
    agent.task = nextTask;
    const person = peopleSystem.get(agent.personId);
    setActivity(person, nextTask, '送往工地');
    log(transition.summary, task.type, agent.personId);
  }

  function finish(agent, task) {
    if (task.type === ACTION_TYPES.SLEEP) {
      const result = completeSleep({ agent, task, peopleSystem, gameTime });
      if (result) log(result.summary, task.type, result.personId);
      agent.task = null;
      return;
    }

    if (task.type === ACTION_TYPES.TEND_FIRE) {
      const result = completeTendFire({ agent, task, peopleSystem, campStore, fireSystem, gameTime, campId: CAMP_ID });
      if (result) log(result.summary, task.type, result.personId);
      agent.task = null;
      return;
    }

    if (task.type === ACTION_TYPES.WARM_BY_FIRE) {
      const result = completeWarmByFire({ agent, task, peopleSystem, gameTime });
      if (result) log(result.summary, task.type, result.personId);
      agent.task = null;
      return;
    }

    if (FARM_ACTIONS.has(task.type)) {
      const result = completeFarmAction({ agent, task, peopleSystem, farmSystem: currentFarmSystem(), gameTime });
      if (result) log(result.summary, task.type, result.personId);
      agent.task = null;
      return;
    }

    if (task.type === ACTION_TYPES.DELIVER_MATERIALS) {
      if (task.data.stage === 'collect') return continueMaterialDelivery(agent, task);
      const result = deliverConstructionMaterial({ agent, task, peopleSystem, buildingSystem, gameTime });
      if (result) log(result.summary, task.type, result.personId);
      agent.task = null;
      return;
    }

    if (task.type === ACTION_TYPES.BUILD_SITE) {
      const result = performConstructionWork({ agent, task, peopleSystem, buildingSystem, gameTime });
      if (result) log(result.summary, task.type, result.personId);
      agent.task = null;
      return;
    }

    const result = completeAction({ agent, task, peopleSystem, mapSystem, campStore, gameTime, campId: CAMP_ID });
    if (result) log(result.summary, task.type, result.personId);
    agent.task = null;
  }

  function updateAgents(delta) {
    const weather = weatherSystem.get();
    agents.forEach((agent) => {
      if (!agent.task) return;
      const person = peopleSystem.get(agent.personId);
      if (!person?.identity.alive) { agent.task = null; return; }
      const speed = Math.max(0.45, 1.34 * (0.55 + person.state.energy / 180) * Number(weather.movementMultiplier ?? 1));
      const update = advanceRuntimeTask(agent, delta, speed);
      if (!update) return;
      if (update.kind === 'arrived') setActivity(person, update.task, update.task.phaseLabel);
      if (update.kind === 'completed') finish(agent, update.task);
    });
  }

  function updateNeeds(seconds) {
    const camp = campStore.get(CAMP_ID);
    if (!camp) return;
    const weather = weatherSystem.get();
    peopleSystem.getAlive().forEach((person) => {
      const agent = agents.get(person.id);
      if (!agent) return;
      const sleeping = agent.task?.type === ACTION_TYPES.SLEEP;
      const resting = agent.task?.type === ACTION_TYPES.REST || sleeping || agent.task?.type === ACTION_TYPES.WARM_BY_FIRE;
      const working = Boolean(agent.task) && !resting;
      const shelteredSleep = Boolean(agent.task?.data?.sheltered);
      const evaluation = evaluateExposure({ person, agent, weather, fireSystem, buildingSystem, seconds });
      const previousExposure = getExposure(person);
      if (previousExposure.wetness !== evaluation.exposure.wetness || previousExposure.cold !== evaluation.exposure.cold) {
        peopleSystem.setExtension(person.id, EXPOSURE_KEY, evaluation.exposure);
      }
      syncExposureTags(person, evaluation);

      const patch = {
        hunger: person.state.hunger + seconds * 0.075,
        thirst: person.state.thirst + seconds * 0.12,
        energy: person.state.energy - seconds * (working ? 0.12 : 0.045) + evaluation.stateDelta.energy,
        stress: person.state.stress + evaluation.stateDelta.stress,
        health: person.state.health + evaluation.stateDelta.health,
      };

      if (sleeping) {
        patch.energy = person.state.energy + seconds * (shelteredSleep ? 0.78 : 0.25) + evaluation.stateDelta.energy;
        patch.stress = person.state.stress + seconds * (shelteredSleep ? -0.24 : 0.16) + evaluation.stateDelta.stress;
        if (!shelteredSleep) patch.health = person.state.health - seconds * 0.018 + evaluation.stateDelta.health;
      }

      if (near(agent, camp.anchor)) {
        if (patch.thirst >= 56 && campStore.take(CAMP_ID, 'water', 1, 'drink') > 0) patch.thirst -= 34;
        if (patch.hunger >= 56) {
          if (campStore.take(CAMP_ID, 'berries', 1, 'eat') > 0) patch.hunger -= 26;
          else if (campStore.take(CAMP_ID, 'millet', 1, 'eat') > 0) patch.hunger -= 32;
        }
      }
      peopleSystem.patchState(person.id, patch);
    });
  }

  function reportPhaseChange() {
    const phase = getDayPhase(gameTime.now());
    if (phase.id === phaseId) return;
    phaseId = phase.id;
    eventBus.emit('environment:phase', { phase, time: gameTime.stamp() });
    if (phase.id === 'night') log('夜幕降临，村民开始结束生产，返回营地与住所。', 'environment');
    if (phase.id === 'dawn') log('天色渐亮，村民从休息中苏醒，重新开始一天。', 'environment');
    if (phase.id === 'dusk') log('黄昏降临，营地的生产活动正在收尾。', 'environment');
  }

  function updateEnvironment() {
    const phase = getDayPhase(gameTime.now());
    const weather = weatherSystem.sync();
    const fire = fireSystem.sync({ weather, phase });
    eventBus.emit('environment:updated', { weather, fire, phase, time: gameTime.stamp() });
  }

  function tick(now) {
    if (!running) return;
    const realDelta = Math.min(0.12, Math.max(0, (now - previous) / 1000));
    previous = now;
    const worldSpeed = getWorldSpeed();
    const simulationDelta = realDelta * worldSpeed;
    clockTimer += simulationDelta * WORLD_MINUTES_PER_REAL_SECOND;
    const minutes = Math.floor(clockTimer);
    if (minutes > 0) {
      gameTime.advanceMinutes(minutes);
      clockTimer -= minutes;
      reportPhaseChange();
      updateEnvironment();
      eventBus.emit('simulation:time', {
        time: gameTime.stamp(),
        phase: getDayPhase(gameTime.now()),
        weather: weatherSystem.get(),
        fire: fireSystem.get(),
        speed: getWorldSpeedView(),
      });
    }
    updateAgents(simulationDelta);
    plannerTimer += simulationDelta;
    if (plannerTimer >= 0.75) { plannerTimer = 0; plan(); }
    needsTimer += simulationDelta;
    if (needsTimer >= 5) { updateNeeds(needsTimer); needsTimer = 0; }
    frameId = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    ensureAgents();
    running = true;
    previous = performance.now();
    const phase = getDayPhase(gameTime.now());
    const weather = weatherSystem.get();
    const fire = fireSystem.get();
    eventBus.emit('environment:phase', { phase, time: gameTime.stamp() });
    eventBus.emit('environment:weather', { weather, time: gameTime.stamp() });
    eventBus.emit('environment:fire', { reason: 'initial', fire, time: gameTime.stamp() });
    plan();
    log('十位村民开始在起始河谷寻找水源、食物和木材。', 'system');
    frameId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = null;
  }

  return Object.freeze({
    start,
    stop,
    getRenderPeople: renderPeople,
    getRecentLogs: recentLogs,
    getDayPhase: () => getDayPhase(gameTime.now()),
    getWeather: () => weatherSystem.get(),
    getFire: () => fireSystem.get(),
    getWorldSpeed: getWorldSpeedView,
    isRunning: () => running,
  });
}
