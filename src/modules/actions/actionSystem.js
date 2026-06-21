import { createId } from '../../core/ids/createId.js';
import { CAMP_ITEM_LABELS } from '../settlements/campStore.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';
import { advanceRuntimeTask, createRuntimeTask } from './actionExecutor.js';
import { planNextAction } from './actionPlanner.js';

const CAMP_ID = 'starting-camp';
const RESOURCE_IDS = Object.freeze(['wood', 'berries', 'water']);

function clone(value) {
  return structuredClone(value);
}

function describeItems(items) {
  return Object.entries(items)
    .filter(([, amount]) => amount > 0)
    .map(([itemId, amount]) => `${CAMP_ITEM_LABELS[itemId] ?? itemId}×${amount}`)
    .join('、');
}

function isNear(point, target, distance = 3) {
  return Math.hypot(point.x - target.x, point.y - target.y) <= distance;
}

function activityView(task, phase) {
  return {
    id: task.id,
    type: task.type,
    label: task.label,
    phase,
    destination: clone(task.destination),
  };
}

export function createActionSystem({ peopleSystem, mapSystem, campStore, eventBus, gameTime }) {
  const agents = new Map();
  const logs = [];
  let running = false;
  let frameId = null;
  let previousFrame = 0;
  let plannerElapsed = 0;
  let clockElapsed = 0;
  let needsElapsed = 0;

  function addLog(summary, type = 'world', personId = null) {
    const entry = { id: createId('log'), summary, type, personId, time: gameTime.stamp() };
    logs.unshift(entry);
    logs.splice(40);
    eventBus.emit('actions:log', { entry: clone(entry), logs: getRecentLogs() });
    return entry;
  }

  function getRecentLogs(limit = 10) {
    return logs.slice(0, limit).map(clone);
  }

  function ensureAgents() {
    peopleSystem.getAlive().forEach((person) => {
      if (agents.has(person.id)) return;
      agents.set(person.id, {
        personId: person.id,
        x: Number(person.location.tileX ?? 0),
        y: Number(person.location.tileY ?? 0),
        task: null,
      });
    });
  }

  function getRenderPeople() {
    ensureAgents();
    return peopleSystem.getAlive().map((person) => {
      const agent = agents.get(person.id);
      if (!agent) return person;
      return {
        ...person,
        location: {
          ...person.location,
          tileX: agent.x,
          tileY: agent.y,
        },
      };
    });
  }

  function actionCounts() {
    const counts = {};
    agents.forEach((agent) => {
      if (agent.task) counts[agent.task.type] = (counts[agent.task.type] ?? 0) + 1;
    });
    return counts;
  }

  function reservedFeatureIds() {
    const ids = new Set();
    agents.forEach((agent) => {
      if (agent.task?.data?.featureId) ids.add(agent.task.data.featureId);
    });
    return ids;
  }

  function assignTask(person, agent, task) {
    const runtimeTask = createRuntimeTask(task, agent, mapSystem);
    if (!runtimeTask) return false;
    agent.task = runtimeTask;
    const phase = runtimeTask.phase === 'moving' ? '前往目标' : runtimeTask.phaseLabel;
    peopleSystem.setActivity(person.id, {
      status: runtimeTask.phase === 'moving' ? 'moving' : runtimeTask.type === ACTION_TYPES.REST ? 'resting' : 'working',
      current: activityView(runtimeTask, phase),
    });
    eventBus.emit('actions:assigned', { personId: person.id, task: clone(runtimeTask) });
    return true;
  }

  function planIdleAgents() {
    ensureAgents();
    const camp = campStore.get(CAMP_ID);
    if (!camp) return;
    const counts = actionCounts();
    const reservations = reservedFeatureIds();
    const people = peopleSystem.getAlive();

    people.forEach((person) => {
      const agent = agents.get(person.id);
      if (!agent || agent.task) return;
      const task = planNextAction({
        person,
        camp,
        population: people.length,
        mapSystem,
        actionCounts: counts,
        reservedFeatureIds: reservations,
      });
      if (!task || !assignTask(person, agent, task)) return;
      counts[task.type] = (counts[task.type] ?? 0) + 1;
      if (task.data.featureId) reservations.add(task.data.featureId);
    });
  }

  function completeTask(agent, task) {
    const person = peopleSystem.get(agent.personId);
    if (!person) return;
    const stamp = gameTime.stamp();
    let summary = '';

    if (task.type === ACTION_TYPES.FETCH_WATER) {
      const yieldAmount = Number(task.data.yield ?? 3);
      peopleSystem.changeItem(person.id, 'water', yieldAmount);
      summary = `${person.identity.name}在河岸取回了 ${yieldAmount} 份清水。`;
    }

    if (task.type === ACTION_TYPES.GATHER_BERRIES) {
      const harvested = mapSystem.removeFeature(task.data.featureId);
      if (harvested) {
        const yieldAmount = Number(task.data.yield ?? 2);
        peopleSystem.changeItem(person.id, 'berries', yieldAmount);
        summary = `${person.identity.name}采下了 ${yieldAmount} 份浆果。`;
      } else {
        summary = `${person.identity.name}抵达时发现浆果丛已经被采空。`;
      }
    }

    if (task.type === ACTION_TYPES.CHOP_TREE) {
      const felled = mapSystem.removeFeature(task.data.featureId);
      if (felled) {
        const yieldAmount = Number(task.data.yield ?? 4);
        peopleSystem.changeItem(person.id, 'wood', yieldAmount);
        summary = `${person.identity.name}砍倒了一棵树，获得 ${yieldAmount} 份木材。`;
      } else {
        summary = `${person.identity.name}抵达时发现目标树木已经不在。`;
      }
    }

    if (task.type === ACTION_TYPES.HAUL_TO_CAMP) {
      const current = peopleSystem.get(person.id);
      const delivered = {};
      RESOURCE_IDS.forEach((itemId) => {
        const carried = Number(current.inventory.items[itemId] ?? 0);
        if (carried <= 0) return;
        const actual = campStore.change(CAMP_ID, itemId, carried, 'delivery');
        if (actual > 0) {
          peopleSystem.changeItem(person.id, itemId, -actual);
          delivered[itemId] = actual;
        }
      });
      summary = Object.keys(delivered).length
        ? `${person.identity.name}把${describeItems(delivered)}搬回了起始营地。`
        : `${person.identity.name}回到营地，但没有可归还的物资。`;
    }

    if (task.type === ACTION_TYPES.REST) {
      const current = peopleSystem.get(person.id);
      peopleSystem.patchState(person.id, {
        energy: current.state.energy + Number(task.data.energyGain ?? 25),
        stress: current.state.stress - Number(task.data.stressLoss ?? 10),
      });
      summary = `${person.identity.name}在篝火旁休息，恢复了精力。`;
    }

    peopleSystem.setLocation(person.id, { tileX: Math.round(agent.x), tileY: Math.round(agent.y) });
    peopleSystem.addLifeEvent(person.id, {
      type: `action:${task.type}`,
      summary,
      relatedPersonIds: [],
      details: { taskId: task.id, action: task.type },
      time: stamp,
    });
    const after = peopleSystem.get(person.id);
    peopleSystem.setActivity(person.id, {
      status: 'idle',
      current: null,
      lastCompleted: { type: task.type, label: task.label, time: stamp },
      completedCount: Number(after.activity.completedCount ?? 0) + 1,
    });
    addLog(summary, task.type, person.id);
  }

  function processAgents(deltaSeconds) {
    agents.forEach((agent) => {
      if (!agent.task) return;
      const person = peopleSystem.get(agent.personId);
      if (!person?.identity.alive) {
        agent.task = null;
        return;
      }
      const speed = Math.max(0.7, 1.34 * (0.55 + person.state.energy / 180));
      const update = advanceRuntimeTask(agent, deltaSeconds, speed);
      if (!update) return;
      if (update.kind === 'arrived') {
        peopleSystem.setActivity(person.id, {
          status: update.task.type === ACTION_TYPES.REST ? 'resting' : 'working',
          current: activityView(update.task, update.task.phaseLabel),
        });
      }
      if (update.kind === 'completed') {
        completeTask(agent, update.task);
        agent.task = null;
      }
    });
  }

  function applyNeeds(elapsedSeconds) {
    const camp = campStore.get(CAMP_ID);
    if (!camp) return;
    peopleSystem.getAlive().forEach((person) => {
      const agent = agents.get(person.id);
      if (!agent) return;
      const isResting = agent.task?.type === ACTION_TYPES.REST;
      const isWorking = Boolean(agent.task) && !isResting;
      const patch = {
        hunger: person.state.hunger + elapsedSeconds * 0.075,
        thirst: person.state.thirst + elapsedSeconds * 0.12,
        energy: person.state.energy - elapsedSeconds * (isWorking ? 0.12 : 0.045),
      };

      if (isNear(agent, camp.anchor)) {
        if (patch.thirst >= 56 && campStore.take(CAMP_ID, 'water', 1, 'drink') > 0) patch.thirst -= 34;
        if (patch.hunger >= 56 && campStore.take(CAMP_ID, 'berries', 1, 'eat') > 0) patch.hunger -= 26;
      }
      peopleSystem.patchState(person.id, patch);
    });
  }

  function tick(now) {
    if (!running) return;
    const deltaSeconds = Math.min(0.12, Math.max(0, (now - previousFrame) / 1000));
    previousFrame = now;

    clockElapsed += deltaSeconds * 6;
    const wholeMinutes = Math.floor(clockElapsed);
    if (wholeMinutes > 0) {
      gameTime.advanceMinutes(wholeMinutes);
      clockElapsed -= wholeMinutes;
      eventBus.emit('simulation:time', { time: gameTime.stamp() });
    }

    processAgents(deltaSeconds);
    plannerElapsed += deltaSeconds;
    if (plannerElapsed >= 0.75) {
      plannerElapsed = 0;
      planIdleAgents();
    }

    needsElapsed += deltaSeconds;
    if (needsElapsed >= 5) {
      applyNeeds(needsElapsed);
      needsElapsed = 0;
    }

    frameId = requestAnimationFrame(tick);
  }

  function start() {
    if (running) return;
    ensureAgents();
    running = true;
    previousFrame = performance.now();
    planIdleAgents();
    addLog('十位村民开始在起始河谷寻找水源、食物和木材。', 'system');
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
    getRenderPeople,
    getRecentLogs,
    isRunning: () => running,
  });
}
