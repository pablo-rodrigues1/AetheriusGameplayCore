import { createHash } from 'node:crypto';
import type { CatalogSignature } from '../../contracts/src/identity.ts';
import type { CatalogRecord, PluginFingerprint } from './types.ts';

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
/** Only this definition and its defining file participate, never domain metadata,
 * sibling records, export epoch or other dependency fingerprints. */
export function recordSignature(record: Omit<CatalogRecord, 'signature'>, defining: PluginFingerprint): CatalogSignature {
  return contentSignature({
    record: {
      stableFormKey: record.stableFormKey, recordType: record.recordType,
      definingPlugin: record.definingPlugin.toLowerCase(), pluginKind: record.pluginKind,
      winnerPlugin: record.winnerPlugin.toLowerCase(), data: record.data
    },
    definingPlugin: { size: defining.size, crc32: defining.crc32, isLight: defining.isLight }
  });
}
export function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    for (const child of Object.values(value)) deepFreeze(child);
    Object.freeze(value);
  }
  return value;
}
