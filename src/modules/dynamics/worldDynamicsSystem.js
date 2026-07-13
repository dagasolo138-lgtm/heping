export const WORLD_DYNAMICS_SCHEMA_VERSION = 1;

const STOCK_DOMAIN = Object.freeze({
  food: 'survival',
  berries: 'survival',
  millet: 'survival',
  water: 'survival',
  wood: 'production',
  milletSeed: 'agriculture',
});

const RESPONSE_BY_ITEM = Object.freeze({
  food: 'restore-food-reserve',
  berries: 'restore-food-reserve',
  millet: 'restore-food-reserve',
  water: 'restore-water-reserve',
  wood: 'restore-wood-reserve',
  milletSeed: 'restore-seed-reserve',
});

function clone(value) {
  return structuredClone(value);
}

function clamp(value, minimum = 0, maximum = 1) {
  return Math.max(minimum, Math.min(maximum, Number(value) || 0));
}

function round(value) {
  return Math.round((Number(value) || 0) * 1000) / 1000;
}

function normalizedTime(value = {}) {
  return {
    year: Math.max(1, Math.floor(Number(value.year) || 1)),
    day: Math.max(1, Math.floor(Number(value.day) || 1)),
    minute: Math.max(0, Math.floor(Number(value.minute) || 0)),
    tick: Math.max(0, Math.floor(Number(value.tick) || 0)),
    ...(value.label ? { label: String(value.label) } : {}),
  };
}

function dayKey(time = {}) {
  return `${Number(time.year ?? 1)}:${Number(time.day ?? 1)}`;
}

function recordId(prefix, signature, time) {
  const safeSignature = String(signature).replace(/[^a-zA-Z0-9:_-]+/g, '-');
  return `${prefix}:${safeSignature}:${Number(time.year)}:${Number(time.day)}`;
}

function responseForItem(itemId) {
  return RESPONSE_BY_ITEM[itemId] ?? `restore-${itemId}-reserve`;
}

function stockPressureCandidates(report = {}) {
  const gaps = report.stockGaps ?? {};
  const goals = report.stockTargets?.goals ?? {};
  return Object.entries(gaps).flatMap(([itemId, rawGap]) => {
    const gap = Math.max(0, Number(rawGap) || 0);
    if (gap <= 0.01) return [];
    const goal = Math.max(1, Number(goals[itemId]) || gap);
    const ratio = gap / goal;
    return [{
      signature: `stock-gap:${itemId}`,
      kind: 'stock-gap',
      domain: STOCK_DOMAIN[itemId] ?? 'production',
      subjectId: itemId,
      baseSeverity: clamp(0.25 + ratio * 0.65),
      causes: ['stock-target-gap'],
      evidence: { itemId, gap: round(gap), goal: round(goal), ratio: round(ratio) },
      suggestedResponses: [responseForItem(itemId)],
    }];
  });
}

function denialPressureCandidates(report = {}) {
  const denials = report.denials ?? {};
  return ['food', 'water'].flatMap((need) => {
    const count = Math.max(0, Number(denials[need]) || 0);
    if (!count) return [];
    return [{
      signature: `survival-denial:${need}`,
      kind: 'survival-denial',
      domain: 'survival',
      subjectId: need,
      baseSeverity: clamp(0.45 + count * 0.12),
      causes: [`${need}-request-denied`],
      evidence: { need, count },
      suggestedResponses: [need === 'food' ? 'emergency-food-supply' : 'emergency-water-supply'],
    }];
  });
}

function spoilagePressureCandidates(report = {}) {
  const spoilage = Math.max(0, Number(report.flow?.byCategory?.spoilage) || 0);
  const production = Math.max(0, Number(report.flow?.byCategory?.production) || 0);
  const ratio = spoilage / Math.max(1, production);
  if (ratio < 0.1) return [];
  return [{
    signature: 'spoilage:storage',
    kind: 'spoilage',
    domain: 'storage',
    subjectId: 'food-storage',
    baseSeverity: clamp(0.25 + ratio),
    causes: ['storage-loss'],
    evidence: { spoilage: round(spoilage), production: round(production), ratio: round(ratio) },
    suggestedResponses: ['improve-storage'],
  }];
}

