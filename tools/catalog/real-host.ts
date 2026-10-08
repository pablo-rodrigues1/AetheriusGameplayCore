import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { closeSync, createReadStream, mkdirSync, openSync, readFileSync, readSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline';
import { basename, join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import { fileURLToPath } from 'node:url';
import { loadDomain, decodeFormKey, encodeFormKey } from '../../shared/record-catalog/src/index.ts';
import type { DomainData, PluginFingerprint } from '../../shared/record-catalog/src/types.ts';
import { createFileHost } from './host.ts';
import type { SkyMpCatalogApi } from './host.ts';

interface NativeHost extends SkyMpCatalogApi { getDescFromId(id: number): string; tick(): void }
interface Settings { port: number; listenHost: string; maxPlayers: number; dataDir: string; loadOrder: string[]; npcEnabled: boolean; logLevel: string; reloot: object }
interface Snapshot { domains: { domain: string; signature: string; entries: { key: string; runtimeFormId: number; descriptor: string; type: string; winner: string; data: object }[] }[]; lightProbe: { key: string; runtimeFormId: number }[] }

// Reads only TES4/MAST, not record content; protects master-before-dependent validity.
export function masters(file: string): string[] {
  const fd = openSync(file, 'r');
  try {
    const head = Buffer.alloc(24);
    assert.equal(readSync(fd, head, 0, head.length, 0), head.length);
    assert.equal(head.toString('latin1', 0, 4), 'TES4');
    const payload = Buffer.alloc(head.readUInt32LE(4));
    assert.equal(readSync(fd, payload, 0, payload.length, head.length), payload.length);
    const result: string[] = [];
    let extendedSize: number | undefined;
    for (let offset = 0; offset < payload.length;) {
      assert.ok(offset + 6 <= payload.length, `Malformed TES4 header: ${basename(file)}`);
      const type = payload.toString('latin1', offset, offset + 4);
      const size = extendedSize ?? payload.readUInt16LE(offset + 4);
      extendedSize = undefined;
      assert.ok(offset + 6 + size <= payload.length, `Malformed TES4 subrecord ${type}: ${basename(file)}`);
      if (type === 'XXXX') { assert.equal(size, 4); extendedSize = payload.readUInt32LE(offset + 6); }
      if (type === 'MAST') result.push(payload.toString('utf8', offset + 6, offset + 6 + size - 1));
      offset += size + 6;
    }
    return result;
  } finally { closeSync(fd); }
}
function checkOrder(order: string[], dependencies: Map<string, string[]>): void {
  const seen = new Set<string>();
  for (const plugin of order) {
    for (const master of dependencies.get(plugin.toLowerCase())!) assert.ok(seen.has(master.toLowerCase()), `Master ${master} must precede ${plugin}`);
    assert.ok(!seen.has(plugin.toLowerCase()), `Duplicate plugin ${plugin}`);
    seen.add(plugin.toLowerCase());
  }
}
function swapped(order: string[], a: string, b: string): string[] {
  // Replace by filename; callers never supply or receive plugin indices.
  return order.map(name => name === a ? b : name === b ? a : name);
}
function reorder(order: string[], metadata: PluginFingerprint[], dependencies: Map<string, string[]>, probes: Map<string, string>): { order: string[]; moved: string[] } {
  const relevant = ['Mundus.esp', 'Aetherius.esp'];
  let result: string[] | undefined;
  let moved: string[] = [];
  for (const a of relevant) {
    for (const b of order.filter(name => name !== a)) {
      const candidate = swapped(order, a, b);
      try { checkOrder(candidate, dependencies); result = candidate; moved = [a, b]; break; } catch { /* another valid swap */ }
    }
    if (result) break;
  }
  assert.ok(result, 'No valid move for a relevant plugin');
  const light = metadata.filter(p => p.isLight && order.includes(p.filename) && probes.has(p.filename.toLowerCase()));
  for (const a of light) for (const b of light.filter(p => p.filename !== a.filename)) {
    const candidate = swapped(result, a.filename, b.filename);
    try { checkOrder(candidate, dependencies); return { order: candidate, moved: [...moved, a.filename, b.filename] }; } catch { /* another valid swap */ }
  }
  throw new Error('No valid swap for light plugins');
}
function child(workspace: string, evidence: string, configFile: string): void {
  const data = ['standing-stones', 'races'].map(name => JSON.parse(readFileSync(join(workspace, 'AetheriusGameplayCore/catalog', `${name}.json`), 'utf8')) as DomainData);
  const settings = JSON.parse(readFileSync(configFile, 'utf8')) as Settings;
  const require = createRequire(import.meta.url);
  // Native code's emitter setup expects a CommonJS loader; no gamemode/bundle is loaded.
  (globalThis as typeof globalThis & { require?: NodeJS.Require }).require = require;
  const addon = require(join(workspace, 'aetherius-server/build/dist/server/scam_native.node')) as { ScampServer: new (settings: string) => NativeHost };
  const start = performance.now();
  const mp = new addon.ScampServer(JSON.stringify(settings));
  mp.tick();
  const hostStart = performance.now();
  const host = createFileHost(mp, settings.dataDir, data);
  const hostCost = performance.now() - hostStart;
  const catalogs = data.map(domain => loadDomain(domain, host));
  for (const catalog of catalogs) assert.equal(catalog.status, 'SUPPORTED', catalog.issues.join('; '));
  const snapshot: Snapshot = { domains: catalogs.map(catalog => ({ domain: catalog.domain, signature: catalog.signature,
    entries: catalog.records.map(record => {
      const descriptor = mp.getDescFromId(record.runtimeFormId);
      assert.equal(decodeFormKey(descriptor, 'skymp', record.pluginKind), record.definition.stableFormKey);
      return { key: record.definition.stableFormKey, runtimeFormId: record.runtimeFormId, descriptor,
        type: record.definition.recordType, winner: record.winnerPlugin, data: record.data };
    }) })), lightProbe: [] };
  // Real light records from their own defining files, addressed only by filename/local id.
  const plan = JSON.parse(readFileSync(join(evidence, 'reorder-plan.json'), 'utf8')) as { lightProbes: string[] };
  for (const descriptor of plan.lightProbes) {
    const id = mp.getIdFromDesc(descriptor);
    assert.ok(mp.lookupEspmRecordById(id).record, `Light probe does not exist: ${descriptor}`);
    assert.equal(decodeFormKey(mp.getDescFromId(id), 'skymp', 'LIGHT'), decodeFormKey(descriptor, 'skymp', 'LIGHT'));
    snapshot.lightProbe.push({ key: decodeFormKey(descriptor, 'skymp', 'LIGHT'), runtimeFormId: id });
  }
  writeFileSync(join(evidence, `${basename(configFile, '.json')}.resolution.json`), JSON.stringify(snapshot, null, 2));
  console.log(JSON.stringify({ result: 'PASSED', domains: catalogs.map(c => ({ domain: c.domain, records: c.records.length })), fingerprintBootMs: hostCost,
    fingerprintBytes: host.plugins().reduce((sum, p) => sum + ('size' in p ? p.size : 0), 0), totalBootMs: performance.now() - start }));
}
async function main(): Promise<void> {
  const [workspaceArg, evidenceArg, mode, config] = process.argv.slice(2);
  assert.ok(workspaceArg && evidenceArg, 'Usage: real-host.ts <workspace> <evidence-dir> [child <config>]');
  const workspace = resolve(workspaceArg), evidence = resolve(evidenceArg);
  if (mode === 'child') { assert.ok(config); child(workspace, evidence, config); return; }
  const serverData = join(workspace, 'aetherius-server/build/dist/server/data');
  const manifest = JSON.parse(readFileSync(join(serverData, 'aetherius-loadorder.json'), 'utf8')) as { loadOrder: string[]; plugins: PluginFingerprint[] };
  const dependencies = new Map(manifest.loadOrder.map(name => [name.toLowerCase(), masters(join(serverData, name))]));
  checkOrder(manifest.loadOrder, dependencies);
  const probes = new Map<string, string>();
  const lightNames = new Set(manifest.plugins.filter(p => p.isLight).map(p => p.filename.toLowerCase()));
  const rows = createInterface({ input: createReadStream(join(workspace, '_work/exports/SPEL.jsonl'), 'utf8'), crlfDelay: Infinity });
  for await (const line of rows) {
    const row = JSON.parse(line) as { formid?: string };
    if (!row.formid) continue;
    const filename = row.formid.slice(row.formid.indexOf(':') + 1);
    if (lightNames.has(filename.toLowerCase()) && !probes.has(filename.toLowerCase())) {
      probes.set(filename.toLowerCase(), encodeFormKey(decodeFormKey(row.formid, 'housecarl', 'LIGHT'), 'skymp', 'LIGHT', filename));
    }
  }
  const changed = reorder(manifest.loadOrder, manifest.plugins, dependencies, probes);
  mkdirSync(evidence, { recursive: true });
  writeFileSync(join(evidence, 'reorder-plan.json'), JSON.stringify({ movedPlugins: changed.moved, mastersValidated: true,
    lightProbes: changed.moved.slice(2).map(name => probes.get(name.toLowerCase())) }, null, 2));
  const files = ['original', 'reordered'].map(name => join(evidence, `${name}.settings.json`));
  for (const [name, loadOrder] of [['original', manifest.loadOrder], ['reordered', changed.order]] as const) {
    // Deliberately omit account, credentials, saves, gamemode, damage and bundle settings.
    const settings: Settings = { port: 7777, listenHost: '127.0.0.1', maxPlayers: 1, dataDir: serverData, loadOrder: [...loadOrder], npcEnabled: false, logLevel: 'warn', reloot: {} };
    writeFileSync(join(evidence, `${name}.settings.json`), JSON.stringify(settings, null, 2));
  }
  for (const file of files) {
    const portCheck = spawnSync('pwsh', ['-NoProfile', '-Command', '$endpoint=Get-NetUDPEndpoint -LocalPort 7777 -ErrorAction SilentlyContinue; if ($endpoint) { $endpoint | Select-Object LocalAddress,LocalPort,OwningProcess; exit 2 }; Write-Output "UDP 7777 FREE"'], { encoding: 'utf8' });
    writeFileSync(join(evidence, `${basename(file, '.json')}.port.txt`), `${portCheck.stdout}${portCheck.stderr}`);
    assert.equal(portCheck.status, 0, 'UDP 7777 is in use or could not be checked; owner server is never stopped');
    const launched = spawnSync(process.execPath, ['--experimental-strip-types', fileURLToPath(import.meta.url), workspace, evidence, 'child', file], { cwd: evidence, encoding: 'utf8', timeout: 180000, maxBuffer: 16 * 1024 * 1024 });
    writeFileSync(join(evidence, `${basename(file, '.json')}.log`), `${launched.stdout}\n${launched.stderr}\nexit=${launched.status}\nerror=${launched.error?.message ?? ''}\n`);
    assert.equal(launched.status, 0, `Host failed: ${basename(file)} (see .log)`);
  }
  const snapshots = files.map(file => JSON.parse(readFileSync(join(evidence, `${basename(file, '.json')}.resolution.json`), 'utf8')) as Snapshot);
  const stripped = (snapshot: Snapshot) => snapshot.domains.map(d => ({ ...d, entries: d.entries.map(({ runtimeFormId: _id, ...entry }) => entry) }));
  assert.deepEqual(stripped(snapshots[0]!), stripped(snapshots[1]!));
  const altered = snapshots[0]!.domains.flatMap(d => d.entries).filter(entry => snapshots[1]!.domains.flatMap(d => d.entries).find(other => other.key === entry.key)!.runtimeFormId !== entry.runtimeFormId);
  assert.ok(altered.some(entry => entry.key.startsWith('mundus.esp|') || entry.key.startsWith('aetherius.esp|')), 'Relevant defining plugin ids must change');
  assert.ok(snapshots[0]!.lightProbe.some(p => snapshots[1]!.lightProbe.find(other => other.key === p.key)!.runtimeFormId !== p.runtimeFormId), 'A light probe must change its runtime id');
  console.log(JSON.stringify({ result: 'PASSED', movedPlugins: changed.moved, changedRelevantRecords: altered.length, equivalentDomains: snapshots[0]!.domains.map(d => d.domain) }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });
