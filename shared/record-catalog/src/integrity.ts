import { createHash } from 'node:crypto';
import type { CatalogSignature } from '../../contracts/src/identity.ts';

/** Canonical JSON: object keys sorted, arrays retain domain-defined order. */
export function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== 'object') {
    if (typeof value === 'number' && !Number.isFinite(value)) throw new TypeError('Non-finite catalog value');
    const encoded = JSON.stringify(value);
    if (encoded === undefined) throw new TypeError('Catalog must contain only JSON values');
    return encoded;
  }
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJson((value as Record<string, unknown>)[key])}`).join(',')}}`;
}
export function contentSignature(data: object): CatalogSignature {
  const { signature: _signature, ...payload } = data as Record<string, unknown>;
  return `sha256:${createHash('sha256').update(canonicalJson(payload)).digest('hex')}` as CatalogSignature;
}
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