function laborPressureCandidates(report = {}) {
  const labor = report.labor ?? {};
  const assigned = Math.max(0, Number(labor.assigned ?? labor.started) || 0);
  const completed = Math.max(0, Number(labor.completed) || 0);
  const cancelled = Math.max(0, Number(labor.cancelled) || 0);
  const failed = Math.max(0, Number(labor.failed) || 0);
  const backlog = Math.max(0, assigned - completed - cancelled - failed);
  if (backlog < 3) return [];
  return [{
    signature: 'labor:backlog',
    kind: 'labor-backlog',
    domain: 'labor',
    subjectId: 'community-labor',
    baseSeverity: clamp(0.25 + backlog / 12),
    causes: ['unfinished-work'],
    evidence: { assigned, completed, cancelled, failed, backlog },
    suggestedResponses: ['reduce-labor-backlog'],
  }];
}

function farmPressureCandidates(context = {}) {
  const farm = context.farm ?? {};
  const candidates = [];
  const shortage = Math.max(0, Number(farm.seed?.shortage) || 0);
  if (shortage > 0) {
    const target = Math.max(1, Number(farm.seed?.target) || shortage);
    candidates.push({
      signature: 'farm:seed-shortage',
      kind: 'seed-shortage',
      domain: 'agriculture',
      subjectId: 'milletSeed',
      baseSeverity: clamp(0.3 + shortage / target * 0.65),
      causes: ['insufficient-seed-stock'],
      evidence: {
        shortage: round(shortage),
        target: round(target),
        onHand: round(farm.seed?.onHand),
      },
      suggestedResponses: ['restore-seed-reserve'],
    });
  }

  const poorFields = Math.max(0, Number(farm.soil?.poorFields) || 0);
  const thinFields = Math.max(0, Number(farm.soil?.thinFields) || 0);
  if (poorFields > 0 || thinFields > 0) {
    const total = Math.max(1, Number(farm.total) || poorFields || thinFields);
    candidates.push({
      signature: 'farm:soil-degradation',
      kind: 'soil-degradation',
      domain: 'agriculture',
      subjectId: 'farmland',
      baseSeverity: clamp(0.35 + poorFields / total * 0.25 + thinFields / total * 0.35),
      causes: ['declining-soil-fertility'],
      evidence: {
        total,
        poorFields,
        thinFields,
        averageFertility: Number(farm.soil?.averageFertility ?? 0),
      },
      suggestedResponses: ['restore-soil-fertility'],
    });
  }
  return candidates;
}

function buildPressureCandidates(report, context) {
  const merged = [
    ...stockPressureCandidates(report),
    ...denialPressureCandidates(report),
    ...spoilagePressureCandidates(report),
    ...laborPressureCandidates(report),
    ...farmPressureCandidates(context),
  ];
  const bySignature = new Map();
  merged.forEach((candidate) => {
    const existing = bySignature.get(candidate.signature);
    if (!existing || candidate.baseSeverity > existing.baseSeverity) bySignature.set(candidate.signature, candidate);
  });
  return [...bySignature.values()];
}

function surplusOpportunities(report = {}) {
  const closing = report.closingInventory?.byItem ?? {};
  const goals = report.stockTargets?.goals ?? {};
  return Object.entries(goals).flatMap(([itemId, rawGoal]) => {
    const goal = Math.max(0, Number(rawGoal) || 0);
    const amount = Math.max(0, Number(closing[itemId]) || 0);
    if (goal <= 0 || amount < goal * 1.25) return [];
    const surplus = amount - goal;
    return [{
      signature: `surplus:${itemId}`,
      kind: 'stock-surplus',
      domain: STOCK_DOMAIN[itemId] ?? 'production',
      subjectId: itemId,
      value: clamp(surplus / Math.max(1, goal)),
      evidence: { itemId, amount: round(amount), goal: round(goal), surplus: round(surplus) },
      possibleActions: [`use-${itemId}-surplus`],
    }];
  });
}

