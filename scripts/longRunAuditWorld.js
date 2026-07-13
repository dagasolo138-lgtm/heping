import { createHeadlessEventBus } from '../src/core/events/headlessEventBus.js';
import {
  DAILY_ECONOMY_OBSERVER_EVENTS,
  RESOURCE_FLOW_OBSERVER_EVENTS,
  TASK_LIFECYCLE_OBSERVER_EVENTS,
  subscribeObserverEvents,
} from '../src/core/events/observerSubscriptions.js';
import { resetIdSequence } from '../src/core/ids/createId.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { createHeadlessReplay } from '../src/core/simulation/headlessReplay.js';
import { createActionSystem } from '../src/modules/actions/actionSystem.js';
import { createReservationLedger } from '../src/modules/actions/reservationLedger.js';
import { createToolMaintenanceRuntime } from '../src/modules/actions/toolMaintenanceRuntime.js';
import { createBuildingSystem } from '../src/modules/buildings/buildingSystem.js';
import { createResourceRenewalSystem } from '../src/modules/ecology/resourceRenewalSystem.js';
import { createWorldDynamicsSystem } from '../src/modules/dynamics/worldDynamicsSystem.js';
import { createDailyEconomySystem } from '../src/modules/economy/dailyEconomySystem.js';
import { createEconomicMetricsAuditView } from '../src/modules/economy/economicMetricsAuditView.js';
import { createFarmSeedDailyEconomyView } from '../src/modules/economy/farmSeedDailyEconomyView.js';
import { createFarmSeedResourceFlowView } from '../src/modules/economy/farmSeedResourceFlowView.js';
import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';
import { attachResourceFlowTaskContextGuard } from '../src/modules/economy/resourceFlowTaskContextGuard.js';
import { createTaskLifecycleEconomyView } from '../src/modules/economy/taskLifecycleEconomyView.js';
import { createTaskLifecycleStageCostView } from '../src/modules/economy/taskLifecycleStageCostView.js';
import { createTaskLifecycleSystem } from '../src/modules/economy/taskLifecycleSystem.js';
import { createToolMaintenanceResourceFlowView } from '../src/modules/economy/toolMaintenanceResourceFlowView.js';
import { createYearAwareResourceFlowView } from '../src/modules/economy/yearAwareResourceFlowView.js';
import { createFireSystem } from '../src/modules/environment/fireSystem.js';
import { createWeatherSystem } from '../src/modules/environment/weatherSystem.js';
import { createFarmGrowthTickHandler } from '../src/modules/farming/farmGrowthScheduler.js';
import { createFarmSystem } from '../src/modules/farming/farmSystem.js';
import { createChronicleSystem } from '../src/modules/history/chronicleSystem.js';
import { createMapSystem } from '../src/modules/map/mapSystem.js';
import { placeStartingSettlers } from '../src/modules/map/placeStartingSettlers.js';
import { createFounders } from '../src/modules/people/createFounders.js';
import { createPeopleSystem } from '../src/modules/people/peopleSystem.js';
import { createRoadSystem } from '../src/modules/roads/roadSystem.js';
import { createRoadTickSampler } from '../src/modules/roads/roadTickSampler.js';
import { createSeasonSystem } from '../src/modules/seasons/seasonSystem.js';
import { createCampRulesSystem } from '../src/modules/settlements/campRules.js';
import { createCampStore } from '../src/modules/settlements/campStore.js';
import { createSocialEventSystem } from '../src/modules/social/socialEventSystem.js';
import { createFoodStorageSystem } from '../src/modules/storage/foodStorageSystem.js';
import { createToolSystem } from '../src/modules/tools/toolSystem.js';

const TOOL_RECONCILE_INTERVAL_TICKS = 60;

function installToolRuntimeListeners({ bus, tools }) {
  let lastReconcileTick = 0;
  bus.on('actions:assigned', ({ personId, task }) => tools.reserveForTask({ personId, task }));
  bus.on('people:changed', ({ reason, person }) => {
    if (reason === 'activity:set' && !person?.activity?.current) tools.releaseReservationForOwner(person.id);
  });
  bus.on('actions:completed', ({ personId, task }) => tools.completeTask({ personId, task }));
  bus.on('simulation:pre-tick', ({ time }) => {
    const tick = Number(time?.tick ?? 0);
    if (tick - lastReconcileTick < TOOL_RECONCILE_INTERVAL_TICKS) return;
    lastReconcileTick = tick;
    tools.reconcile();
  });
  bus.on('save:loaded', () => tools.reconcile(new Set()));
}

