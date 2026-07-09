export const CAMP_RULES_SCHEMA_VERSION = 1;

const FOOD_RULES = Object.freeze({
  firstComeFirstServed: { id: 'firstComeFirstServed', label: '先到先得' },
  equalShare: { id: 'equalShare', label: '平均分配' },
  priorityWorkers: { id: 'priorityWorkers', label: '优先劳动者' },
  priorityLowHealth: { id: 'priorityLowHealth', label: '优先健康低者' },
  kinPriority: { id: 'kinPriority', label: '亲属优先' },
  highStatusPriority: { id: 'highStatusPriority', label: '地位高者优先' },
});

const DEFAULT_RULES = Object.freeze({
  foodDistribution: { id: 'firstComeFirstServed', params: {} },
  fireAccess: { id: 'coldestFirst', params: {} },
  storageAccess: { id: 'communal', params: {} },
});

function clone(value) {
  return structuredClone(value);
}

function relationScore(person, otherId) {
  const relation = person.relations?.[otherId];
  return Number(relation?.trust ?? 0) + Number(relation?.affinity ?? 0);
}

function healthPriority(person) {
  return Math.max(0, 100 - Number(person.state?.health ?? 100));
}

function workerPriority(person) {
  const current = person.activity?.current;
  return current && current.type !== 'rest' && current.type !== 'sleep' ? 20 : 0;
}

function kinPriority(person, people) {
  return people.reduce((best, other) => {
    if (other.id === person.id) return best;
    const family = person.family?.spouseId === other.id
      || person.family?.siblingIds?.includes(other.id)
      || person.family?.parentIds?.includes(other.id)
      || person.family?.childIds?.includes(other.id);
    return Math.max(best, family ? 18 : Math.max(0, relationScore(person, other.id) * 0.08));
  }, 0);
}

function statusPriority(person) {
  return Math.max(0, Number(person.work?.skills?.social ?? 0) * 1.5 + Number(person.work?.skills?.trading ?? 0));
}

function priorityScore(ruleId, person, people) {
  if (ruleId === 'priorityLowHealth') return healthPriority(person);
  if (ruleId === 'priorityWorkers') return workerPriority(person);
  if (ruleId === 'kinPriority') return kinPriority(person, people);
  if (ruleId === 'highStatusPriority') return statusPriority(person);
  if (ruleId === 'equalShare') return 10;
  return 0;
}

export function createCampRulesSystem({ eventBus, gameTime, campId = 'starting-camp' }) {
  let state = {
    schemaVersion: CAMP_RULES_SCHEMA_VERSION,
    campId,
    revision: 1,
    active: clone(DEFAULT_RULES),
    history: [{
      id: 'camp-rule-initial',
      type: 'rule:adopted',
      ruleKey: 'foodDistribution',
      from: null,
      to: DEFAULT_RULES.foodDistribution.id,
      reason: 'initial',
      proposedBy: null,
      adoptedAt: gameTime.stamp(),
    }],
  };

  function get() {
    return clone(state);
  }

  function activeRule(ruleKey) {
    return clone(state.active[ruleKey] ?? null);
  }

  function setRule(ruleKey, ruleId, { reason = 'manual', proposedBy = null } = {}) {
    if (ruleKey === 'foodDistribution' && !FOOD_RULES[ruleId]) throw new Error(`未知食物分配规则：${ruleId}`);
    const previous = state.active[ruleKey]?.id ?? null;
    state.active[ruleKey] = { id: ruleId, params: {} };
    state.revision += 1;
    const entry = {
      id: `camp-rule-${state.revision}`,
      type: 'rule:adopted',
      ruleKey,
      from: previous,
      to: ruleId,
      reason,
      proposedBy,
      adoptedAt: gameTime.stamp(),
    };
    state.history.push(entry);
    eventBus.emit('camp:rule-changed', { rule: clone(state.active[ruleKey]), entry: clone(entry), rules: get(), time: gameTime.stamp() });
    return activeRule(ruleKey);
  }

  function evaluateFoodRequest({ person, people = [], need }) {
    const rule = state.active.foodDistribution;
    const score = priorityScore(rule.id, person, people);
    return {
      ruleId: rule.id,
      ruleLabel: FOOD_RULES[rule.id]?.label ?? rule.id,
      eligible: true,
      priorityScore: Math.round(score * 10) / 10,
      explanation: `${FOOD_RULES[rule.id]?.label ?? '营地分配规则'}（当前为 advisory/explanatory：即时请求仍按先到先得发放，优先级仅用于解释与事件记录）`,
      enforcement: 'advisory',
      participatesInSorting: false,
      need,
    };
  }

  function exportState() {
    return { ...get(), exportedAt: gameTime.stamp() };
  }

  function importState(snapshot) {
    if (snapshot === null || snapshot === undefined) return null;
    if (snapshot?.schemaVersion !== CAMP_RULES_SCHEMA_VERSION) throw new Error('营地规则存档格式不兼容。');
    state = {
      schemaVersion: CAMP_RULES_SCHEMA_VERSION,
      campId: snapshot.campId ?? campId,
      revision: Number(snapshot.revision ?? 1),
      active: { ...clone(DEFAULT_RULES), ...(clone(snapshot.active ?? {})) },
      history: Array.isArray(snapshot.history) ? clone(snapshot.history) : [],
    };
    eventBus.emit('camp:rules-hydrated', { rules: get(), time: gameTime.stamp() });
    return get();
  }

  return Object.freeze({
    get,
    activeRule,
    setRule,
    evaluateFoodRequest,
    exportState,
    importState,
    listFoodRules: () => clone(Object.values(FOOD_RULES)),
  });
}
