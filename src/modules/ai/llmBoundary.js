import { AI_ALLOWED_TASKS, AI_POLICY_VERSION, assertAllowedTask, getAiPolicy } from './aiPolicy.js';
import { buildBiographyFactPack, buildChronicleFactPack, buildMemoryQuestionFactPack, listFactIds } from './factPackBuilder.js';

function clone(value) {
  return structuredClone(value);
}

function taskInstruction(task) {
  if (task === AI_ALLOWED_TASKS.biography) return '请基于 factPack 为人物写一段传记润色稿。';
  if (task === AI_ALLOWED_TASKS.chroniclePolish) return '请基于 factPack 为已锁定聚落纪事润色文字。';
  if (task === AI_ALLOWED_TASKS.memoryAnswer) return '请扮演该人物，只根据其已知记忆回答玩家问题。';
  return '请解释 factPack 中已有事实。';
}

function outputSchema(task) {
  return {
    task,
    text: 'string',
    usedFactIds: ['factId'],
    warnings: ['string'],
  };
}

export function preparePrompt(factPack) {
  assertAllowedTask(factPack?.task);
  return [
    '你是《生灵》的只读解释层，不是决策层。',
    '硬性约束：不得编造 factPack 中不存在的人物、事件、地点、物品或结果；不得返回世界状态修改；不得决定人物下一步行动。',
    '如果 factPack 不足以回答，请明确说“不知道”或“没有足够事实”。',
    taskInstruction(factPack.task),
    '输出 JSON，格式如下：',
    JSON.stringify(outputSchema(factPack.task), null, 2),
    'factPack:',
    JSON.stringify(factPack, null, 2),
  ].join('\n\n');
}

export function validateExplanationOutput({ factPack, output }) {
  assertAllowedTask(factPack?.task);
  if (!output || typeof output !== 'object') return { ok: false, errors: ['输出必须是对象。'] };
  const errors = [];
  if (typeof output.text !== 'string' || !output.text.trim()) errors.push('输出缺少 text。');
  if (!Array.isArray(output.usedFactIds)) errors.push('输出缺少 usedFactIds。');
  const allowed = new Set(listFactIds(factPack));
  if (Array.isArray(output.usedFactIds)) {
    output.usedFactIds.forEach((factId) => {
      if (!allowed.has(factId)) errors.push(`usedFactIds 包含 factPack 之外的事实：${factId}`);
    });
  }
  if (output.statePatch || output.worldPatch || output.actions || output.nextAction) errors.push('输出不能包含世界状态或行动决策 patch。');
  return { ok: errors.length === 0, errors };
}

export function createLlmBoundary({ peopleSystem, chronicleSystem = null } = {}) {
  function biographyPack(personId) {
    const person = peopleSystem.get(personId);
    if (!person) throw new Error(`找不到人物：${personId}`);
    return buildBiographyFactPack({ person });
  }

  function chroniclePack(chronicleId) {
    const chronicle = chronicleSystem?.listChronicles?.().find((entry) => entry.id === chronicleId);
    if (!chronicle) throw new Error(`找不到纪事：${chronicleId}`);
    return buildChronicleFactPack({ chronicle });
  }

  function memoryQuestionPack({ personId, question }) {
    const person = peopleSystem.get(personId);
    if (!person) throw new Error(`找不到人物：${personId}`);
    return buildMemoryQuestionFactPack({ person, question, chronicles: chronicleSystem?.listChronicles?.() ?? [] });
  }

  function promptForFactPack(factPack) {
    return preparePrompt(clone(factPack));
  }

  return Object.freeze({
    schemaVersion: AI_POLICY_VERSION,
    getPolicy: getAiPolicy,
    buildBiographyFactPack: biographyPack,
    buildChronicleFactPack: chroniclePack,
    buildMemoryQuestionFactPack: memoryQuestionPack,
    preparePrompt: promptForFactPack,
    validateExplanationOutput,
  });
}
