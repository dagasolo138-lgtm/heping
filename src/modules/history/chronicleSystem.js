export const CHRONICLE_SCHEMA_VERSION = 1;

const PERIOD_DAYS = 10;
const MAX_FACTS = 240;
const MAX_CHRONICLES = 80;

function clone(value) {
  return structuredClone(value);
}

function periodIndexFor(day) {
  return Math.floor((Math.max(1, Number(day ?? 1)) - 1) / PERIOD_DAYS);
}

function periodBounds(year, periodIndex) {
  const startDay = periodIndex * PERIOD_DAYS + 1;
  return {
    type: 'tenDay',
    start: { year, day: startDay, minute: 0, tick: null },
    end: { year, day: startDay + PERIOD_DAYS - 1, minute: 1439, tick: null },
  };
}

function timeKey(time) {
  return Number(time?.tick ?? 0);
}

function factText(fact) {
  if (fact.type === 'building:completed') return `${fact.label ?? '一座建筑'}建成，聚落获得了新的长期设施。`;
  if (fact.type === 'farm:harvested') return `${fact.fieldLabel ?? '农田'}完成收获，营地获得了${fact.amount ?? '若干'}份${fact.itemLabel ?? '粮食'}。`;
  if (fact.type === 'farm:matured') return `${fact.fieldLabel ?? '农田'}成熟，村民可以准备收获。`;
  if (fact.type === 'resource:denied') return `${fact.actorName ?? '有人'}请求${fact.itemLabel ?? fact.itemId ?? '资源'}未果，营地稀缺压力上升。`;
  if (fact.type === 'camp:rule-changed') return `营地${fact.ruleKey ?? '规则'}从“${fact.from ?? '无'}”改为“${fact.to ?? fact.ruleId ?? '新规则'}”。`;
  if (fact.type === 'social:event') return fact.summary ?? '营地中发生了一件被人记住的事。';
  return fact.summary ?? '聚落留下了一条事实记录。';
}

function titleFor(period, facts) {
  if (period.type === 'majorEvent') return facts[0]?.title ?? '聚落大事记';
  const start = period.start?.day ?? 1;
  const end = period.end?.day ?? start;
  return `生灵历${period.start?.year ?? 1}年第${start}-${end}日纪`;
}

function summaryFor(facts) {
  const digest = digestFacts(facts);
  const parts = [];
  if (digest.buildingsCompleted) parts.push(`建成建筑 ${digest.buildingsCompleted} 座`);
  if (digest.harvests) parts.push(`完成收获 ${digest.harvests} 次`);
  if (digest.ruleChanges) parts.push(`调整规则 ${digest.ruleChanges} 次`);
  if (digest.resourceCrises) parts.push(`出现资源拒绝 ${digest.resourceCrises} 次`);
  if (digest.socialEvents) parts.push(`形成共同记忆 ${digest.socialEvents} 件`);
  return parts.length ? parts.join('，') + '。' : '这一段时间没有足以入史的大事。';
}

function digestFacts(facts) {
  return {
    buildingsCompleted: facts.filter((fact) => fact.type === 'building:completed').length,
    harvests: facts.filter((fact) => fact.type === 'farm:harvested').length,
    matureFields: facts.filter((fact) => fact.type === 'farm:matured').length,
    ruleChanges: facts.filter((fact) => fact.type === 'camp:rule-changed').length,
    resourceCrises: facts.filter((fact) => fact.type === 'resource:denied').length,
    socialEvents: facts.filter((fact) => fact.type === 'social:event').length,
  };
}

function importanceForFact(fact) {
  if (fact.type === 'building:completed') return 0.9;
  if (fact.type === 'camp:rule-changed') return 0.85;
  if (fact.type === 'resource:denied') return 0.75;
  if (fact.type === 'farm:harvested') return 0.72;
  if (fact.type === 'farm:matured') return 0.45;
  return Math.min(0.7, 0.25 + Number(fact.severity ?? 1) * 0.08);
}