function farmOpportunities(context = {}) {
  const farm = context.farm ?? {};
  const weather = context.weather ?? {};
  const opportunities = [];
  if (weather.isRain && Number(farm.sowable ?? 0) > 0 && Number(farm.seed?.onHand ?? 0) > 0) {
    opportunities.push({
      signature: 'farm:rain-sowing-window',
      kind: 'rain-sowing-window',
      domain: 'agriculture',
      subjectId: 'farmland',
      value: 0.8,
      evidence: {
        weatherId: weather.id ?? null,
        sowableFields: Number(farm.sowable),
        seedsOnHand: Number(farm.seed?.onHand),
      },
      possibleActions: ['sow-millet'],
    });
  }
  if (Number(farm.mature ?? 0) > 0) {
    opportunities.push({
      signature: 'farm:harvest-window',
      kind: 'harvest-window',
      domain: 'agriculture',
      subjectId: 'farmland',
      value: clamp(0.55 + Number(farm.mature) * 0.1),
      evidence: { matureFields: Number(farm.mature) },
      possibleActions: ['harvest-millet'],
    });
  }
  return opportunities;
}

function buildOpportunityCandidates(report, context) {
  return [...surplusOpportunities(report), ...farmOpportunities(context)];
}

function commitmentGoal(pressure) {
  if (pressure.kind === 'stock-gap') {
    return {
      metric: 'effective-stock',
      itemId: pressure.subjectId,
      target: Number(pressure.evidence?.goal ?? 0),
      unit: 'item',
    };
  }
  if (pressure.kind === 'survival-denial') {
    return { metric: 'resource-denials', need: pressure.subjectId, target: 0, unit: 'denial' };
  }
  if (pressure.kind === 'spoilage') {
    return { metric: 'spoilage-ratio', target: 0.1, unit: 'ratio' };
  }
  if (pressure.kind === 'labor-backlog') {
    return { metric: 'labor-backlog', target: 0, unit: 'task' };
  }
  if (pressure.kind === 'seed-shortage') {
    return { metric: 'seed-stock', itemId: 'milletSeed', target: Number(pressure.evidence?.target ?? 0), unit: 'item' };
  }
  if (pressure.kind === 'soil-degradation') {
    return { metric: 'poor-fields', target: 0, unit: 'field' };
  }
  return { metric: pressure.kind, target: 0, unit: 'state' };
}

function runtimeContext(getRuntime) {
  const runtime = getRuntime?.() ?? {};
  let farm = null;
  let weather = null;
  let season = null;
  try { farm = runtime.farmSystem?.getSummary?.() ?? null; } catch { farm = null; }
  try { weather = runtime.weatherSystem?.get?.() ?? null; } catch { weather = null; }
  try { season = runtime.seasonSystem?.get?.() ?? null; } catch { season = null; }
  return { farm, weather, season };
}

