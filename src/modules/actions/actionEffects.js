import { CAMP_ITEM_LABELS } from '../settlements/campStore.js';
import { ACTION_TYPES } from './actionTypes.js';

const RESOURCE_IDS = ['wood', 'berries', 'millet', 'water'];

function itemText(items) {
  return Object.entries(items)
    .filter(([, value]) => value > 0)
    .map(([id, value]) => `${CAMP_ITEM_LABELS[id] ?? id}×${value}`)
    .join('、');
}

export function completeAction({ agent, task, peopleSystem, mapSystem, campStore, ecologySystem, gameTime, campId }) {
  const person = peopleSystem.get(agent.personId);
  if (!person) return null;
  const stamp = gameTime.stamp();
  let summary = '';
  let details = { taskId: task.id, action: task.type };

  if (task.type === ACTION_TYPES.FETCH_WATER) {
    const value = Number(task.data.yield ?? 3);
    peopleSystem.changeItem(person.id, 'water', value);
    summary = `${person.identity.name}在河岸取回了 ${value} 份清水。`;
  }

  if (task.type === ACTION_TYPES.GATHER_BERRIES) {
    const harvested = mapSystem.removeFeature(task.data.featureId);
    if (harvested) {
      const value = Number(task.data.yield ?? 2);
      const renewal = ecologySystem?.registerDepletion(harvested);
      peopleSystem.changeItem(person.id, 'berries', value);
      summary = `${person.identity.name}采下了 ${value} 份浆果，灌丛将随季节恢复。`;
      details = { ...details, featureId: harvested.id, resource: 'berries', renewalAtTick: renewal?.regrowAtTick ?? null };
    } else summary = `${person.identity.name}抵达时发现浆果丛已经被采空。`;
  }

  if (task.type === ACTION_TYPES.CHOP_TREE) {
    const felled = mapSystem.removeFeature(task.data.featureId);
    if (felled) {
      const value = Number(task.data.yield ?? 4);
      const renewal = ecologySystem?.registerDepletion(felled);
      peopleSystem.changeItem(person.id, 'wood', value);
      summary = `${person.identity.name}砍倒了一棵树，获得 ${value} 份木材；树桩留下等待新芽。`;
      details = { ...details, featureId: felled.id, resource: 'wood', renewalAtTick: renewal?.regrowAtTick ?? null };
    } else summary = `${person.identity.name}抵达时发现目标树木已经不在。`;
  }

  if (task.type === ACTION_TYPES.HAUL_TO_CAMP) {
    const current = peopleSystem.get(person.id);
    const delivered = {};
    RESOURCE_IDS.forEach((itemId) => {
      const carried = Number(current.inventory.items[itemId] ?? 0);
      if (carried <= 0) return;
      const actual = campStore.change(campId, itemId, carried, 'delivery');
      if (actual > 0) {
        peopleSystem.changeItem(person.id, itemId, -actual);
        delivered[itemId] = actual;
      }
    });
    const remaining = Object.fromEntries(RESOURCE_IDS
      .map((itemId) => [itemId, Number(peopleSystem.get(person.id).inventory.items[itemId] ?? 0)])
      .filter(([, value]) => value > 0));
    summary = Object.keys(delivered).length
      ? `${person.identity.name}把${itemText(delivered)}搬回了起始营地。`
      : Object.keys(remaining).length
        ? `${person.identity.name}抵达营地时储存已满，暂时无法卸下${itemText(remaining)}。`
        : `${person.identity.name}回到营地，背包中没有需要归还的物资。`;
    details = { ...details, delivered };
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
    details,
    time: stamp,
  });
  const after = peopleSystem.get(person.id);
  peopleSystem.setActivity(person.id, {
    status: 'idle',
    current: null,
    lastCompleted: { type: task.type, label: task.label, time: stamp },
    completedCount: Number(after.activity.completedCount ?? 0) + 1,
  });
  return { summary, personId: person.id };
}
