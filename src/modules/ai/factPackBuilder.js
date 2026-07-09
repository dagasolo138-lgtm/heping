import { AI_ALLOWED_TASKS, AI_POLICY_VERSION, assertAllowedTask, getAiPolicy } from './aiPolicy.js';

const MAX_LIFE_EVENTS = 12;
const MAX_PERSONAL_MEMORIES = 12;
const MAX_CHRONICLE_ENTRIES = 8;

function clone(value) {
  return structuredClone(value);
}

function compactTime(time) {
  if (!time) return null;
  return {
    year: time.year,
    day: time.day,
    minute: time.minute,
    tick: time.tick,
    label: time.label,
  };
}

function memoryFact(memory, prefix) {
  return {
    factId: memory.id ?? `${prefix}:${memory.time?.tick ?? 'unknown'}`,
    source: prefix,
    type: memory.type,
    scope: memory.scope,
    summary: memory.summary,
    time: compactTime(memory.time),
    relatedPersonIds: clone(memory.relatedPersonIds ?? []),
    relatedEntityIds: clone(memory.relatedEntityIds ?? []),
    details: clone(memory.details ?? {}),
  };
}

function relationFacts(person) {
  return Object.entries(person.relations ?? {}).map(([otherId, relation]) => ({
    factId: `relation:${person.id}:${otherId}`,
    source: 'relation',
    otherId,
    familiarity: relation.familiarity ?? 0,
    affinity: relation.affinity ?? 0,
    trust: relation.trust ?? 0,
    tags: clone(relation.tags ?? []),
  }));
}

function personIdentityFact(person) {
  return {
    factId: `person:${person.id}:identity`,
    source: 'identity',
    personId: person.id,
    name: person.identity?.name,
    gender: person.identity?.gender,
    birth: clone(person.identity?.birth ?? null),
    alive: Boolean(person.identity?.alive),
    death: clone(person.identity?.death ?? null),
    traits: clone(person.traits ?? []),
    family: clone(person.family ?? {}),
    work: clone(person.work ?? {}),
  };
}

function chronicleFacts(chronicle) {
  return (chronicle.entries ?? []).slice(0, MAX_CHRONICLE_ENTRIES).map((entry, index) => ({
    factId: `${chronicle.id}:entry:${index}`,
    source: 'chronicleEntry',
    chronicleId: chronicle.id,
    type: entry.type,
    text: entry.text,
    time: compactTime(entry.time),
    facts: clone(entry.facts ?? {}),
    sourceEventIds: clone(entry.sourceEventIds ?? []),
  }));
}

function lockedChronicleSummary(chronicle) {
  return {
    factId: `chronicle:${chronicle.id}:summary`,
    source: 'chronicle',
    chronicleId: chronicle.id,
    title: chronicle.title,
    summary: chronicle.summary,
    period: clone(chronicle.period ?? null),
    createdAt: compactTime(chronicle.createdAt),
    factsDigest: clone(chronicle.factsDigest ?? {}),
    locked: chronicle.locked === true,
  };
}

function packBase({ task, subjectId = null, question = null }) {
  assertAllowedTask(task);
  return {
    schemaVersion: AI_POLICY_VERSION,
    task,
    subjectId,
    question,
    createdAt: new Date().toISOString(),
    policy: getAiPolicy(),
    facts: [],
    forbidden: {
      inventFacts: true,
      alterFacts: true,
      writeWorldState: true,
      decideActions: true,
    },
  };
}

export function buildBiographyFactPack({ person }) {
  if (!person?.id) throw new Error('人物传记 fact pack 需要有效人物。');
  const pack = packBase({ task: AI_ALLOWED_TASKS.biography, subjectId: person.id });
  pack.facts.push(personIdentityFact(person));
  pack.facts.push(...relationFacts(person));
  pack.facts.push(...(person.memories?.lifeEvents ?? []).slice(-MAX_LIFE_EVENTS).map((memory) => memoryFact(memory, 'lifeEvent')));
  pack.facts.push(...(person.memories?.personal ?? []).slice(-MAX_PERSONAL_MEMORIES).map((memory) => memoryFact(memory, 'personalMemory')));
  return pack;
}

export function buildChronicleFactPack({ chronicle }) {
  if (!chronicle?.id || chronicle.locked !== true) throw new Error('史书润色 fact pack 只能使用已锁定纪事。');
  const pack = packBase({ task: AI_ALLOWED_TASKS.chroniclePolish, subjectId: chronicle.id });
  pack.facts.push(lockedChronicleSummary(chronicle));
  pack.facts.push(...chronicleFacts(chronicle));
  return pack;
}

export function buildMemoryQuestionFactPack({ person, question, chronicles = [] }) {
  if (!person?.id) throw new Error('人物问答 fact pack 需要有效人物。');
  if (!question?.trim()) throw new Error('人物问答 fact pack 需要问题。');
  const pack = packBase({ task: AI_ALLOWED_TASKS.memoryAnswer, subjectId: person.id, question: question.trim() });
  pack.facts.push(personIdentityFact(person));
  pack.facts.push(...relationFacts(person));
  pack.facts.push(...(person.memories?.lifeEvents ?? []).slice(-MAX_LIFE_EVENTS).map((memory) => memoryFact(memory, 'lifeEvent')));
  pack.facts.push(...(person.memories?.personal ?? []).slice(-MAX_PERSONAL_MEMORIES).map((memory) => memoryFact(memory, 'knownMemory')));
  pack.facts.push(...chronicles.filter((entry) => entry.locked === true).slice(0, 4).map(lockedChronicleSummary));
  return pack;
}

export function listFactIds(factPack) {
  return [...new Set((factPack?.facts ?? []).map((fact) => fact.factId).filter(Boolean))];
}