export function createWorldDynamicsSystem({ eventBus = null, gameTime, getRuntime = () => globalThis.shengling } = {}) {
  if (!gameTime?.stamp) throw new Error('世界动力系统缺少世界时间。');

  const activePressures = new Map();
  const pressureHistory = [];
  const activeOpportunities = new Map();
  const opportunityHistory = [];
  const commitments = new Map();
  let evaluatedAt = null;

  function now() {
    return normalizedTime(gameTime.stamp());
  }

  function emit(eventName, payload) {
    eventBus?.emit?.(eventName, { ...clone(payload), time: now() });
  }

  function resolveMissingPressures(signatures, time) {
    const resolved = [];
    [...activePressures.entries()].forEach(([signature, pressure]) => {
      if (signatures.has(signature)) return;
      const next = { ...pressure, state: 'resolved', resolvedAt: clone(time), updatedAt: clone(time) };
      activePressures.delete(signature);
      pressureHistory.push(next);
      resolved.push(next);
      emit('world-dynamics:pressure-resolved', { pressure: next });
    });
    return resolved;
  }

  function updatePressures(candidates, time) {
    const opened = [];
    const updated = [];
    const signatures = new Set(candidates.map((candidate) => candidate.signature));
    const resolved = resolveMissingPressures(signatures, time);

    candidates.forEach((candidate) => {
      const previous = activePressures.get(candidate.signature);
      const nextPersistence = previous && dayKey(previous.updatedAt) !== dayKey(time)
        ? previous.persistenceDays + 1
        : previous?.persistenceDays ?? 1;
      const severity = clamp(candidate.baseSeverity + Math.min(0.25, Math.max(0, nextPersistence - 1) * 0.05));
      const next = {
        id: previous?.id ?? recordId('pressure', candidate.signature, time),
        signature: candidate.signature,
        kind: candidate.kind,
        domain: candidate.domain,
        subjectId: candidate.subjectId ?? null,
        state: 'active',
        severity: round(severity),
        baseSeverity: round(candidate.baseSeverity),
        persistenceDays: nextPersistence,
        openedAt: clone(previous?.openedAt ?? time),
        updatedAt: clone(time),
        causes: clone(candidate.causes ?? []),
        evidence: clone(candidate.evidence ?? {}),
        suggestedResponses: clone(candidate.suggestedResponses ?? []),
      };
      activePressures.set(candidate.signature, next);
      if (previous) updated.push(next);
      else {
        opened.push(next);
        emit('world-dynamics:pressure-opened', { pressure: next });
      }
    });
    return { opened, updated, resolved };
  }

  function resolveMissingOpportunities(signatures, time) {
    const resolved = [];
    [...activeOpportunities.entries()].forEach(([signature, opportunity]) => {
      if (signatures.has(signature)) return;
      const next = { ...opportunity, state: 'expired', expiredAt: clone(time), updatedAt: clone(time) };
      activeOpportunities.delete(signature);
      opportunityHistory.push(next);
      resolved.push(next);
      emit('world-dynamics:opportunity-expired', { opportunity: next });
    });
    return resolved;
  }

  function updateOpportunities(candidates, time) {
    const opened = [];
    const updated = [];
    const signatures = new Set(candidates.map((candidate) => candidate.signature));
    const expired = resolveMissingOpportunities(signatures, time);
    candidates.forEach((candidate) => {
      const previous = activeOpportunities.get(candidate.signature);
      const persistenceDays = previous && dayKey(previous.updatedAt) !== dayKey(time)
        ? previous.persistenceDays + 1
        : previous?.persistenceDays ?? 1;
      const next = {
        id: previous?.id ?? recordId('opportunity', candidate.signature, time),
        signature: candidate.signature,
        kind: candidate.kind,
        domain: candidate.domain,
        subjectId: candidate.subjectId ?? null,
        state: 'active',
        value: round(clamp(candidate.value)),
        persistenceDays,
        openedAt: clone(previous?.openedAt ?? time),
        updatedAt: clone(time),
        evidence: clone(candidate.evidence ?? {}),
        possibleActions: clone(candidate.possibleActions ?? []),
      };
      activeOpportunities.set(candidate.signature, next);
      if (previous) updated.push(next);
      else {
        opened.push(next);
        emit('world-dynamics:opportunity-opened', { opportunity: next });
      }
    });
    return { opened, updated, expired };
  }

  function activeCommitmentFor(signature) {
    return [...commitments.values()].find((commitment) => commitment.sourceSignature === signature && commitment.state === 'active') ?? null;
  }

  function updateCommitments(pressureChanges, time) {
    const created = [];
    const completed = [];

    pressureChanges.resolved.forEach((pressure) => {
      const commitment = activeCommitmentFor(pressure.signature);
      if (!commitment) return;
      const next = {
        ...commitment,
        state: 'completed',
        progress: 1,
        currentSeverity: 0,
        updatedAt: clone(time),
        completedAt: clone(time),
      };
      commitments.set(next.id, next);
      completed.push(next);
      emit('world-dynamics:commitment-completed', { commitment: next, pressure });
    });

    [...activePressures.values()].forEach((pressure) => {
      const existing = activeCommitmentFor(pressure.signature);
      if (existing) {
        const progress = clamp(1 - pressure.severity / Math.max(0.001, existing.initialSeverity));
        commitments.set(existing.id, {
          ...existing,
          currentSeverity: pressure.severity,
          priority: Math.round(pressure.severity * 100),
          progress: round(progress),
          updatedAt: clone(time),
        });
        return;
      }

      const urgent = pressure.kind === 'survival-denial' && pressure.severity >= 0.7;
      if (!urgent && (pressure.persistenceDays < 2 || pressure.severity < 0.55)) return;
      const responseType = pressure.suggestedResponses[0] ?? `resolve-${pressure.kind}`;
      const commitment = {
        id: recordId('commitment', `${responseType}:${pressure.signature}`, time),
        type: responseType,
        domain: pressure.domain,
        sourcePressureId: pressure.id,
        sourceSignature: pressure.signature,
        state: 'active',
        priority: Math.round(pressure.severity * 100),
        goal: commitmentGoal(pressure),
        progress: 0,
        initialSeverity: pressure.severity,
        currentSeverity: pressure.severity,
        createdAt: clone(time),
        updatedAt: clone(time),
        completedAt: null,
      };
      commitments.set(commitment.id, commitment);
      created.push(commitment);
      emit('world-dynamics:commitment-created', { commitment, pressure });
    });

    return { created, completed };
  }

  function evaluate(report = {}, context = runtimeContext(getRuntime)) {
    const time = normalizedTime(report.closedAt ?? report.openedAt ?? gameTime.stamp());
    const pressureChanges = updatePressures(buildPressureCandidates(report, context), time);
    const opportunityChanges = updateOpportunities(buildOpportunityCandidates(report, context), time);
    const commitmentChanges = updateCommitments(pressureChanges, time);
    evaluatedAt = clone(time);
    const result = {
      evaluatedAt: clone(time),
      pressureChanges,
      opportunityChanges,
      commitmentChanges,
      summary: getSummary(),
    };
    emit('world-dynamics:evaluated', result);
    return clone(result);
  }

  function observe(eventName, payload = {}) {
    if (eventName !== 'daily-economy:finalized' || !payload.report) return null;
    return evaluate(payload.report);
  }

  function listPressures({ state = 'all' } = {}) {
    const active = [...activePressures.values()];
    const historical = pressureHistory;
    const result = state === 'active' ? active : state === 'resolved' ? historical : [...historical, ...active];
    return result.map(clone);
  }

  function listOpportunities({ state = 'all' } = {}) {
    const active = [...activeOpportunities.values()];
    const historical = opportunityHistory;
    const result = state === 'active' ? active : state === 'expired' ? historical : [...historical, ...active];
    return result.map(clone);
  }

  function listCommitments({ state = 'all' } = {}) {
    return [...commitments.values()]
      .filter((commitment) => state === 'all' || commitment.state === state)
      .map(clone);
  }

  function getSummary() {
    const activePressureList = [...activePressures.values()];
    const activeOpportunityList = [...activeOpportunities.values()];
    const activeCommitments = [...commitments.values()].filter((entry) => entry.state === 'active');
    const dominantPressure = activePressureList
      .slice()
      .sort((first, second) => second.severity - first.severity || first.id.localeCompare(second.id))[0] ?? null;
    const bestOpportunity = activeOpportunityList
      .slice()
      .sort((first, second) => second.value - first.value || first.id.localeCompare(second.id))[0] ?? null;
    return {
      schemaVersion: WORLD_DYNAMICS_SCHEMA_VERSION,
      evaluatedAt: evaluatedAt ? clone(evaluatedAt) : null,
      activePressures: activePressureList.length,
      activeOpportunities: activeOpportunityList.length,
      activeCommitments: activeCommitments.length,
      dominantPressure: dominantPressure ? clone(dominantPressure) : null,
      bestOpportunity: bestOpportunity ? clone(bestOpportunity) : null,
    };
  }

  function verify() {
    const issues = [];
    const records = [...activePressures.values(), ...pressureHistory];
    const ids = new Set();
    records.forEach((pressure) => {
      if (ids.has(pressure.id)) issues.push({ type: 'duplicate-pressure-id', id: pressure.id });
      ids.add(pressure.id);
      if (pressure.severity < 0 || pressure.severity > 1) issues.push({ type: 'invalid-pressure-severity', id: pressure.id, severity: pressure.severity });
      if (pressure.persistenceDays < 1) issues.push({ type: 'invalid-pressure-persistence', id: pressure.id, persistenceDays: pressure.persistenceDays });
    });
    [...activeOpportunities.values(), ...opportunityHistory].forEach((opportunity) => {
      if (opportunity.value < 0 || opportunity.value > 1) issues.push({ type: 'invalid-opportunity-value', id: opportunity.id, value: opportunity.value });
    });
    commitments.forEach((commitment) => {
      if (!['active', 'completed', 'cancelled', 'failed'].includes(commitment.state)) {
        issues.push({ type: 'invalid-commitment-state', id: commitment.id, state: commitment.state });
      }
      if (commitment.progress < 0 || commitment.progress > 1) issues.push({ type: 'invalid-commitment-progress', id: commitment.id, progress: commitment.progress });
    });
    return {
      ok: issues.length === 0,
      issues,
      pressures: records.length,
      opportunities: activeOpportunities.size + opportunityHistory.length,
      commitments: commitments.size,
    };
  }

  function exportState() {
    return {
      schemaVersion: WORLD_DYNAMICS_SCHEMA_VERSION,
      evaluatedAt: evaluatedAt ? clone(evaluatedAt) : null,
      activePressures: [...activePressures.values()].map(clone),
      pressureHistory: pressureHistory.map(clone),
      activeOpportunities: [...activeOpportunities.values()].map(clone),
      opportunityHistory: opportunityHistory.map(clone),
      commitments: [...commitments.values()].map(clone),
    };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== WORLD_DYNAMICS_SCHEMA_VERSION) throw new Error('世界动力存档格式不兼容。');
    const arrays = ['activePressures', 'pressureHistory', 'activeOpportunities', 'opportunityHistory', 'commitments'];
    arrays.forEach((key) => {
      if (!Array.isArray(snapshot[key])) throw new Error(`世界动力存档缺少 ${key}。`);
    });
    activePressures.clear();
    snapshot.activePressures.forEach((record) => activePressures.set(record.signature, clone(record)));
    pressureHistory.splice(0, pressureHistory.length, ...snapshot.pressureHistory.map(clone));
    activeOpportunities.clear();
    snapshot.activeOpportunities.forEach((record) => activeOpportunities.set(record.signature, clone(record)));
    opportunityHistory.splice(0, opportunityHistory.length, ...snapshot.opportunityHistory.map(clone));
    commitments.clear();
    snapshot.commitments.forEach((record) => commitments.set(record.id, clone(record)));
    evaluatedAt = snapshot.evaluatedAt ? normalizedTime(snapshot.evaluatedAt) : null;
    const verification = verify();
    if (!verification.ok) throw new Error(`世界动力存档校验失败：${verification.issues[0]?.type ?? 'unknown'}`);
    emit('world-dynamics:hydrated', { summary: getSummary() });
    return exportState();
  }

  function reset() {
    activePressures.clear();
    pressureHistory.splice(0);
    activeOpportunities.clear();
    opportunityHistory.splice(0);
    commitments.clear();
    evaluatedAt = null;
    emit('world-dynamics:reset', { summary: getSummary() });
    return exportState();
  }

  return Object.freeze({
    observe,
    evaluate,
    listPressures,
    listOpportunities,
    listCommitments,
    getSummary,
    verify,
    exportState,
    importState,
    reset,
    createCheckpoint: exportState,
    restoreCheckpoint: importState,
  });
}
