import { CAMP_ITEM_LABELS } from '../settlements/campStore.js';
import { ACTION_META, ACTION_TYPES } from './actionTypes.js';

function saveAction({ personId, task, gameTime, peopleSystem, agent, summary, details = {} }) {
  const stamp = gameTime.stamp();
  peopleSystem.setLocation(personId, { tileX: Math.round(agent.x), tileY: Math.round(agent.y) });
  peopleSystem.addLifeEvent(personId, {
    type: `action:${task.type}`,
    summary,
    details: { taskId: task.id, action: task.type, ...details },
    time: stamp,
  });
  const after = peopleSystem.get(personId);
  peopleSystem.setActivity(personId, {
    status: 'idle',
    current: null,
    lastCompleted: { type: task.type, label: task.label, time: stamp },
    completedCount: Number(after.activity.completedCount ?? 0) + 1,
  });
}

function siteLabel(buildingSystem, siteId) {
  return buildingSystem.get(siteId)?.label ?? '工地';
}

export function collectConstructionMaterial({ agent, task, peopleSystem, campStore, buildingSystem, campId }) {
  const person = peopleSystem.get(agent.personId);
  if (!person) return { nextTask: null, summary: '' };
  const reservation = buildingSystem.beginDelivery(task.data.siteId, task.data.reservationId);
  if (!reservation) return { nextTask: null, summary: `${person.identity.name}的建材调拨失效。` };
  const carried = campStore.take(campId, reservation.itemId, reservation.amount, 'construction-pickup');
  if (carried <= 0) {
    buildingSystem.cancelReservation(task.data.siteId, reservation.id);
    return { nextTask: null, summary: `${person.identity.name}来到营地时，所需建材已不足。` };
  }
  peopleSystem.changeItem(person.id, reservation.itemId, carried);
  return {
    nextTask: {
      ...task,
      destination: task.data.siteDestination,
      workDuration: ACTION_META[ACTION_TYPES.DELIVER_MATERIALS].workDuration,
      data: { ...task.data, stage: 'deliver', carriedAmount: carried },
    },
    summary: `${person.identity.name}从营地领走了 ${carried} 份${CAMP_ITEM_LABELS[reservation.itemId] ?? reservation.itemId}，正送往${siteLabel(buildingSystem, task.data.siteId)}。`,
  };
}

export function deliverConstructionMaterial({ agent, task, peopleSystem, buildingSystem, gameTime }) {
  const person = peopleSystem.get(agent.personId);
  if (!person) return null;
  const carried = Math.min(Number(task.data.carriedAmount ?? 0), Number(person.inventory.items[task.data.materialId] ?? 0));
  const delivered = buildingSystem.deliverReservation(task.data.siteId, task.data.reservationId, carried);
  if (carried > 0) peopleSystem.changeItem(person.id, task.data.materialId, -carried);
  const label = siteLabel(buildingSystem, task.data.siteId);
  const itemLabel = CAMP_ITEM_LABELS[task.data.materialId] ?? task.data.materialId;
  const summary = delivered?.amount ? `${person.identity.name}把 ${delivered.amount} 份${itemLabel}送到了${label}。` : `${person.identity.name}抵达${label}时，建材交接没有完成。`;
  saveAction({ agent, peopleSystem, personId: person.id, task, gameTime, summary, details: { siteId: task.data.siteId, materialId: task.data.materialId, amount: delivered?.amount ?? 0 } });
  return { summary, personId: person.id };
}

export function performConstructionWork({ agent, task, peopleSystem, buildingSystem, gameTime }) {
  const person = peopleSystem.get(agent.personId);
  if (!person) return null;
  const before = buildingSystem.get(task.data.siteId);
  const result = buildingSystem.addWork(task.data.siteId, task.data.workAmount);
  const label = before?.label ?? '工地';
  const summary = result?.completed ? `${person.identity.name}完成了${label}的最后施工，建筑建成。` : `${person.identity.name}继续搭建${label}。`;
  saveAction({ agent, peopleSystem, personId: person.id, task, gameTime, summary, details: { siteId: task.data.siteId, work: task.data.workAmount, completed: Boolean(result?.completed) } });
  return { summary, personId: person.id, completedBuilding: result?.completed ? result.building : null };
}
