import { createId } from '../../core/ids/createId.js';
import { createFixedStepClock, SIMULATION_SECONDS_PER_TICK, WORLD_MINUTES_PER_REAL_SECOND } from '../../core/simulation/fixedStepClock.js';
import { getDayPhase } from '../environment/dayCycle.js';
import { EXPOSURE_KEY, evaluateExposure, getExposure } from '../environment/exposureSystem.js';
import { ACTION_TYPES } from './actionTypes.js';
import { buildActionExplanation } from './actionExplanation.js';
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
import { createReservationLedger } from './reservationLedger.js';
import { applyCoWorkRelation, applyHelpfulIntentRelation } from '../social/relationEffects.js';
import { createFoodDistributionSystem } from '../survival/foodDistributionSystem.js';

const CAMP_ID = 'starting-camp';
const UI_PUBLISH_INTERVAL_MS = 100;
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
function taskView(task, phase) {
  return {
    id: task.id,
    type: task.type,
    label: task.label,
    phase,
    destination: copy(task.destination),
    utility: task.data?.utility ? copy(task.data.utility) : null,
  };
}
function currentFarmSystem() { return globalThis.shengling?.farmSystem ?? null; }

export function createActionSystem({
  peopleSystem,
  mapSystem,
  campStore,
  buildingSystem,
  weatherSystem,
  fireSystem,
  campRulesSystem = null,
  eventBus,
  gameTime,
  worldSpeedSystem = null,
  reservationLedger = null,
} = {}) {
  const agents = new Map();
  const logs = [];
  const ledger = reservationLedger ?? createReservationLedger();
  const fixedClock = createFixedStepClock();
  const foodDistribution = createFoodDistributionSystem({ eventBus, gameTime, campStore, campRulesSystem, campId: CAMP_ID });
  let running = false;
  let frameId = null;
  let previous = 0;
  let plannerTimer = 0;
  let needsTimer = 0;
  let phaseId = getDayPhase(gameTime.now()).id;
  let lastError = null;
  let lastTickAt = null;
  let lastGameTime = gameTime.stamp();
  let lastUiPublishAt = 0;

  function runtimePeople() {
    const lightweight = peopleSystem.getAliveRuntime?.();
    return Array.isArray(lightweight) ? lightweight : peopleSystem.getAlive();
  }

  function runtimePerson(personId) {
    return peopleSystem.getRuntime?.(personId) ?? peopleSystem.get(personId);
  }

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
    runtimePeople().forEach((person) => {
      if (agents.has(person.id)) return;
      agents.set(person.id, {
        personId: person.id,
        x: Number(person.location.tileX ?? 0),
        y: Number(person.location.tileY ?? 0),
        task: null,
      });
    });
  }

  function resetRuntimeAgents({ clearActivities = true } = {}) {
    ledger.clear();
    agents.clear();
    runtimePeople().forEach((person) => {
      agents.set(person.id, {
        personId: person.id,
        x: Number(person.location.tileX ?? 0),
        y: Number(person.location.tileY ?? 0),
        task: null,
      });
      if (clearActivities) peopleSystem.setActivity(person.id, { status: 'idle', current: null });
    });
  }

  function createRuntimeCheckpoint() {
    ensureAgents();
    return {
      agents: [...agents.values()].map(copy),
      reservations: ledger.createCheckpoint?.() ?? { reservations: ledger.list() },
      logs: logs.map(copy),
      plannerTimer,
      needsTimer,
      phaseId,
      lastError: lastError ? copy(lastError) : null,
      lastTickAt,
      lastGameTime: lastGameTime ? copy(lastGameTime) : null,
    };
  }

  function restoreRuntimeCheckpoint(snapshot) {
    if (!snapshot || !Array.isArray(snapshot.agents)) throw new Error('行动运行时检查点无效。');
    agents.clear();
    snapshot.agents.forEach((agent) => {
      if (!agent?.personId || !Number.isFinite(agent.x) || !Number.isFinite(agent.y)) {
        throw new Error('行动运行时检查点包含无效代理。');
      }
      agents.set(agent.personId, copy(agent));
    });
    if (ledger.restoreCheckpoint) ledger.restoreCheckpoint(snapshot.reservations);
    else {
      ledger.clear();
      (snapshot.reservations?.reservations ?? []).forEach((entry) => {
        ledger.reserve({ ...copy(entry), capacity: Infinity });
      });
    }
    logs.splice(0, logs.length, ...(snapshot.logs ?? []).map(copy));
    plannerTimer = Number(snapshot.plannerTimer ?? plannerTimer);
    needsTimer = Number(snapshot.needsTimer ?? needsTimer);
    phaseId = snapshot.phaseId ?? phaseId;
    lastError = snapshot.lastError ? copy(snapshot.lastError) : null;
    lastTickAt = snapshot.lastTickAt ?? null;
    lastGameTime = snapshot.lastGameTime ? copy(snapshot.lastGameTime) : gameTime.stamp();
    return createRuntimeCheckpoint();
  }

  function renderPeople() {
    ensureAgents();
    return peopleSystem.getAlive().map((person) => {
      const agent = agents.get(person.id);
      return agent ? { ...person, location: { ...person.location, tileX: agent.x, tileY: agent.y } } : person;
    });
  }

  function movementPeople() {
    ensureAgents();
    return runtimePeople().map((person) => {
      const agent = agents.get(person.id);
      return {
        id: person.id,
        location: {
          tileX: agent?.x ?? Number(person.location.tileX ?? 0),
          tileY: agent?.y ?? Number(person.location.tileY ?? 0),
        },
        activity: { status: person.activity?.status ?? 'idle' },
      };
    });
  }

  function getActionExplanation(personId) {
    ensureAgents();
    const task = agents.get(personId)?.task ?? null;
    const explanation = buildActionExplanation(task);
    return explanation ? copy(explanation) : null;
  }

  function counts() {
    const result = {};
    ledger.list({ type: 'task-slot' }).forEach((entry) => {
      result[entry.key] = (result[entry.key] ?? 0) + 1;
    });
    return result;
  }

  function reservations() {
    return new Set(ledger.list({ type: 'feature' }).map((entry) => entry.key));
  }

  function pendingCampStorageReservations() {
    return ledger.amount({ type: 'camp-storage', key: CAMP_ID });
  }

  function cancelConstructionReservation(task) {
    if (task?.type !== ACTION_TYPES.DELIVER_MATERIALS || !task.data?.reservationId) return false;
    return buildingSystem.cancelReservation(task.data.siteId, task.data.reservationId);
  }

  function releaseTaskReservations(task) {
    if (!task) return [];
    const ids = task.data?.runtimeReservationIds ?? [];
    const released = ids.map((id) => ledger.release(id)).filter(Boolean);
    if (!ids.length && task.id) released.push(...ledger.releaseTask(task.id));
    return released;
  }

  function reserveTaskResources(task, personId) {
    const acquired = [];
    const reserve = (input) => {
      const entry = ledger.reserve({ ...input, taskId: task.id, ownerId: personId });
      if (entry) acquired.push(entry.id);
      return entry;
    };

    if (!reserve({
      id: `${task.id}:slot`,
      type: 'task-slot',
      key: task.type,
      metadata: { actionType: task.type },
    })) return false;

    if (task.data?.featureId && !reserve({
      id: `${task.id}:feature`,
      type: 'feature',
      key: task.data.featureId,
      capacity: 1,
      metadata: { featureId: task.data.featureId },
    })) {
      acquired.forEach((id) => ledger.release(id));
      return false;
    }

    if (task.type === ACTION_TYPES.HAUL_TO_CAMP) {
      const amount = Math.max(0, Number(task.data?.reservedCapacity ?? 0));
      const available = Math.max(0, Number(campStore.getStorage(CAMP_ID)?.available ?? 0));
      if (amount > 0 && !reserve({
        id: `${task.id}:camp-storage`,
        type: 'camp-storage',
        key: CAMP_ID,
        amount,
        capacity: available,
        metadata: { campId: CAMP_ID },
      })) {
        acquired.forEach((id) => ledger.release(id));
        return false;
      }
    }

    if (task.type === ACTION_TYPES.DELIVER_MATERIALS && task.data?.reservationId) {
      const amount = Math.max(1, Number(task.data?.amount ?? task.data?.carriedAmount ?? 1));
      if (!reserve({
        id: `${task.id}:building-material`,
        type: 'building-material',
        key: task.data.reservationId,
        amount,
        capacity: amount,
        metadata: {
          siteId: task.data.siteId,
          materialId: task.data.materialId,
          buildingReservationId: task.data.reservationId,
        },
      })) {
        acquired.forEach((id) => ledger.release(id));
        return false;
      }
    }

    task.data = { ...(task.data ?? {}), runtimeReservationIds: acquired };
    return true;
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
    if (!task || !reserveTaskResources(task, person.id)) {
      if (task) releaseTaskReservations(task);
      cancelConstructionReservation(planned);
      return false;
    }
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
    const storage = campStore.getStorage(CAMP_ID);
    let availableCampStorage = Math.max(0, Number(storage?.available ?? Infinity) - pendingCampStorageReservations());
    const people = runtimePeople();

    people.forEach((person) => {
      const agent = agents.get(person.id);
      if (!agent || agent.task) return;
      const fireTask = !isEmergency(person) ? planFireTask({ camp, fireSystem, weather, phase, actionCounts }) : null;
      const warmthTask = !hasCargo(person) ? planWarmingTask({ person, fireSystem, actionCounts }) : null;
      const sleep = phase.isNight && !mustStayAwake(person)
        ? planNightSleep({ person, camp, buildingSystem, time: gameTime.now(), worldMinutesPerSecond: WORLD_MINUTES_PER_REAL_SECOND })
        : null;
      let planned = fireTask ?? warmthTask ?? sleep;
      if (!planned && !phase.isNight && !isEmergency(person)) {
        planned = planConstructionAction({ person, camp, buildingSystem, actionCounts });
      }
      if (!planned && farmSystem && !phase.isNight && !isEmergency(person)) {
        planned = planFarmAction({ person, farmSystem, actionCounts });
      }
      if (!planned) {
        planned = planNextAction({
          person,
          camp,
          population: people.length,
          people,
          mapSystem,
          actionCounts,
          reservedFeatureIds,
          storage: storage ? { ...storage, available: availableCampStorage } : null,
        });
      }
      if (!planned || !assign(person, agent, planned)) return;
      actionCounts[planned.type] = (actionCounts[planned.type] ?? 0) + 1;
      if (planned.data?.featureId) reservedFeatureIds.add(planned.data.featureId);
      if (planned.type === ACTION_TYPES.HAUL_TO_CAMP) {
        availableCampStorage = Math.max(0, availableCampStorage - Math.max(0, Number(planned.data?.reservedCapacity ?? 0)));
      }
    });
  }

  function clearTask(agent, personId) {
    const task = agent.task;
    releaseTaskReservations(task);
    if (task?.type === ACTION_TYPES.SLEEP) {
      peopleSystem.removeStatusTag(personId, 'sleeping');
      peopleSystem.removeStatusTag(personId, 'sheltered');
      peopleSystem.removeStatusTag(personId, 'exposed');
    }
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
    nextTask.data = {
      ...(nextTask.data ?? {}),
      runtimeReservationIds: [...(task.data?.runtimeReservationIds ?? [])],
    };
    agent.task = nextTask;
    const person = runtimePerson(agent.personId);
    setActivity(person, nextTask, '送往工地');
    log(transition.summary, task.type, agent.personId);
  }

  function finish(agent, task) {
    function applyCompletionRelationFeedback(result) {
      if (!result?.personId) return;
      applyHelpfulIntentRelation({ personId: result.personId, task, peopleSystem, eventBus, gameTime });
      applyCoWorkRelation({ personId: result.personId, task, agent, agents, peopleSystem, eventBus, gameTime });
    }

    function complete(result) {
      if (result) {
        applyCompletionRelationFeedback(result);
        eventBus.emit('actions:completed', { result: copy(result), task: copy(task), personId: result.personId, time: gameTime.stamp() });
      }
      releaseTaskReservations(task);
      agent.task = null;
    }

    if (task.type === ACTION_TYPES.SLEEP) {
      const result = completeSleep({ agent, task, peopleSystem, gameTime });
      if (result) log(result.summary, task.type, result.personId);
      complete(result);
      return;
    }
    if (task.type === ACTION_TYPES.TEND_FIRE) {
      const result = completeTendFire({ agent, task, peopleSystem, campStore, fireSystem, gameTime, campId: CAMP_ID });
      if (result) log(result.summary, task.type, result.personId);
      complete(result);
      return;
    }
    if (task.type === ACTION_TYPES.WARM_BY_FIRE) {
      const result = completeWarmByFire({ agent, task, peopleSystem, gameTime });
      if (result) log(result.summary, task.type, result.personId);
      complete(result);
      return;
    }
    if (FARM_ACTIONS.has(task.type)) {
      const result = completeFarmAction({ agent, task, peopleSystem, farmSystem: currentFarmSystem(), gameTime });
      if (result) log(result.summary, task.type, result.personId);
      complete(result);
      return;
    }
    if (task.type === ACTION_TYPES.DELIVER_MATERIALS) {
      if (task.data.stage === 'collect') return continueMaterialDelivery(agent, task);
      const result = deliverConstructionMaterial({ agent, task, peopleSystem, buildingSystem, gameTime });
      if (result) log(result.summary, task.type, result.personId);
      complete(result);
      return;
    }
    if (task.type === ACTION_TYPES.BUILD_SITE) {
      const result = performConstructionWork({ agent, task, peopleSystem, buildingSystem, gameTime });
      if (result) log(result.summary, task.type, result.personId);
      complete(result);
      return;
    }
    const result = completeAction({ agent, task, peopleSystem, mapSystem, campStore, gameTime, campId: CAMP_ID });
    if (result) log(result.summary, task.type, result.personId);
    complete(result);
  }

  function updateAgents(delta) {
    const weather = weatherSystem.get();
    agents.forEach((agent) => {
      if (!agent.task) return;
      const person = runtimePerson(agent.personId);
      if (!person?.identity.alive) {
        cancelConstructionReservation(agent.task);
        clearTask(agent, agent.personId);
        return;
      }
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
    const people = runtimePeople();
    people.forEach((person) => {
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
        if (patch.thirst >= 56) {
          const water = foodDistribution.requestWater({ person, people, thirstBefore: patch.thirst });
          if (water.granted) patch.thirst -= water.thirstReduction;
        }
        if (patch.hunger >= 56) {
          const food = foodDistribution.requestFood({ person, people, hungerBefore: patch.hunger });
          if (food.granted) patch.hunger -= food.hungerReduction;
          else patch.stress += 1.8;
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
    return { weather, fire, phase };
  }

  function tickPayload(environment = null) {
    const current = environment ?? {
      phase: getDayPhase(gameTime.now()),
      weather: weatherSystem.get(),
      fire: fireSystem.get(),
    };
    return {
      time: gameTime.stamp(),
      phase: current.phase,
      weather: current.weather,
      fire: current.fire,
      speed: getWorldSpeedView(),
      fixedStep: {
        worldMinutes: 1,
        simulationSeconds: SIMULATION_SECONDS_PER_TICK,
      },
    };
  }

  function stepWorldMinute() {
    gameTime.advanceMinutes(1);
    lastGameTime = gameTime.stamp();
    eventBus.emit('simulation:pre-tick', { time: lastGameTime, fixedStep: { worldMinutes: 1 } });
    reportPhaseChange();
    const environment = updateEnvironment();
    const payload = tickPayload(environment);
    eventBus.emit('simulation:tick', payload);
    updateAgents(SIMULATION_SECONDS_PER_TICK);
    plannerTimer += SIMULATION_SECONDS_PER_TICK;
    while (plannerTimer >= 0.75) {
      plannerTimer -= 0.75;
      plan();
    }
    needsTimer += SIMULATION_SECONDS_PER_TICK;
    while (needsTimer >= 5) {
      needsTimer -= 5;
      updateNeeds(5);
    }
    return payload;
  }

  function publishUiTime(now, force = false) {
    if (!force && now - lastUiPublishAt < UI_PUBLISH_INTERVAL_MS) return false;
    lastUiPublishAt = now;
    eventBus.emit('simulation:time', tickPayload());
    return true;
  }

  function advanceTicks(count, { publishUi = false } = {}) {
    const total = Math.max(0, Math.floor(Number(count) || 0));
    let payload = null;
    for (let index = 0; index < total; index += 1) payload = stepWorldMinute();
    if (publishUi && payload) eventBus.emit('simulation:time', payload);
    return total;
  }

  function summarizeError(error) {
    return {
      message: error?.message ?? String(error),
      name: error?.name ?? 'Error',
      stack: error?.stack ?? null,
      time: gameTime.stamp(),
    };
  }

  function handleSimulationError(error) {
    lastError = summarizeError(error);
    running = false;
    frameId = null;
    console.error('[shengling:simulation-error]', error);
    eventBus.emit('simulation:error', { error, summary: lastError, diagnostics: getDiagnostics() });
  }

  function tick(now) {
    if (!running) return;
    try {
      lastTickAt = Date.now();
      const realDelta = Math.max(0, (now - previous) / 1000);
      previous = now;
      const ticks = fixedClock.consume(realDelta, getWorldSpeed());
      if (ticks > 0) {
        advanceTicks(ticks);
        publishUiTime(now);
      }
      frameId = requestAnimationFrame(tick);
    } catch (error) {
      handleSimulationError(error);
    }
  }

  function start() {
    if (running) return;
    ensureAgents();
    running = true;
    previous = performance.now();
    lastUiPublishAt = previous;
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

  function getLastError() { return lastError ? copy(lastError) : null; }

  function getDiagnostics() {
    return {
      lastTickAt,
      lastGameTime: lastGameTime ? copy(lastGameTime) : null,
      actionLoopRunning: running,
      lastSimulationError: getLastError(),
      worldSpeed: getWorldSpeedView(),
      agentCount: agents.size,
      pendingFrame: frameId !== null,
      fixedStep: fixedClock.getDiagnostics(),
      reservations: ledger.getSummary(),
    };
  }

  return Object.freeze({
    start,
    stop,
    advanceTicks,
    getRenderPeople: renderPeople,
    getMovementPeople: movementPeople,
    getActionExplanation,
    getRecentLogs: recentLogs,
    getDayPhase: () => getDayPhase(gameTime.now()),
    getWeather: () => weatherSystem.get(),
    getFire: () => fireSystem.get(),
    getWorldSpeed: getWorldSpeedView,
    exportFoodDistributionState: () => foodDistribution.exportState(),
    importFoodDistributionState: (snapshot) => foodDistribution.importState(snapshot),
    getFoodDistributionSystem: () => foodDistribution,
    getReservationLedger: () => ledger,
    resetRuntimeAgents,
    createRuntimeCheckpoint,
    restoreRuntimeCheckpoint,
    getLastError,
    getDiagnostics,
    isRunning: () => running,
  });
}
