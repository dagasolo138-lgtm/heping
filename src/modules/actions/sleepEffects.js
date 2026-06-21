import { ACTION_TYPES } from './actionTypes.js';

export function completeSleep({ agent, task, peopleSystem, gameTime }) {
  const person = peopleSystem.get(agent.personId);
  if (!person) return null;
  const stamp = gameTime.stamp();
  const sheltered = Boolean(task.data?.sheltered);
  const summary = sheltered
    ? `${person.identity.name}在${task.data.shelterLabel}中度过夜晚，恢复了精力。`
    : `${person.identity.name}在营地露宿一夜，休息得并不充分。`;

  peopleSystem.setLocation(person.id, { tileX: Math.round(agent.x), tileY: Math.round(agent.y) });
  peopleSystem.removeStatusTag(person.id, 'sleeping');
  if (sheltered) {
    peopleSystem.addStatusTag(person.id, 'sheltered');
    peopleSystem.removeStatusTag(person.id, 'exposed');
  } else {
    peopleSystem.addStatusTag(person.id, 'exposed');
  }
  peopleSystem.addLifeEvent(person.id, {
    type: `action:${ACTION_TYPES.SLEEP}`,
    summary,
    details: {
      taskId: task.id,
      action: ACTION_TYPES.SLEEP,
      nightKey: task.data?.nightKey,
      sheltered,
      shelterId: task.data?.shelterId ?? null,
    },
    time: stamp,
  });
  const after = peopleSystem.get(person.id);
  peopleSystem.setActivity(person.id, {
    status: 'idle',
    current: null,
    lastCompleted: { type: ACTION_TYPES.SLEEP, label: task.label, time: stamp },
    completedCount: Number(after.activity.completedCount ?? 0) + 1,
  });
  return { summary, personId: person.id };
}
