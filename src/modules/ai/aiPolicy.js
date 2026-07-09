export const AI_POLICY_VERSION = 1;

export const AI_ALLOWED_TASKS = Object.freeze({
  biography: 'biography',
  chroniclePolish: 'chroniclePolish',
  memoryAnswer: 'memoryAnswer',
});

export const AI_READ_POLICY = Object.freeze({
  biography: ['person.identity', 'person.family', 'person.traits', 'person.work', 'person.memories.lifeEvents', 'person.memories.personal:selected', 'person.relations'],
  chroniclePolish: ['chronicle.locked', 'chronicle.entries', 'chronicle.factsDigest'],
  memoryAnswer: ['person.memories.personal', 'person.memories.lifeEvents', 'person.relations', 'lockedChronicles:public'],
});

export const AI_WRITE_POLICY = Object.freeze({
  allowed: ['presentation.llmText', 'dialogueTranscript', 'usedFactIds', 'warnings'],
  forbidden: ['people', 'relations', 'camp', 'map', 'buildings', 'farms', 'roads', 'ecology', 'actions', 'planner', 'futureEvents'],
});

export function getAiPolicy() {
  return Object.freeze({
    schemaVersion: AI_POLICY_VERSION,
    allowedTasks: Object.values(AI_ALLOWED_TASKS),
    reads: AI_READ_POLICY,
    writes: AI_WRITE_POLICY,
    rules: [
      '只能解释 factPack 中已经出现的事实。',
      '不能决定人物下一步行动。',
      '不能创造、改写或删除世界状态。',
      '不能读取未传播给该人物的私密记忆。',
      '输出必须携带 usedFactIds；不知道时应明确说不知道。',
    ],
  });
}

export function assertAllowedTask(task) {
  if (!Object.values(AI_ALLOWED_TASKS).includes(task)) throw new Error(`不允许的 AI 解释任务：${task}`);
}
