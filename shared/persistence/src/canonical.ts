import { createHash } from 'node:crypto';

/** Strict JSON, recursively sorted object keys. Rejects lossy JS encodings. */
export function canonicalJson(value: unknown): string {
  const parents = new Set<object>();
  function encode(current: unknown): string {
    if (current === null || typeof current === 'boolean' || typeof current === 'string') return JSON.stringify(current);
    if (typeof current === 'number' && Number.isFinite(current)) return JSON.stringify(current);
    if (typeof current !== 'object' || current === null) throw new TypeError('Persistence: expected finite JSON data');
    if (parents.has(current)) throw new TypeError('Persistence: cyclic JSON data');
    parents.add(current);
    try {
      if (Array.isArray(current)) {
        if (Object.keys(current).length !== current.length || Object.getOwnPropertySymbols(current).length) {
          throw new TypeError('Persistence: sparse or extended array');
        }
        const entries: string[] = [];
        for (let i = 0; i < current.length; i++) {
          const descriptor = Object.getOwnPropertyDescriptor(current, String(i));
          if (!descriptor || !('value' in descriptor)) throw new TypeError('Persistence: JSON array getters are not supported');
          entries.push(encode(descriptor.value));
        }
        return `[${entries.join(',')}]`;
      }
      if (Object.getPrototypeOf(current) !== Object.prototype && Object.getPrototypeOf(current) !== null) {
        throw new TypeError('Persistence: expected plain JSON object');
      }
      if (Object.getOwnPropertySymbols(current).length) throw new TypeError('Persistence: symbol keys are not JSON');
      return `{${Object.keys(current).sort().map(key => {
        const descriptor = Object.getOwnPropertyDescriptor(current, key)!;
        if (!('value' in descriptor)) throw new TypeError('Persistence: JSON getters are not supported');
        return `${JSON.stringify(key)}:${encode(descriptor.value)}`;
      }).join(',')}}`;
    } finally { parents.delete(current); }
  }
  return encode(value);
}

export function sha256(text: string): string { return createHash('sha256').update(text, 'utf8').digest('hex'); }

export function freezeJson<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) freezeJson(child);
    Object.freeze(value);
  }
  return value;
}
