import { createId } from '../../core/ids/createId.js';
import { ACTION_TYPES } from './actionTypes.js';
import { createRuntimeTask, advanceRuntimeTask } from './actionExecutor.js';
import { completeAction } from './actionEffects.js';
import { planNextAction } from './actionPlanner.js';

const CAMP_ID = 'starting-camp';

function copy(value) { return structuredClone(value); }
function near(first, second) { return Math.hypot(first.x - second.x, first.y - second.y) <= 3; }
function taskView(task, phase) {
  return { id: task.id, type: task.type, label: task.label, phase, destination: copy(task.destination) };
}

export function createActionSystem({ peopleSystem, mapSystem, campStore, eventBus, gameTime }) {
  const agents = new Map();
  const logs = [];
  let running = false;
  let frameId = null;
  let previous = 0;
  let plannerTimer = 0;
  let clockTimer = 0;
  let needsTimer = 0;

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

  function assign(person, agent, planned) {
    const task = createRuntimeTask(planned, agent, mapSystem);
    if (!task) return false;
    agent.task = task;
    peopleSystem.setActivity(person.id, {
      status: task.phase === 'moving' ? 'moving' : task.type === ACTION_TYPES.REST ? 'resting' : 'working',
      current: taskView(task, task.phase === 'moving' ? '前往目标' : task.phaseLabel),
    });
    eventBus.emit('actions:assigned', { personId: person.id, task: copy(task) });
    return true;
  }

  function plan() {
    ensureAgents();
    const camp = campStore.get(CAMP_ID);
    if (!camp) return;
    const actionCounts = counts();
    const reservedFeatureIds = reservations();
    const people = peopleSystem.getAlive();
    people.forEach((person) => {
      const agent = agents.get(person.id);
      if (!agent || agent.task) return;
      const planned = planNextAction({ person, camp, population: people.length, mapSystem, actionCounts, reservedFeatureIds });
      if (!planned || !assign(person, agent, planned)) return;
      actionCounts[planned.type] = (actionCounts[planned.type] ?? 0) + 1;
      if (planned.data.featureId) reservedFeatureIds.add(planned.data.featureId);
    });
  }

  function finish(agent, task) {
    const result = completeAction({ agent, task, peopleSystem, mapSystem, campStore, gameTime, campId: CAMP_ID });
    if (result) log(result.summary, task.type, result.personId);
    agent.task = null;
  }

  function updateAgents(delta) {
    agents.forEach((agent) => {
      if (!agent.task) return;
      const person = peopleSystem.get(agent.personId);
      if (!person?.identity.alive) { agent.task = null; return; }
      const speed = Math.max(0.7, 1.34 * (0.55 + person.state.energy / 180));
      const update = advanceRuntimeTask(agent, delta, speed);
      if (!update) return;
      if (update.kind === 'arrived') {
        peopleSystem.setActivity(person.id, {
          status: update.task.type === ACTION_TYPES.REST ? 'resting' : 'working',
          current: taskView(update.task, update.task.phaseLabel),
        });
      }
      if (update.kind === 'completed') finish(agent, update.task);
    });
  }

  function updateNeeds(seconds) {
    const camp = campStore.get(CAMP_ID);
    if (!camp) return;
    peopleSystem.getAlive().forEach((person) => {
      const agent = agents.get(person.id);
      if (!agent) return;
      const resting = agent.task?.type === ACTION_TYPES.REST;
      const working = Boolean(agent.task) && !resting;
      const patch = {
        hunger: person.state.hunger + seconds * 0.075,
        thirst: person.state.thirst + seconds * 0.12,
        energy: person.state.energy - seconds * (working ? 0.12 : 0.045),
      };
      if (near(agent, camp.anchor)) {
        if (patch.thirst >= 56 && campStore.take(CAMP_ID, 'water', 1, 'drink') > 0) patch.thirst -= 34;
        if (patch.hunger >= 56 && campStore.take(CAMP_ID, 'berries', 1, 'eat') > 0) patch.hunger -= 26;
      }
      peopleSystem.patchState(person.id, patch);
    });
  }

  function tick(now) {
    if (!running) return;
    const delta = Math.min(0.12, Math.max(0, (now - previous) / 1000));
    previous = now;
    clockTimer += delta * 6;
    const minutes = Math.floor(clockTimer);
    if (minutes > 0) {
      gameTime.advanceMinutes(minutes);
      clockTimer -= minutes;
      eventBus.emit('simulation:time', { time: gameTime.stamp() });
    }
    updateAgents(delta);
    plannerTimer += delta;
    if (plannerTimer >= 0.75) { plannerTimer = 0; plan(); }
    needsTimer += delta;
    if (needsTimer >= 5) { updateNeeds(needsTimer); needsTimer = 0; }
    frameId = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    ensureAgents();
    running = true;
    previous = performance.now();
    plan();
    log('十位村民开始在起始河谷寻找水源、食物和木材。', 'system');
    frameId = requestAnimationFrame(tick);
  }

  function stop() {
    running = false;
    if (frameId) cancelAnimationFrame(frameId);
    frameId = null;
  }

  return Object.freeze({ start, stop, getRenderPeople: renderPeople, getRecentLogs: recentLogs, isRunning: () => running });
}
