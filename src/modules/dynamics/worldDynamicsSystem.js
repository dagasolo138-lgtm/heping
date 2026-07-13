export const WORLD_DYNAMICS_SCHEMA_VERSION = 1;

const DOMAIN = Object.freeze({
  food: 'survival', berries: 'survival', millet: 'survival', water: 'survival',
  wood: 'production', milletSeed: 'agriculture',
});
const RESPONSE = Object.freeze({
  food: 'restore-food-reserve', berries: 'restore-food-reserve', millet: 'restore-food-reserve',
  water: 'restore-water-reserve', wood: 'restore-wood-reserve', milletSeed: 'restore-seed-reserve',
});

const copy = (value) => structuredClone(value);
const clamp = (value, min = 0, max = 1) => Math.max(min, Math.min(max, Number(value) || 0));
const round = (value) => Math.round((Number(value) || 0) * 1000) / 1000;
const dayKey = (time = {}) => `${Number(time.year ?? 1)}:${Number(time.day ?? 1)}`;

function normalizeTime(value = {}) {
  return {
    year: Math.max(1, Math.floor(Number(value.year) || 1)),
    day: Math.max(1, Math.floor(Number(value.day) || 1)),
    minute: Math.max(0, Math.floor(Number(value.minute) || 0)),
    tick: Math.max(0, Math.floor(Number(value.tick) || 0)),
    ...(value.label ? { label: String(value.label) } : {}),
  };
}

function reportTime(report = {}, fallback = {}) {
  const source = report.closedAt ?? report.openedAt ?? fallback;
  return normalizeTime({ ...source, year: report.year ?? source?.year, day: report.day ?? source?.day });
}

function recordId(prefix, signature, time) {
  const safe = String(signature).replace(/[^a-zA-Z0-9:_-]+/g, '-');
  return `${prefix}:${safe}:${time.year}:${time.day}`;
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
      kind: 'stock-gap', domain: DOMAIN[itemId] ?? 'production', subjectId: itemId,
      baseSeverity: clamp(0.25 + ratio * 0.65), causes: ['stock-target-gap'],
      evidence: { itemId, gap: round(gap), goal: round(goal), ratio: round(ratio) },
      suggestedResponses: [RESPONSE[itemId] ?? `restore-${itemId}-reserve`],
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
      kind: 'survival-denial', domain: 'survival', subjectId: need,
      baseSeverity: clamp(0.45 + count * 0.12), causes: [`${need}-request-denied`],
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
    signature: 'spoilage:storage', kind: 'spoilage', domain: 'storage', subjectId: 'food-storage',
    baseSeverity: clamp(0.25 + ratio), causes: ['storage-loss'],
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
    signature: 'labor:backlog', kind: 'labor-backlog', domain: 'labor', subjectId: 'community-labor',
    baseSeverity: clamp(0.25 + backlog / 12), causes: ['unfinished-work'],
    evidence: { assigned, completed, cancelled, failed, backlog },
    suggestedResponses: ['reduce-labor-backlog'],
  }];
}

function farmPressureCandidates(context = {}) {
  const farm = context.farm ?? {};
  const result = [];
  const shortage = Math.max(0, Number(farm.seed?.shortage) || 0);
  if (shortage > 0) {
    const target = Math.max(1, Number(farm.seed?.target) || shortage);
    result.push({
      signature: 'farm:seed-shortage', kind: 'seed-shortage', domain: 'agriculture', subjectId: 'milletSeed',
      baseSeverity: clamp(0.3 + shortage / target * 0.65), causes: ['insufficient-seed-stock'],
      evidence: { shortage: round(shortage), target: round(target), onHand: round(farm.seed?.onHand) },
      suggestedResponses: ['restore-seed-reserve'],
    });
  }
  const poorFields = Math.max(0, Number(farm.soil?.poorFields) || 0);
  const thinFields = Math.max(0, Number(farm.soil?.thinFields) || 0);
  if (poorFields > 0 || thinFields > 0) {
    const total = Math.max(1, Number(farm.total) || poorFields || thinFields);
    result.push({
      signature: 'farm:soil-degradation', kind: 'soil-degradation', domain: 'agriculture', subjectId: 'farmland',
      baseSeverity: clamp(0.35 + poorFields / total * 0.25 + thinFields / total * 0.35),
      causes: ['declining-soil-fertility'],
      evidence: { total, poorFields, thinFields, averageFertility: Number(farm.soil?.averageFertility ?? 0) },
      suggestedResponses: ['restore-soil-fertility'],
    });
  }
  return result;
}

