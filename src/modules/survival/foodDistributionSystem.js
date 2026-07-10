const FOOD_PRIORITY = Object.freeze([
  { itemId: 'berries', hungerReduction: 26 },
  { itemId: 'millet', hungerReduction: 32 },
]);
const WATER_REQUEST = Object.freeze({ itemId: 'water', thirstReduction: 34 });
const DENIAL_COOLDOWN_TICKS = 180;

function clone(value) {
  return structuredClone(value);
}

function available(camp, itemId) {
  return Number(camp?.items?.[itemId] ?? 0);
}

function keyOf(personId, need) {
  return `${personId}:${need}`;
}

function evaluateRule(campRulesSystem, person, people, need) {
  return campRulesSystem?.evaluateFoodRequest?.({ person, people, need }) ?? {
    ruleId: 'firstComeFirstServed',
    ruleLabel: '先到先得',
    eligible: true,
    priorityScore: 0,
    explanation: '先到先得（当前为实际即时顺序）',
    enforcement: 'immediate',
    participatesInSorting: true,
    need,
  };
}

export function createFoodDistributionSystem({ eventBus, gameTime, campStore, campRulesSystem = null, campId = 'starting-camp' }) {
  const lastDeniedTick = new Map();

  function shouldEmitDenial(personId, need) {
    const key = keyOf(personId, need);
    const nowTick = Number(gameTime.now().tick ?? 0);
    const previous = Number(lastDeniedTick.get(key) ?? -Infinity);
    if (nowTick - previous < DENIAL_COOLDOWN_TICKS) return false;
    lastDeniedTick.set(key, nowTick);
    return true;
  }

  function emitDistributed(result) {
    eventBus.emit('survival:resource-distributed', { ...clone(result), time: gameTime.stamp() });
  }

  function emitDenied(result) {
    if (!shouldEmitDenial(result.personId, result.need)) return;
    eventBus.emit('survival:resource-denied', { ...clone(result), time: gameTime.stamp() });
    eventBus.emit('survival:scarcity', { severity: 'shortage', need: result.need, personId: result.personId, ruleId: result.ruleId, time: gameTime.stamp() });
  }

  function requestWater({ person, people = [], thirstBefore }) {
    const camp = campStore.get(campId);
    const rule = evaluateRule(campRulesSystem, person, people, 'water');
    const result = {
      type: 'water:request',
      need: 'water',
      personId: person.id,
      thirstBefore,
      ruleId: rule.ruleId,
      ruleLabel: rule.ruleLabel,
      rulePriorityScore: rule.priorityScore,
      ruleExplanation: rule.explanation,
      ruleEnforcement: rule.enforcement ?? 'advisory',
      ruleParticipatesInSorting: Boolean(rule.participatesInSorting),
      granted: false,
      itemId: WATER_REQUEST.itemId,
      amount: 0,
      thirstReduction: 0,
      deniedReason: null,
    };
    if (!rule.eligible) {
      result.deniedReason = 'ruleDenied';
      emitDenied(result);
      return result;
    }
    if (available(camp, WATER_REQUEST.itemId) <= 0) {
      result.deniedReason = 'noWater';
      emitDenied(result);
      return result;
    }
    const taken = campStore.take(campId, WATER_REQUEST.itemId, 1, 'drink');
    if (taken <= 0) {
      result.deniedReason = 'takeFailed';
      emitDenied(result);
      return result;
    }
    result.granted = true;
    result.amount = taken;
    result.thirstReduction = WATER_REQUEST.thirstReduction;
    emitDistributed(result);
    return result;
  }

  function requestFood({ person, people = [], hungerBefore }) {
    const camp = campStore.get(campId);
    const rule = evaluateRule(campRulesSystem, person, people, 'food');
    const result = {
      type: 'food:request',
      need: 'food',
      personId: person.id,
      hungerBefore,
      ruleId: rule.ruleId,
      ruleLabel: rule.ruleLabel,
      rulePriorityScore: rule.priorityScore,
      ruleExplanation: rule.explanation,
      ruleEnforcement: rule.enforcement ?? 'advisory',
      ruleParticipatesInSorting: Boolean(rule.participatesInSorting),
      granted: false,
      itemId: null,
      amount: 0,
      hungerReduction: 0,
      deniedReason: null,
    };
    if (!rule.eligible) {
      result.deniedReason = 'ruleDenied';
      emitDenied(result);
      return result;
    }
    const choice = FOOD_PRIORITY.find((item) => available(camp, item.itemId) > 0);
    if (!choice) {
      result.deniedReason = 'noFood';
      emitDenied(result);
      return result;
    }
    const taken = campStore.take(campId, choice.itemId, 1, 'food:consume');
    if (taken <= 0) {
      result.deniedReason = 'takeFailed';
      emitDenied(result);
      return result;
    }
    result.granted = true;
    result.itemId = choice.itemId;
    result.amount = taken;
    result.hungerReduction = choice.hungerReduction;
    emitDistributed(result);
    return result;
  }

  function exportState() {
    return {
      schemaVersion: 1,
      exportedAt: gameTime.stamp(),
      lastDenied: Object.fromEntries(lastDeniedTick.entries()),
    };
  }

  function importState(snapshot) {
    if (snapshot === null || snapshot === undefined) return null;
    if (snapshot?.schemaVersion !== 1) throw new Error('食物分配存档格式不兼容。');
    lastDeniedTick.clear();
    Object.entries(snapshot.lastDenied ?? {}).forEach(([key, value]) => lastDeniedTick.set(key, Number(value)));
    eventBus.emit('survival:distribution-hydrated', { time: gameTime.stamp() });
    return exportState();
  }

  return Object.freeze({ requestWater, requestFood, exportState, importState });
}
