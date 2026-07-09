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
    const field = farmSystem.sow(task.data.fieldId);
    if (!field) return null;
    const summary = `${person.identity.name}把粟种播进了${field.label}。这块田的土壤${field.soil.label}。`;
    record({ agent, person, task, peopleSystem, gameTime, summary, details: { fieldId: field.id, cropId: field.cropId, soil: field.soil } });
    return { summary, personId: person.id };
  }

  if (task.type === ACTION_TYPES.HARVEST_MILLET) {
    const field = farmSystem.get(task.data.fieldId);
    const harvest = farmSystem.harvest(task.data.fieldId);
    if (!harvest) return null;
    peopleSystem.changeItem(person.id, harvest.itemId, harvest.amount);
    const soilNote = harvest.soilBefore && harvest.soil
      ? `，土壤肥力由 ${harvest.soilBefore.fertility} 降至 ${harvest.soil.fertility}`
      : '';
    const summary = `${person.identity.name}从${field?.label ?? '粟田'}收获了 ${harvest.amount} 份${harvest.label}，并留下了下一轮的种子${soilNote}。`;
    record({ agent, person, task, peopleSystem, gameTime, summary, details: { fieldId: task.data.fieldId, harvest } });
    return { summary, personId: person.id, harvest };
  }

  return null;
}
