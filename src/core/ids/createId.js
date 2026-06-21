let sequence = 0;

export function createId(prefix = 'id') {
  sequence += 1;
  const entropy = globalThis.crypto?.randomUUID?.().replaceAll('-', '').slice(0, 10)
    ?? Math.random().toString(36).slice(2, 12);
  return `${prefix}_${entropy}_${sequence.toString(36)}`;
}