function itemLabel(itemId) {
  return ({ berries: '浆果', millet: '粟米', water: '清水', wood: '木柴' }[itemId] ?? itemId);
}

export function createChronicleSystem({ eventBus, gameTime, peopleSystem = null } = {}) {
  const facts = [];
  const chronicles = [];
  let lastClosedPeriodKey = null;

  function pushFact(input) {
    const time = clone(input.time ?? gameTime.stamp());
    const fact = {
      id: input.id ?? `fact-${time.tick}-${facts.length + 1}`,
      type: input.type,
      time,
      importance: Number(input.importance ?? importanceForFact(input)),
      sourceEventId: input.sourceEventId ?? null,
      sourceEventIds: clone(input.sourceEventIds ?? [input.sourceEventId].filter(Boolean)),
      ...clone(input),
      time,
    };
    facts.unshift(fact);
    facts.splice(MAX_FACTS);
    eventBus.emit('history:fact-recorded', { fact: clone(fact), time: gameTime.stamp() });
    return clone(fact);
  }

  function factsInPeriod(period) {
    const startDay = Number(period.start?.day ?? 1);
    const endDay = Number(period.end?.day ?? startDay);
    const year = Number(period.start?.year ?? 1);
    return facts
      .filter((fact) => Number(fact.time?.year ?? year) === year && Number(fact.time?.day ?? 0) >= startDay && Number(fact.time?.day ?? 0) <= endDay)
      .sort((a, b) => timeKey(a.time) - timeKey(b.time));
  }

  function hasChronicleForPeriod(period) {
    return chronicles.some((entry) => entry.period?.type === period.type
      && entry.period?.start?.year === period.start?.year
      && entry.period?.start?.day === period.start?.day
      && entry.period?.end?.day === period.end?.day);
  }

  function createChronicle({ period, selectedFacts, reason = 'period' }) {
    if (!selectedFacts.length && reason !== 'period') return null;
    const orderedFacts = selectedFacts
      .slice()
      .sort((a, b) => timeKey(a.time) - timeKey(b.time));
    const entry = {
      id: `chronicle-${gameTime.now().tick}-${chronicles.length + 1}`,
      schemaVersion: CHRONICLE_SCHEMA_VERSION,
      period: clone(period),
      createdAt: gameTime.stamp(),
      reason,
      title: titleFor(period, orderedFacts),
      summary: summaryFor(orderedFacts),
      entries: orderedFacts.slice(0, 8).map((fact) => ({
        type: fact.type,
        importance: fact.importance,
        time: clone(fact.time),
        text: factText(fact),
        facts: clone(fact),
        sourceEventIds: clone(fact.sourceEventIds ?? []),
      })),
      factsDigest: digestFacts(orderedFacts),
      locked: true,
    };
    chronicles.unshift(entry);
    chronicles.splice(MAX_CHRONICLES);
    eventBus.emit('history:chronicle-created', { chronicle: clone(entry), time: gameTime.stamp() });
    return clone(entry);
  }

  function maybeClosePeriod(time = gameTime.now()) {
    const currentIndex = periodIndexFor(time.day);
    if (currentIndex <= 0) return null;
    const closedIndex = currentIndex - 1;
    const key = `${time.year}:${closedIndex}`;
    if (lastClosedPeriodKey === key) return null;
    const period = periodBounds(time.year, closedIndex);
    if (hasChronicleForPeriod(period)) {
      lastClosedPeriodKey = key;
      return null;
    }
    lastClosedPeriodKey = key;
    const selected = factsInPeriod(period).filter((fact) => fact.importance >= 0.45);
    return createChronicle({ period, selectedFacts: selected, reason: 'period' });
  }

  function createMajorChronicle(fact) {
    const period = {
      type: 'majorEvent',
      start: clone(fact.time),
      end: clone(fact.time),
    };
    return createChronicle({ period, selectedFacts: [fact], reason: 'majorEvent' });
  }

  function exportState() {
    return {
      schemaVersion: CHRONICLE_SCHEMA_VERSION,
      exportedAt: gameTime.stamp(),
      lastClosedPeriodKey,
      facts: clone(facts),
      chronicles: clone(chronicles),
    };
  }

  function importState(snapshot) {
    if (snapshot === null || snapshot === undefined) return null;
    if (snapshot?.schemaVersion !== CHRONICLE_SCHEMA_VERSION) throw new Error('史书存档格式不兼容。');
    facts.splice(0, facts.length, ...(Array.isArray(snapshot.facts) ? clone(snapshot.facts).slice(0, MAX_FACTS) : []));
    chronicles.splice(0, chronicles.length, ...(Array.isArray(snapshot.chronicles) ? clone(snapshot.chronicles).slice(0, MAX_CHRONICLES) : []));
    lastClosedPeriodKey = snapshot.lastClosedPeriodKey ?? null;
    eventBus.emit('history:chronicles-hydrated', { count: chronicles.length, time: gameTime.stamp() });
    return exportState();
  }

  const offBuilding = eventBus.on('buildings:completed', ({ building }) => {
    const fact = pushFact({ type: 'building:completed', label: building?.label, buildingId: building?.id, typeId: building?.typeId, time: building?.completedAt ?? gameTime.stamp() });
    createMajorChronicle(fact);
  });
  const offFarm = eventBus.on('farms:harvested', ({ field, harvest, time }) => {
    pushFact({
      type: 'farm:harvested',
      fieldId: field?.id,
      fieldLabel: field?.label,
      itemId: harvest?.itemId,
      itemLabel: harvest?.label ?? itemLabel(harvest?.itemId),
      amount: harvest?.amount,
      time: time ?? gameTime.stamp(),
    });
  });
  const offMatured = eventBus.on('farms:matured', ({ field, time }) => {
    pushFact({ type: 'farm:matured', fieldId: field?.id, fieldLabel: field?.label, time: time ?? gameTime.stamp() });
  });
  const offDenied = eventBus.on('survival:resource-denied', (payload) => {
    const actor = peopleSystem?.get?.(payload.personId);
    const fact = pushFact({
      type: 'resource:denied',
      actorId: payload.personId,
      actorName: actor?.identity?.name,
      itemId: payload.itemId,
      itemLabel: itemLabel(payload.itemId),
      ruleId: payload.ruleId,
      ruleLabel: payload.ruleLabel,
      severity: 4,
      time: payload.time ?? gameTime.stamp(),
    });
    createMajorChronicle(fact);
  });
  const offRule = eventBus.on('camp:rule-changed', ({ entry, rule, time }) => {
    const fact = pushFact({
      type: 'camp:rule-changed',
      ruleKey: entry?.ruleKey,
      from: entry?.from,
      to: entry?.to ?? rule?.id,
      ruleId: rule?.id,
      severity: 4,
      time: time ?? gameTime.stamp(),
    });
    createMajorChronicle(fact);
  });
  const offSocial = eventBus.on('social:event-recorded', ({ event, time }) => {
    if (Number(event?.severity ?? 0) < 4) return;
    pushFact({ type: 'social:event', sourceEventId: event?.id, summary: event?.summary, severity: event?.severity, time: event?.time ?? time ?? gameTime.stamp() });
  });
  const offTime = eventBus.on('simulation:time', ({ time }) => maybeClosePeriod(time));

  return Object.freeze({
    recordFact: pushFact,
    maybeClosePeriod,
    listFacts: () => clone(facts),
    listChronicles: () => clone(chronicles),
    exportState,
    importState,
    stop() {
      offBuilding(); offFarm(); offMatured(); offDenied(); offRule(); offSocial(); offTime();
    },
  });
}
