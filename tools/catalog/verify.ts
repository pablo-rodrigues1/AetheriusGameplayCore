import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { performance } from 'node:perf_hooks';
import type { DomainData, PluginFingerprint } from '../../shared/record-catalog/src/types.ts';
import { contentSignature, recordSignature } from '../../shared/record-catalog/src/index.ts';
import { fingerprintFiles } from './host.ts';

const workspace = resolve(process.argv[2] ?? '../../../');
const catalogDir = join(workspace, 'AetheriusGameplayCore/catalog');
const domains = ['standing-stones', 'races'].map(name => JSON.parse(readFileSync(join(catalogDir, `${name}.json`), 'utf8')) as DomainData);
const dataDir = join(workspace, 'aetherius-server/build/dist/server/data');
const manifest = JSON.parse(readFileSync(join(dataDir, 'aetherius-loadorder.json'), 'utf8')) as { loadOrder: string[] };
const begin = performance.now();
// Offline file verification. This manifest is not presented as a live server boot.
const observations = fingerprintFiles(manifest.loadOrder, dataDir, domains);
for (const observation of observations) assert.ok(!('status' in observation), `Unreadable ${observation.filename}`);
const actual = observations as readonly PluginFingerprint[];
for (const domain of domains) {
  assert.equal(contentSignature(domain), domain.signature);
  for (const plugin of domain.dependencies) assert.deepEqual(actual.find(p => p.filename.toLowerCase() === plugin.filename.toLowerCase()), plugin);
  for (const record of domain.records) {
    const defining = domain.dependencies.find(p => p.filename.toLowerCase() === record.definingPlugin.toLowerCase());
    assert.ok(defining, `Missing defining plugin: ${record.stableFormKey}`);
    assert.equal(record.signature, recordSignature(record, defining), `Record signature mismatch: ${record.stableFormKey}`);
  }
  console.log(JSON.stringify({ domain: domain.domain, roots: domain.roots.length, records: domain.records.length,
    unsupported: domain.unsupported, dependencies: domain.dependencies.map(p => p.filename), bytesToHash: domain.dependencies.reduce((sum, p) => sum + p.size, 0) }));
}
console.log(JSON.stringify({ relevantFilesVerified: actual.map(p => p.filename), bytesToHashOnce: actual.reduce((sum, p) => sum + p.size, 0),
  offlineFingerprintMs: performance.now() - begin, result: 'PASSED', liveHost: false }));

const authoredDirs = ['shared/record-catalog/src', 'shared/record-catalog/tests', 'tools/catalog'];
const sources = authoredDirs.flatMap(dir => readdirSync(join(workspace, 'AetheriusGameplayCore', dir)).filter(name => name.endsWith('.ts')).map(name => join(workspace, 'AetheriusGameplayCore', dir, name)));
const files = [...sources, ...domains.map(domain => join(catalogDir, `${domain.domain}.json`))];
const runtimeLiteral = /\b0x[\da-fA-F]{8}\b|["'][\da-fA-F]{8}(?::[^"']+)?["']/;
const indexedIdentity = /\b(?:pluginIndex|pluginIdx|modIndex|fileIndex|lightSlot|regularSlot|pluginCount)\s*[:=(]|loadOrder\s*\.\s*(?:length|indexOf)|loadOrder\s*\[\s*\d/;
for (const file of files) {
  const text = readFileSync(file, 'utf8');
  assert.ok(!runtimeLiteral.test(text), `Eight-digit runtime FormID literal: ${file}`);
  assert.ok(!indexedIdentity.test(text), `Indexed/pinned load order: ${file}`);
}
console.log(`Text scan PASSED: ${files.length} source/generated files; no runtime hex literals or indexed plugin identity. Decimal CRC/size and SHA-256 strings are fingerprints, not FormIDs.`);
