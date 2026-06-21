import { PEOPLE_SCHEMA_VERSION } from './personSchema.js';
import { SKILL_KEYS } from '../../data/constants/skills.js';

const NEED_KEYS = ['hunger', 'thirst', 'energy', 'health', 'stress'];

function fail(message) {
  throw new Error(`[PeopleSystem] ${message}`);
}

export function validatePerson(person) {
  if (!person || typeof person !== 'object') fail('人物必须是对象。');
  if (person.schemaVersion !== PEOPLE_SCHEMA_VERSION) fail(`不支持的人物数据版本：${person.schemaVersion}`);
  if (!person.id || !person.identity?.name) fail('人物必须拥有 id 与姓名。');
  if (!Number.isInteger(person.revision) || person.revision < 1) fail(`${person.identity.name} 的 revision 无效。`);
  if (!person.identity.birth || !Number.isFinite(person.identity.birth.year)) fail(`${person.identity.name} 的出生日期无效。`);
  if (!person.work?.skills) fail(`${person.identity.name} 缺少技能组。`);
  SKILL_KEYS.forEach((key) => {
    if (!Number.isFinite(person.work.skills[key])) fail(`${person.identity.name} 的技能 ${key} 无效。`);
  });
  NEED_KEYS.forEach((key) => {
    const value = person.state?.[key];
    if (!Number.isFinite(value) || value < 0 || value > 100) fail(`${person.identity.name} 的状态 ${key} 应为 0–100。`);
  });
  if (!Array.isArray(person.memories?.lifeEvents)) fail(`${person.identity.name} 的人生事实必须是数组。`);
  if (!person.relations || typeof person.relations !== 'object') fail(`${person.identity.name} 缺少关系表。`);
  return true;
}
