import { createEventBus } from '../src/core/events/eventBus.js';
import { resetIdSequence } from '../src/core/ids/createId.js';
import { createGameTime } from '../src/core/time/gameTime.js';
import { createActionSystem } from '../src/modules/actions/actionSystem.js';
import { createReservationLedger } from '../src/modules/actions/reservationLedger.js';
import { createBuildingSystem } from '../src/modules/buildings/buildingSystem.js';
import { createResourceRenewalSystem } from '../src/modules/ecology/resourceRenewalSystem.js';
import { createDailyEconomySystem } from '../src/modules/economy/dailyEconomySystem.js';
import { createEconomicMetricsAuditView } from '../src/modules/economy/economicMetricsAuditView.js';
import { createResourceFlowSystem } from '../src/modules/economy/resourceFlowSystem.js';
import { createTaskLifecycleEconomyView } from '../src/modules/economy/taskLifecycleEconomyView.js';
import { createTaskLifecycleStageCostView } from '../src/modules/economy/taskLifecycleStageCostView.js';
import { createTaskLifecycleSystem } from '../src/modules/economy/taskLifecycleSystem.js';
import { createYearAwareResourceFlowView } from '../src/modules/economy/yearAwareResourceFlowView.js';
import { createFireSystem } from '../src/modules/environment/fireSystem.js';
import { createWeatherSystem } from '../src/modules/environment/weatherSystem.js';
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

function installToolRuntimeListeners({ bus, tools }) {
  bus.on('actions:assigned', ({ personId, task }) => {
    tools.reserveForTask({ personId, task });
  });
  bus.on('people:changed', ({ reason, person }) => {
    if (reason === 'activity:set' && !person?.activity?.current) {
      tools.releaseReservationForOwner(person.id);
    }
  });
  bus.on('actions:completed', ({ personId, task }) => {
    tools.completeTask({ personId, task });
  });
  bus.on('simulation:tick', () => {
    tools.reconcile();
  });
  bus.on('save:loaded', () => {
    tools.reconcile(new Set());
  });
}

export function createLongRunAuditWorld(seed = 'replay-seed-v0277-stability') {
  const previousRuntime = globalThis.shengling;
  const previousEventBus = globalThis.__shenglingEventBus;
  const previousRequestAnimationFrame = globalThis.requestAnimationFrame;
  const previousCancelAnimationFrame = globalThis.cancelAnimationFrame;

  resetIdSequence(seed);
  const bus = createEventBus();
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
  const actions = createActionSystem({
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

  const tools = createToolSystem({
    eventBus: bus,
    gameTime: time,
    reservationLedger,
    getRuntime: () => runtime,
  });
  runtime.toolSystem = tools;
  installToolRuntimeListeners({ bus, tools });

  const baseResourceFlow = createResourceFlowSystem({
    eventBus: bus,
    gameTime: time,
    getRuntime: () => runtime,
  });
  const resourceFlow = createYearAwareResourceFlowView({
    resourceFlowSystem: baseResourceFlow,
    gameTime: time,
  });
  runtime.resourceFlowSystem = resourceFlow;
  bus.on('*', ({ eventName, payload }) => baseResourceFlow.observe(eventName, payload));

  const baseTaskLifecycle = createTaskLifecycleSystem({
    eventBus: bus,
    gameTime: time,
    getRuntime: () => runtime,
  });
  const taskLifecycle = createTaskLifecycleStageCostView({
    taskLifecycleSystem: baseTaskLifecycle,
    gameTime: time,
  });
  runtime.taskLifecycleSystem = taskLifecycle;
  bus.on('*', ({ eventName, payload }) => taskLifecycle.observe(eventName, payload));

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
  const dailyEconomy = createEconomicMetricsAuditView({ dailyEconomySystem: lifecycleEconomy });
  runtime.dailyEconomySystem = dailyEconomy;
  bus.on('*', ({ eventName, payload }) => baseDailyEconomy.observe(eventName, payload));

  bus.on('simulation:tick', ({ weather: currentWeather }) => {
    ecology.sync();
    farms.syncGrowth(currentWeather);
    foodStorage.sync(currentWeather);
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

  globalThis.requestAnimationFrame = () => 1;
  globalThis.cancelAnimationFrame = () => {};
  actions.start();
  actions.stop();
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
    tools,
    socialEvents,
    chronicles,
    resourceFlow,
    taskLifecycle,
    dailyEconomy,
    restoreGlobals,
  };
}
