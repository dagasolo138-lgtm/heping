import { WORLD_SAVE_SCHEMA_VERSION } from './worldSaveSchema.js';

function clone(value) {
  return structuredClone(value);
}

export function migrateWorldSave(rawSnapshot) {
  if (!rawSnapshot || typeof rawSnapshot !== 'object') throw new Error('世界存档为空或格式无效。');
  const snapshot = clone(rawSnapshot);
  const version = Number(snapshot.schemaVersion ?? 0);
  if (version !== WORLD_SAVE_SCHEMA_VERSION) throw new Error(`世界存档版本不兼容：${version}`);
  if (!snapshot.systems || typeof snapshot.systems !== 'object') throw new Error('世界存档缺少系统状态。');
  return snapshot;
}
