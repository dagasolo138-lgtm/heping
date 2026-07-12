import { CAMP_ITEM_LABELS } from '../settlements/campStore.js';
import { ACTION_TYPES } from './actionTypes.js';

function record({ agent, person, task, peopleSystem, gameTime, summary, details = {} }) {
  const stamp = gameTime.stamp();
  peopleSystem.setLocation(person.id, { tileX: Math.round(agent.x), tileY: Math.round(agent.y) });
  peopleSystem.addLifeEvent(person.id, {
    type: `action:${task.type}`,
    summary,
    details: { taskId: task.id, action: task.type, ...details },
    time: stamp,
  });
  const after = peopleSystem.get(person.id);
  peopleSystem.setActivity(person.id, {
    status: 'idle',
    current: null,
    lastCompleted: { type: task.type, label: task.label, time: stamp },
    completedCount: Number(after.activity.completedCount ?? 0) + 1,
  });
}

function fail({ agent, person, task, peopleSystem, gameTime, reason, summary, details = {} }) {
  const stamp = gameTime.stamp();
  peopleSystem.setLocation(person.id, { tileX: Math.round(agent.x), tileY: Math.round(agent.y) });
  peopleSystem.addLifeEvent(person.id, {
    type: `action:${task.type}:failed`,
    summary,
    details: { taskId: task.id, action: task.type, failureReason: reason, ...details },
    time: stamp,
  });
  const after = peopleSystem.get(person.id);
  peopleSystem.setActivity(person.id, {
    status: 'idle',
    current: null,
    lastFailed: { type: task.type, label: task.label, reason, time: stamp },
    failedCount: Number(after.activity.failedCount ?? 0) + 1,
  });
  globalThis.__shenglingEventBus?.emit?.('actions:failed', {
    personId: person.id,
    taskId: task.id,
    task: structuredClone(task),
    reason,
    details: structuredClone(details),
    time: stamp,
  });
  return null;
}

export function completeFarmAction({ agent, task, peopleSystem, farmSystem, gameTime }) {
  const person = peopleSystem.get(agent.personId);
  if (!person || !farmSystem) return null;

  if (task.type === ACTION_TYPES.CLEAR_FIELD) {
    const field = farmSystem.clearField(task.data.fieldId, task.data.workAmount);
    if (!field) return null;
    const completed = field.status === 'readyToSow';
    const summary = completed
      ? `${person.identity.name}完成了${field.label}的开垦，土壤当前${field.soil.label}。`
      : `${person.identity.name}正在翻整${field.label}。`;
    record({ agent, person, task, peopleSystem, gameTime, summary, details: { fieldId: field.id, clearing: field.clearing, soil: field.soil } });
    return { summary, personId: person.id };
  }

  if (task.type === ACTION_TYPES.SOW_MILLET) {
    const seedItemId = task.data.seedItemId ?? 'milletSeed';
    const required = Math.max(1, Number(task.data.seedAmount ?? 1));
    const carried = Number(person.inventory.items?.[seedItemId] ?? 0);
    if (carried < required) {
      return fail({
        agent,
        person,
        task,
        peopleSystem,
        gameTime,
        reason: 'seed-cargo-missing',
        summary: `${person.identity.name}抵达农田时没有足够的粟种，播种没有发生。`,
        details: { fieldId: task.data.fieldId, seedItemId, required, carried },
      });
    }
    const field = farmSystem.sow(task.data.fieldId, {
      seedAmount: required,
      personId: person.id,
      taskId: task.id,
    });
    if (!field) {
      return fail({
        agent,
        person,
        task,
        peopleSystem,
        gameTime,
        reason: 'field-no-longer-sowable',
        summary: `${person.identity.name}抵达时发现农田已经无法播种，粟种仍留在背包中。`,
        details: { fieldId: task.data.fieldId, seedItemId, required, carried },
      });
    }
    peopleSystem.changeItem(person.id, seedItemId, -required);
    const summary = `${person.identity.name}把 ${required} 份${CAMP_ITEM_LABELS[seedItemId] ?? '粟种'}播进了${field.label}。这块田的土壤${field.soil.label}。`;
    record({
      agent,
      person,
      task,
      peopleSystem,
      gameTime,
      summary,
      details: { fieldId: field.id, cropId: field.cropId, seedItemId, seedAmount: required, soil: field.soil },
    });
    return { summary, personId: person.id, seedItemId, seedAmount: required };
  }

  if (task.type === ACTION_TYPES.HARVEST_MILLET) {
    const field = farmSystem.get(task.data.fieldId);
    const harvest = farmSystem.harvest(task.data.fieldId);
    if (!harvest) return null;
    if (harvest.foodAmount > 0) peopleSystem.changeItem(person.id, harvest.itemId, harvest.foodAmount);
    if (harvest.seedAmount > 0) peopleSystem.changeItem(person.id, harvest.seedItemId, harvest.seedAmount);
    const soilNote = harvest.soilBefore && harvest.soil
      ? `，土壤肥力由 ${harvest.soilBefore.fertility} 降至 ${harvest.soil.fertility}`
      : '';
    const summary = `${person.identity.name}从${field?.label ?? '粟田'}收获了 ${harvest.foodAmount} 份${harvest.label}，另留出 ${harvest.seedAmount} 份${harvest.seedLabel ?? '粟种'}${soilNote}。`;
    record({ agent, person, task, peopleSystem, gameTime, summary, details: { fieldId: task.data.fieldId, harvest } });
    return { summary, personId: person.id, harvest };
  }

  return null;
}