function pressureCandidates(report, context) {
  const merged = [
    ...stockPressureCandidates(report), ...denialPressureCandidates(report),
    ...spoilagePressureCandidates(report), ...laborPressureCandidates(report),
    ...farmPressureCandidates(context),
  ];
  const unique = new Map();
  merged.forEach((candidate) => {
    const previous = unique.get(candidate.signature);
    if (!previous || candidate.baseSeverity > previous.baseSeverity) unique.set(candidate.signature, candidate);
  });
  return [...unique.values()];
}

function closingAmount(closing, itemId) {
  if (itemId === 'food') {
    return Math.max(0, Number(closing.berries) || 0) + Math.max(0, Number(closing.millet) || 0);
  }
  return Math.max(0, Number(closing[itemId]) || 0);
}

function opportunityCandidates(report = {}, context = {}) {
  const closing = report.closingInventory?.byItem ?? {};
  const goals = report.stockTargets?.goals ?? {};
  const result = Object.entries(goals).flatMap(([itemId, rawGoal]) => {
    const goal = Math.max(0, Number(rawGoal) || 0);
    const amount = closingAmount(closing, itemId);
    if (goal <= 0 || amount < goal * 1.25) return [];
    const surplus = amount - goal;
    return [{
      signature: `surplus:${itemId}`, kind: 'stock-surplus', domain: DOMAIN[itemId] ?? 'production',
      subjectId: itemId, value: clamp(surplus / Math.max(1, goal)),
      evidence: { itemId, amount: round(amount), goal: round(goal), surplus: round(surplus) },
      possibleActions: [`use-${itemId}-surplus`],
    }];
  });
  const farm = context.farm ?? {};
  const weather = context.weather ?? {};
  if (weather.isRain && Number(farm.sowable ?? 0) > 0 && Number(farm.seed?.onHand ?? 0) > 0) {
    result.push({
      signature: 'farm:rain-sowing-window', kind: 'rain-sowing-window', domain: 'agriculture',
      subjectId: 'farmland', value: 0.8,
      evidence: { weatherId: weather.id ?? null, sowableFields: Number(farm.sowable), seedsOnHand: Number(farm.seed?.onHand) },
      possibleActions: ['sow-millet'],
    });
  }
  if (Number(farm.mature ?? 0) > 0) {
    result.push({
      signature: 'farm:harvest-window', kind: 'harvest-window', domain: 'agriculture',
      subjectId: 'farmland', value: clamp(0.55 + Number(farm.mature) * 0.1),
      evidence: { matureFields: Number(farm.mature) }, possibleActions: ['harvest-millet'],
    });
  }
  return result;
}

function commitmentGoal(pressure) {
  if (pressure.kind === 'stock-gap') return { metric: 'effective-stock', itemId: pressure.subjectId, target: Number(pressure.evidence?.goal ?? 0), unit: 'item' };
  if (pressure.kind === 'survival-denial') return { metric: 'resource-denials', need: pressure.subjectId, target: 0, unit: 'denial' };
  if (pressure.kind === 'spoilage') return { metric: 'spoilage-ratio', target: 0.1, unit: 'ratio' };
  if (pressure.kind === 'labor-backlog') return { metric: 'labor-backlog', target: 0, unit: 'task' };
  if (pressure.kind === 'seed-shortage') return { metric: 'seed-stock', itemId: 'milletSeed', target: Number(pressure.evidence?.target ?? 0), unit: 'item' };
  if (pressure.kind === 'soil-degradation') return { metric: 'poor-fields', target: 0, unit: 'field' };
  return { metric: pressure.kind, target: 0, unit: 'state' };
}

