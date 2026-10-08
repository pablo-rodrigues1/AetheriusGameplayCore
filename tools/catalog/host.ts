import { readFileSync, statSync } from 'node:fs';
import { basename, join } from 'node:path';
import { crc32 } from 'node:zlib';
import type { CatalogHost, DomainData, PluginFingerprint } from '../../shared/record-catalog/src/types.ts';

export interface SkyMpCatalogApi {
  getEspmLoadOrder(): string[];
  getIdFromDesc(descriptor: string): number;
  lookupEspmRecordById(id: number): { record?: { type: string } };
}
/** Refresh relevant fingerprints from the actual active files at boot. The
 * shipping manifest is build provenance, not proof that today's files match it.
 * Equivalent to client-plugins.js pluginInfo: TES4 flag + signed zlib CRC32. */
export function createFileHost(mp: SkyMpCatalogApi, dataDir: string, domains: readonly DomainData[]): CatalogHost {
  const required = new Set(domains.flatMap(d => d.dependencies.map(p => p.filename.toLowerCase())));
  const active: PluginFingerprint[] = [];
  for (const loadedPath of mp.getEspmLoadOrder()) {
    const filename = basename(loadedPath);
    if (!required.has(filename.toLowerCase())) continue;
    const file = join(dataDir, filename);
    const buf = readFileSync(file);
    if (buf.length < 12 || buf.toString('latin1', 0, 4) !== 'TES4') throw new TypeError(`Invalid TES4: ${filename}`);
    active.push(Object.freeze({ filename, size: statSync(file).size, crc32: crc32(buf) | 0,
      isLight: filename.toLowerCase().endsWith('.esl') || (buf.readUInt32LE(8) & 0x200) !== 0 }));
  }
  return Object.freeze({ plugins: () => Object.freeze(active.slice()),
    getIdFromDesc: (descriptor: string) => mp.getIdFromDesc(descriptor),
    lookupEspmRecordById: (id: number) => ({ type: mp.lookupEspmRecordById(id).record?.type ?? '' }) });
}
