import { hashSeed } from '../random/seededRandom.js';

let sequence = 0;
let namespaceSeed = 'shengling-world-v1';

export function resetIdSequence(seed = 'shengling-world-v1') {
  sequence = 0;
  namespaceSeed = String(seed || 'shengling-world-v1');
}

export function createId(prefix = 'id') {
  sequence += 1;
  const entropy = hashSeed(`${namespaceSeed}:${prefix}:${sequence}`).toString(36).padStart(7, '0');
  return `${prefix}_${entropy}_${sequence.toString(36)}`;
}