function readRuntimeContext(getRuntime) {
  const runtime = getRuntime?.() ?? {};
  const safe = (reader) => { try { return reader() ?? null; } catch { return null; } };
  return {
    farm: safe(() => runtime.farmSystem?.getSummary?.()),
    weather: safe(() => runtime.weatherSystem?.get?.()),
    season: safe(() => runtime.seasonSystem?.get?.()),
  };
}

export function createWorldDynamicsSystem({ eventBus = null, gameTime, getRuntime = () => globalThis.shengling } = {}) {
  if (!gameTime?.stamp) throw new Error('世界动力系统缺少世界时间。');
  const activePressures = new Map();
  const pressureHistory = [];
  const activeOpportunities = new Map();
  const opportunityHistory = [];
  const commitments = new Map();
  let evaluatedAt = null;

  const now = () => normalizeTime(gameTime.stamp());
  const emit = (name, payload) => eventBus?.emit?.(name, { ...copy(payload), time: now() });
  const activeCommitmentFor = (signature) => [...commitments.values()]
    .find((entry) => entry.sourceSignature === signature && entry.state === 'active') ?? null;

  function updatePressures(candidates, time) {
    const signatures = new Set(candidates.map((entry) => entry.signature));
    const resolved = [];
    [...activePressures.entries()].forEach(([signature, pressure]) => {
      if (signatures.has(signature)) return;
      const next = { ...pressure, state: 'resolved', resolvedAt: copy(time), updatedAt: copy(time) };
      activePressures.delete(signature);
      pressureHistory.push(next);
      resolved.push(next);
      emit('world-dynamics:pressure-resolved', { pressure: next });
    });
    const opened = [];
    const updated = [];
    candidates.forEach((candidate) => {
      const previous = activePressures.get(candidate.signature);
      const persistenceDays = previous && dayKey(previous.updatedAt) !== dayKey(time)
        ? previous.persistenceDays + 1 : previous?.persistenceDays ?? 1;
      const next = {
        id: previous?.id ?? recordId('pressure', candidate.signature, time),
        ...copy(candidate), state: 'active',
        severity: round(clamp(candidate.baseSeverity + Math.min(0.25, Math.max(0, persistenceDays - 1) * 0.05))),
        baseSeverity: round(candidate.baseSeverity), persistenceDays,
        openedAt: copy(previous?.openedAt ?? time), updatedAt: copy(time),
      };
      activePressures.set(candidate.signature, next);
      if (previous) updated.push(next);
      else { opened.push(next); emit('world-dynamics:pressure-opened', { pressure: next }); }
    });
    return { opened, updated, resolved };
  }

  function updateOpportunities(candidates, time) {
    const signatures = new Set(candidates.map((entry) => entry.signature));
    const expired = [];
    [...activeOpportunities.entries()].forEach(([signature, opportunity]) => {
      if (signatures.has(signature)) return;
      const next = { ...opportunity, state: 'expired', expiredAt: copy(time), updatedAt: copy(time) };
      activeOpportunities.delete(signature);
      opportunityHistory.push(next);
      expired.push(next);
      emit('world-dynamics:opportunity-expired', { opportunity: next });
    });
    const opened = [];
    const updated = [];
    candidates.forEach((candidate) => {
      const previous = activeOpportunities.get(candidate.signature);
      const persistenceDays = previous && dayKey(previous.updatedAt) !== dayKey(time)
        ? previous.persistenceDays + 1 : previous?.persistenceDays ?? 1;
      const next = {
        id: previous?.id ?? recordId('opportunity', candidate.signature, time),
        ...copy(candidate), state: 'active', value: round(clamp(candidate.value)), persistenceDays,
        openedAt: copy(previous?.openedAt ?? time), updatedAt: copy(time),
      };
      activeOpportunities.set(candidate.signature, next);
      if (previous) updated.push(next);
      else { opened.push(next); emit('world-dynamics:opportunity-opened', { opportunity: next }); }
    });
    return { opened, updated, expired };
  }

  function updateCommitments(pressureChanges, time) {
    const created = [];
    const completed = [];
    pressureChanges.resolved.forEach((pressure) => {
      const existing = activeCommitmentFor(pressure.signature);
      if (!existing) return;
      const next = { ...existing, state: 'completed', progress: 1, currentSeverity: 0, updatedAt: copy(time), completedAt: copy(time) };
      commitments.set(next.id, next);
      completed.push(next);
      emit('world-dynamics:commitment-completed', { commitment: next, pressure });
    });
    activePressures.forEach((pressure) => {
      const existing = activeCommitmentFor(pressure.signature);
      if (existing) {
        commitments.set(existing.id, {
          ...existing, currentSeverity: pressure.severity, priority: Math.round(pressure.severity * 100),
          progress: round(clamp(1 - pressure.severity / Math.max(0.001, existing.initialSeverity))), updatedAt: copy(time),
        });
        return;
      }
      const urgent = pressure.kind === 'survival-denial' && pressure.severity >= 0.7;
      if (!urgent && (pressure.persistenceDays < 2 || pressure.severity < 0.55)) return;
      const type = pressure.suggestedResponses?.[0] ?? `resolve-${pressure.kind}`;
      const commitment = {
        id: recordId('commitment', `${type}:${pressure.signature}`, time),
        type, domain: pressure.domain, sourcePressureId: pressure.id, sourceSignature: pressure.signature,
        state: 'active', priority: Math.round(pressure.severity * 100), goal: commitmentGoal(pressure),
        progress: 0, initialSeverity: pressure.severity, currentSeverity: pressure.severity,
        createdAt: copy(time), updatedAt: copy(time), completedAt: null,
      };
      commitments.set(commitment.id, commitment);
      created.push(commitment);
      emit('world-dynamics:commitment-created', { commitment, pressure });
    });
    return { created, completed };
  }

  function evaluate(report = {}, context = readRuntimeContext(getRuntime)) {
    const time = reportTime(report, gameTime.stamp());
    const pressureChanges = updatePressures(pressureCandidates(report, context), time);
    const opportunityChanges = updateOpportunities(opportunityCandidates(report, context), time);
    const commitmentChanges = updateCommitments(pressureChanges, time);
    evaluatedAt = copy(time);
    const result = { evaluatedAt: copy(time), pressureChanges, opportunityChanges, commitmentChanges, summary: getSummary() };
    emit('world-dynamics:evaluated', result);
    return copy(result);
  }

  function getSummary() {
    const pressures = [...activePressures.values()];
    const opportunities = [...activeOpportunities.values()];
    const activeCommitments = [...commitments.values()].filter((entry) => entry.state === 'active');
    const dominantPressure = pressures.slice().sort((a, b) => b.severity - a.severity || a.id.localeCompare(b.id))[0] ?? null;
    const bestOpportunity = opportunities.slice().sort((a, b) => b.value - a.value || a.id.localeCompare(b.id))[0] ?? null;
    return {
      schemaVersion: WORLD_DYNAMICS_SCHEMA_VERSION, evaluatedAt: evaluatedAt ? copy(evaluatedAt) : null,
      activePressures: pressures.length, activeOpportunities: opportunities.length, activeCommitments: activeCommitments.length,
      dominantPressure: dominantPressure ? copy(dominantPressure) : null,
      bestOpportunity: bestOpportunity ? copy(bestOpportunity) : null,
    };
  }

  const listPressures = ({ state = 'all' } = {}) => {
    const active = [...activePressures.values()];
    return (state === 'active' ? active : state === 'resolved' ? pressureHistory : [...pressureHistory, ...active]).map(copy);
  };
  const listOpportunities = ({ state = 'all' } = {}) => {
    const active = [...activeOpportunities.values()];
    return (state === 'active' ? active : state === 'expired' ? opportunityHistory : [...opportunityHistory, ...active]).map(copy);
  };
  const listCommitments = ({ state = 'all' } = {}) => [...commitments.values()]
    .filter((entry) => state === 'all' || entry.state === state).map(copy);

  function verify() {
    const issues = [];
    const pressureIds = new Set();
    [...activePressures.values(), ...pressureHistory].forEach((pressure) => {
      if (pressureIds.has(pressure.id)) issues.push({ type: 'duplicate-pressure-id', id: pressure.id });
      pressureIds.add(pressure.id);
      if (pressure.severity < 0 || pressure.severity > 1) issues.push({ type: 'invalid-pressure-severity', id: pressure.id, severity: pressure.severity });
      if (pressure.persistenceDays < 1) issues.push({ type: 'invalid-pressure-persistence', id: pressure.id, persistenceDays: pressure.persistenceDays });
    });
    [...activeOpportunities.values(), ...opportunityHistory].forEach((opportunity) => {
      if (opportunity.value < 0 || opportunity.value > 1) issues.push({ type: 'invalid-opportunity-value', id: opportunity.id, value: opportunity.value });
    });
    commitments.forEach((commitment) => {
      if (!['active', 'completed', 'cancelled', 'failed'].includes(commitment.state)) issues.push({ type: 'invalid-commitment-state', id: commitment.id, state: commitment.state });
      if (commitment.progress < 0 || commitment.progress > 1) issues.push({ type: 'invalid-commitment-progress', id: commitment.id, progress: commitment.progress });
    });
    return {
      ok: issues.length === 0, issues,
      pressures: activePressures.size + pressureHistory.length,
      opportunities: activeOpportunities.size + opportunityHistory.length,
      commitments: commitments.size,
    };
  }

  function exportState() {
    return {
      schemaVersion: WORLD_DYNAMICS_SCHEMA_VERSION, evaluatedAt: evaluatedAt ? copy(evaluatedAt) : null,
      activePressures: [...activePressures.values()].map(copy), pressureHistory: pressureHistory.map(copy),
      activeOpportunities: [...activeOpportunities.values()].map(copy), opportunityHistory: opportunityHistory.map(copy),
      commitments: [...commitments.values()].map(copy),
    };
  }

  function importState(snapshot) {
    if (snapshot?.schemaVersion !== WORLD_DYNAMICS_SCHEMA_VERSION) throw new Error('世界动力存档格式不兼容。');
    ['activePressures', 'pressureHistory', 'activeOpportunities', 'opportunityHistory', 'commitments'].forEach((key) => {
      if (!Array.isArray(snapshot[key])) throw new Error(`世界动力存档缺少 ${key}。`);
    });
    activePressures.clear(); snapshot.activePressures.forEach((entry) => activePressures.set(entry.signature, copy(entry)));
    pressureHistory.splice(0, pressureHistory.length, ...snapshot.pressureHistory.map(copy));
    activeOpportunities.clear(); snapshot.activeOpportunities.forEach((entry) => activeOpportunities.set(entry.signature, copy(entry)));
    opportunityHistory.splice(0, opportunityHistory.length, ...snapshot.opportunityHistory.map(copy));
    commitments.clear(); snapshot.commitments.forEach((entry) => commitments.set(entry.id, copy(entry)));
    evaluatedAt = snapshot.evaluatedAt ? normalizeTime(snapshot.evaluatedAt) : null;
    const result = verify();
    if (!result.ok) throw new Error(`世界动力存档校验失败：${result.issues[0]?.type ?? 'unknown'}`);
    emit('world-dynamics:hydrated', { summary: getSummary() });
    return exportState();
  }

  function reset() {
    activePressures.clear(); pressureHistory.splice(0); activeOpportunities.clear(); opportunityHistory.splice(0); commitments.clear(); evaluatedAt = null;
    emit('world-dynamics:reset', { summary: getSummary() });
    return exportState();
  }

  return Object.freeze({
    observe: (eventName, payload = {}) => eventName === 'daily-economy:finalized' && payload.report ? evaluate(payload.report) : null,
    evaluate, listPressures, listOpportunities, listCommitments, getSummary, verify,
    exportState, importState, reset, createCheckpoint: exportState, restoreCheckpoint: importState,
  });
}
