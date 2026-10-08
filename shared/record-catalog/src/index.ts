import type { CatalogSignature, DefinitionRef, RuntimeFormId, StableFormKey } from '../../contracts/src/identity.ts';
import { parseStableFormKey, stableFormKeyParts } from '../../contracts/src/identity.ts';
import type { PortResult } from '../../contracts/src/capabilities.ts';
import type { CatalogEntry } from '../../contracts/src/ports.ts';
import { encodeFormKey } from './codecs.ts';
import { contentSignature, deepFreeze, recordSignature } from './integrity.ts';
import type { CatalogHost, DomainCatalog, DomainData, PluginFingerprint, ResolvedRecord } from './types.ts';
export * from './types.ts';
export * from './codecs.ts';
export { contentSignature, canonicalJson, recordSignature } from './integrity.ts';

/** All host calls are confined to this boot function. No caller-owned object is frozen. */
export function loadDomain(input: DomainData, host: CatalogHost): DomainCatalog {
  const data: DomainData = JSON.parse(JSON.stringify(input)) as DomainData;
  const issues: string[] = [];
  const byKey = new Map<StableFormKey, ResolvedRecord>();
  const byRuntime = new Map<RuntimeFormId, ResolvedRecord>();
  const fail = (reason: string): { readonly status: 'UNSUPPORTED'; readonly reason: string } =>
    Object.freeze({ status: 'UNSUPPORTED', reason });
  try {
    if (data.schemaVersion !== 1 || !['standing-stones', 'races'].includes(data.domain)) throw new TypeError('Invalid domain schema');
    if (contentSignature(data) !== data.signature) throw new TypeError('Catalog content signature mismatch');
    const dependencies = new Map(data.dependencies.map(p => [p.filename.toLowerCase(), p]));
    if (dependencies.size !== data.dependencies.length) throw new TypeError('Duplicate dependency');
    const active = new Map<string, PluginFingerprint>();
    const unavailable = new Map<string, string>();
    for (const plugin of host.plugins()) {
      const name = plugin.filename.toLowerCase();
      if (dependencies.has(name) && (active.has(name) || unavailable.has(name))) throw new TypeError(`Duplicate active plugin: ${plugin.filename}`);
      if ('status' in plugin) unavailable.set(name, plugin.reason);
      else active.set(name, plugin);
    }
    for (const expected of data.dependencies) {
      if (!Number.isSafeInteger(expected.size) || expected.size < 12 || !Number.isInteger(expected.crc32)
        || expected.crc32 !== (expected.crc32 | 0) || typeof expected.isLight !== 'boolean') {
        throw new TypeError(`Invalid plugin metadata: ${expected.filename}`);
      }
      const actual = active.get(expected.filename.toLowerCase());
      if (!actual) issues.push(unavailable.has(expected.filename.toLowerCase())
        ? `Plugin fingerprint unavailable: ${expected.filename}: ${unavailable.get(expected.filename.toLowerCase())}` : `Plugin absent: ${expected.filename}`);
      else if (actual.size !== expected.size || actual.crc32 !== expected.crc32 || actual.isLight !== expected.isLight) {
        issues.push(`Plugin signature/kind mismatch: ${expected.filename}`);
      }
    }
    // A name-to-id mapping alone can succeed for records absent from the plugin.
    if (issues.length === 0) for (const record of data.records) {
      try {
        if (parseStableFormKey(record.stableFormKey, record.pluginKind) !== record.stableFormKey) throw new TypeError('Noncanonical key');
        const parts = stableFormKeyParts(record.stableFormKey, record.pluginKind);
        const defining = dependencies.get(parts.plugin);
        if (!defining || defining.filename.toLowerCase() !== record.definingPlugin.toLowerCase()
          || defining.isLight !== (record.pluginKind === 'LIGHT') || !dependencies.has(record.winnerPlugin.toLowerCase())) {
          throw new TypeError('Missing/inconsistent definition or winner dependency');
        }
        if (byKey.has(record.stableFormKey)) throw new TypeError('Duplicate record');
        if (recordSignature(record, defining) !== record.signature) throw new TypeError('Record content signature mismatch');
        const id = host.getIdFromDesc(encodeFormKey(record.stableFormKey, 'skymp', record.pluginKind, defining.filename));
        if (!Number.isSafeInteger(id) || id < 1 || id > 2 ** 32 - 1 || Math.floor(id / 2 ** 24) === 255) {
          throw new TypeError('Invalid/static record id required');
        }
        if ((Math.floor(id / 2 ** 24) === 254) !== (record.pluginKind === 'LIGHT')) {
          throw new TypeError('Runtime record namespace disagrees with plugin kind');
        }
        if (host.lookupEspmRecordById(id).type !== record.recordType) throw new TypeError('Record absent or type differs');
        const runtimeFormId = id as RuntimeFormId;
        if (byRuntime.has(runtimeFormId)) throw new TypeError('Runtime resolution collision');
        const resolved: ResolvedRecord = deepFreeze({
          definition: { stableFormKey: record.stableFormKey, recordType: record.recordType, catalogSignature: record.signature },
          pluginKind: record.pluginKind, winnerPlugin: record.winnerPlugin, data: record.data, runtimeFormId
        });
        byKey.set(record.stableFormKey, resolved);
        byRuntime.set(runtimeFormId, resolved);
      } catch (error) { issues.push(`${record.stableFormKey}: ${error instanceof Error ? error.message : String(error)}`); }
    }
    for (const key of data.roots) if (!byKey.has(key) && issues.length === 0) issues.push(`Missing root: ${key}`);
    if (new Set(data.roots).size !== data.roots.length) issues.push('Duplicate roots');
  } catch (error) { issues.push(error instanceof Error ? error.message : String(error)); }
  if (issues.length) { byKey.clear(); byRuntime.clear(); }
  const status = issues.length ? 'UNSUPPORTED' : 'SUPPORTED';
  const catalog: DomainCatalog = {
    domain: data.domain, signature: data.signature, status,
    issues: Object.freeze(issues), unsupported: deepFreeze(data.unsupported),
    records: Object.freeze([...byKey.values()]), roots: Object.freeze(data.roots.map(key => byKey.get(key)).filter((r): r is ResolvedRecord => !!r)),
    byKey: key => byKey.get(key), byRuntimeId: id => byRuntime.get(id),
    lookup(definition: DefinitionRef): PortResult<CatalogEntry> {
      if (status !== 'SUPPORTED') return fail(issues.join('; '));
      const record = byKey.get(definition.stableFormKey);
      if (!record || definition.catalogSignature !== record.definition.catalogSignature || definition.recordType !== record.definition.recordType) {
        return fail('Record absent or type/catalog signature mismatch');
      }
      return Object.freeze({ status: 'SUPPORTED', value: record });
    },
    resolve(key: StableFormKey, signature: CatalogSignature): PortResult<RuntimeFormId> {
      if (status !== 'SUPPORTED') return fail(issues.join('; '));
      const record = byKey.get(key);
      return record && signature === record.definition.catalogSignature
        ? Object.freeze({ status: 'SUPPORTED', value: record.runtimeFormId }) : fail('Record absent or catalog signature mismatch');
    }
  };
  return Object.freeze(catalog);
}
