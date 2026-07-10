export const WORLD_SAVE_SCHEMA_VERSION = 1;
export const WORLD_SAVE_APP_VERSION = '0.25.3.1';
export const WORLD_SAVE_DEFAULT_SLOT = 'manual';
export const WORLD_SAVE_STORAGE_PREFIX = 'shengling.save';

export function slotKey(slot = WORLD_SAVE_DEFAULT_SLOT) {
  return `${WORLD_SAVE_STORAGE_PREFIX}.${slot}.v${WORLD_SAVE_SCHEMA_VERSION}`;
}