export function createLongRunAuditWorld(seed = 'replay-seed-v0277-stability') {
  const previousRuntime = globalThis.shengling;
  const previousEventBus = globalThis.__shenglingEventBus;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;

  resetIdSequence(seed);
  const bus = createHeadlessEventBus();
  const time = createGameTime({ year: 1, day: 1, minute: 480 });
  const people = createPeopleSystem({ eventBus: bus, gameTime: time });
  const map = createMapSystem({ eventBus: bus, gameTime: time });
  const camp = createCampStore({ eventBus: bus, gameTime: time });
  const campRules = createCampRulesSystem({ eventBus: bus, gameTime: time });
  const buildings = createBuildingSystem({ eventBus: bus, gameTime: time });
  const weather = createWeatherSystem({ eventBus: bus, gameTime: time, seed: `${seed}:weather` });

  createFounders(people);
  const valley = map.createStartingValley({ seed });
  placeStartingSettlers({ peopleSystem: people, map: valley });
  camp.create({
    id: 'starting-camp',
    label: '起始营地',
    anchor: valley.spawnPoint,
    items: { wood: 3, berries: 2, water: 1 },
    capacity: 24,
    storageLabel: '营地露天堆放',
  });

  const fire = createFireSystem({ eventBus: bus, gameTime: time, mapSystem: map });
  const seasons = createSeasonSystem({ eventBus: bus, gameTime: time });
  weather.setSeasonSystem(seasons);
  const ecology = createResourceRenewalSystem({ eventBus: bus, gameTime: time, mapSystem: map, buildingSystem: buildings });
  const roads = createRoadSystem({ eventBus: bus, gameTime: time });
  const farms = createFarmSystem({ eventBus: bus, gameTime: time, mapSystem: map, buildingSystem: buildings, seasonSystem: seasons });
  const foodStorage = createFoodStorageSystem({ eventBus: bus, gameTime: time, campStore: camp });
  const reservationLedger = createReservationLedger();
  const rawActions = createActionSystem({
    peopleSystem: people,
    mapSystem: map,
    campStore: camp,
    buildingSystem: buildings,
    weatherSystem: weather,
    fireSystem: fire,
    campRulesSystem: campRules,
    eventBus: bus,
    gameTime: time,
    reservationLedger,
  });
  let headlessReplay = null;
  const actions = Object.freeze({
    ...rawActions,
    advanceTicks(count, options = {}) {
      if (!headlessReplay) return rawActions.advanceTicks(count, options);
      return headlessReplay.advanceTicks(count, options).advancedTicks;
    },
  });
  const roadSampler = createRoadTickSampler({ roadSystem: roads, getPeople: () => actions.getMovementPeople() });
  const socialEvents = createSocialEventSystem({
    eventBus: bus,
    peopleSystem: people,
    gameTime: time,
    getRuntimePeople: () => actions.getRenderPeople(),
  });
  const chronicles = createChronicleSystem({ eventBus: bus, gameTime: time, peopleSystem: people });

  const runtime = {
    gameTime: time,
    peopleSystem: people,
    mapSystem: map,
    campStore: camp,
    campRulesSystem: campRules,
    buildingSystem: buildings,
    weatherSystem: weather,
    fireSystem: fire,
    seasonSystem: seasons,
    ecologySystem: ecology,
    roadSystem: roads,
    farmSystem: farms,
    foodStorageSystem: foodStorage,
    reservationLedger,
    actionSystem: actions,
    socialEventSystem: socialEvents,
    chronicleSystem: chronicles,
    worldSpeedSystem: { get: () => ({ value: 10, label: '10×', worldMinutesPerRealSecond: 60 }) },
  };

  globalThis.shengling = runtime;
  globalThis.__shenglingEventBus = bus;

  const tools = createToolSystem({ eventBus: bus, gameTime: time, reservationLedger, getRuntime: () => runtime });
  runtime.toolSystem = tools;
  installToolRuntimeListeners({ bus, tools });

  const toolMaintenanceRuntime = createToolMaintenanceRuntime({
    eventBus: bus,
    reservationLedger,
    campStore: camp,
    toolSystem: tools,
    gameTime: time,
    getRuntime: () => runtime,
  });
  runtime.toolMaintenanceRuntime = toolMaintenanceRuntime;

  const baseResourceFlow = createResourceFlowSystem({ eventBus: bus, gameTime: time, getRuntime: () => runtime });
  const resourceFlowTaskContextGuard = attachResourceFlowTaskContextGuard({
    eventBus: bus,
    resourceFlowSystem: baseResourceFlow,
    getRuntime: () => runtime,
  });
  const yearAwareResourceFlow = createYearAwareResourceFlowView({ resourceFlowSystem: baseResourceFlow, gameTime: time });
  const maintenanceResourceFlow = createToolMaintenanceResourceFlowView({ resourceFlowSystem: yearAwareResourceFlow });
  const resourceFlow = createFarmSeedResourceFlowView({ resourceFlowSystem: maintenanceResourceFlow });
  runtime.resourceFlowSystem = resourceFlow;
  runtime.resourceFlowTaskContextGuard = resourceFlowTaskContextGuard;
  subscribeObserverEvents({ eventBus: bus, observer: baseResourceFlow, eventNames: RESOURCE_FLOW_OBSERVER_EVENTS });

  const baseTaskLifecycle = createTaskLifecycleSystem({ eventBus: bus, gameTime: time, getRuntime: () => runtime });
  const taskLifecycle = createTaskLifecycleStageCostView({ taskLifecycleSystem: baseTaskLifecycle, gameTime: time });
  runtime.taskLifecycleSystem = taskLifecycle;
  subscribeObserverEvents({ eventBus: bus, observer: taskLifecycle, eventNames: TASK_LIFECYCLE_OBSERVER_EVENTS });

  const baseDailyEconomy = createDailyEconomySystem({
    eventBus: bus,
    gameTime: time,
    resourceFlowSystem: resourceFlow,
    getRuntime: () => runtime,
  });
  const lifecycleEconomy = createTaskLifecycleEconomyView({
    dailyEconomySystem: baseDailyEconomy,
    taskLifecycleSystem: taskLifecycle,
  });
  const seedEconomy = createFarmSeedDailyEconomyView({ dailyEconomySystem: lifecycleEconomy });
  const dailyEconomy = createEconomicMetricsAuditView({ dailyEconomySystem: seedEconomy });
  runtime.dailyEconomySystem = dailyEconomy;
  subscribeObserverEvents({ eventBus: bus, observer: baseDailyEconomy, eventNames: DAILY_ECONOMY_OBSERVER_EVENTS });

  const worldDynamics = createWorldDynamicsSystem({
    eventBus: bus,
    gameTime: time,
    getRuntime: () => runtime,
  });
  runtime.worldDynamicsSystem = worldDynamics;
  bus.on('daily-economy:finalized', ({ report }) => {
    const decorated = dailyEconomy.getReport(report.year, report.day) ?? report;
    worldDynamics.evaluate(decorated);
  });

  const syncFarmGrowth = createFarmGrowthTickHandler({ farmSystem: farms, gameTime: time });
  bus.on('simulation:tick', (payload) => {
    ecology.sync();
    syncFarmGrowth({ weather: payload.weather });
    foodStorage.sync(payload.weather);
    roadSampler.sample();
  });
  bus.on('buildings:completed', ({ building }) => {
    if (building.typeId === 'communalShelter') {
      const residents = people.getAliveRuntime().map((person) => person.id);
      buildings.assignOccupants(building.id, residents);
      residents.forEach((id) => people.setLocation(id, { homeId: building.id }));
    }
    if (building.typeId === 'storageShed') {
      camp.applyStorageUpgrade('starting-camp', {
        sourceBuildingId: building.id,
        label: building.label,
        capacityDelta: building.effects.storageCapacity,
        protectionDelta: building.effects.storageProtection,
      });
    }
  });
  bus.on('farms:changed', ({ reason, field }) => {
    if (reason !== 'field:harvested' || field?.id !== 'first-millet-field') return;
    const currentCamp = camp.get('starting-camp');
    if (currentCamp) farms.ensureExpansionField({ campAnchor: currentCamp.anchor });
  });

  headlessReplay = createHeadlessReplay({ actionSystem: rawActions, gameTime: time, eventBus: bus, defaultBatchSize: 600 });
  runtime.headlessReplay = headlessReplay;

  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  rawActions.start();
  rawActions.stop();
  globalThis.requestAnimationFrame = previousRequestAnimationFrame;
  globalThis.cancelAnimationFrame = previousCancelAnimationFrame;

  function restoreGlobals() {
    globalThis.shengling = previousRuntime;
    globalThis.__shenglingEventBus = previousEventBus;
    globalThis.requestAnimationFrame = previousRequestAnimationFrame;
    globalThis.cancelAnimationFrame = previousCancelAnimationFrame;
  }

  return {
    runtime,
    bus,
    time,
    people,
    map,
    camp,
    buildings,
    weather,
    fire,
    seasons,
    ecology,
    roads,
    farms,
    foodStorage,
    reservationLedger,
    actions,
    rawActions,
    headlessReplay,
    tools,
    toolMaintenanceRuntime,
    socialEvents,
    chronicles,
    resourceFlow,
    resourceFlowTaskContextGuard,
    taskLifecycle,
    dailyEconomy,
    worldDynamics,
    restoreGlobals,
  };
}
