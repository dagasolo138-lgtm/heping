import { ACTION_TYPES } from './actionTypes.js';
import { EXPOSURE_KEY, relieveExposure } from '../environment/exposureSystem.js';

function completeRecord({ agent, person, task, peopleSystem, gameTime, summary, details = {} }) {
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

export function completeTendFire({ agent, task, peopleSystem, campStore, fireSystem, gameTime, campId }) {
  const person = peopleSystem.get(agent.personId);
  if (!person) return null;
  const taken = campStore.take(campId, 'wood', Number(task.data?.woodAmount ?? 1), 'firewood');
  const added = fireSystem.addFuel(taken);
  const summary = added > 0
    ? `${person.identity.name}为篝火添入了 ${added} 份木材。`
    : `${person.identity.name}来到篝火旁，但营地已没有可用木材。`;
  completeRecord({ agent, person, task, peopleSystem, gameTime, summary, details: { fireId: task.data?.fireId, woodAmount: added } });
  return { summary, personId: person.id };
}

export function completeWarmByFire({ agent, task, peopleSystem, gameTime }) {
  const person = peopleSystem.get(agent.personId);
  if (!person) return null;
  const exposure = relieveExposure(person, task.data?.recovery);
  peopleSystem.setExtension(person.id, EXPOSURE_KEY, exposure);
  const summary = `${person.identity.name}在篝火旁取暖，缓解了寒意与潮湿。`;
  completeRecord({ agent, person, task, peopleSystem, gameTime, summary, details: { exposure } });
  return { summary, personId: person.id, exposure };
}
