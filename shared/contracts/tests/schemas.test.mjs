import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readFileSync, readdirSync } from 'node:fs';
import Ajv from 'ajv';
import { specimens, grant, revision, binding, definition, evidence, facts } from './fixtures.mjs';
import { createStableFormKey, parseStableFormKey } from '../.test-build/src/identity.js';

const dir = new URL('../schemas/', import.meta.url);
const ajv = new Ajv({ strict: true, allErrors: true, validateSchema: true });
const schemas = readdirSync(dir).filter(name => name.endsWith('.schema.json'))
  .map(name => JSON.parse(readFileSync(new URL(name, dir), 'utf8')));
for (const schema of schemas) ajv.addSchema(schema);
const validators = Object.fromEntries(schemas.map(schema => [schema.title, ajv.getSchema(schema.$id)]));
const valid = (name, value) => assert.equal(validators[name](value), true, JSON.stringify(validators[name].errors));
const invalid = (name, value) => assert.equal(validators[name](value), false, `${name} accepted ${JSON.stringify(value)}`);

test('schema inventory exactly matches independent valid/invalid specimen inventory', () => {
  assert.deepEqual(Object.keys(validators).sort(), Object.keys(specimens).sort());
});
for (const schema of schemas) {
  test(`${schema.title}: Draft-07 schema and independent valid/invalid specimens`, () => {
    assert.equal(ajv.validateSchema(schema), true);
    const [good, bad] = specimens[schema.title];
    valid(schema.title, good);
    invalid(schema.title, bad);
  });
}

test('all grant variants preserve distinct sources and enforce record type/rank', () => {
  const grants = ['perk', 'spell', 'ability', 'power', 'modifier'].map(grant);
  for (const g of grants) valid('Grant', g);
  valid('GrantSet', { characterKey: binding.characterKey, revision, grants: [
    grant(), { ...grant(), source: { kind: 'RACE', key: 'skyrim:nord' } },
  ] });
  for (const rank of [0, -1, 1.5, 256, '1']) invalid('Grant', { ...grant('perk'), rank });
  invalid('Grant', { ...grant('perk'), definition: definition('SPEL') });
  invalid('Grant', { ...grant(), definition: definition('PERK') });
});

test('all source kinds, effect owners, capability statuses, modes and condition values are closed', () => {
  for (const kind of ['CLASS', 'RACE', 'STANDING_STONE', 'RELIGION', 'QUEST', 'EQUIPMENT', 'LEARNED', 'ADMIN', 'SYSTEM', 'TRANSFORMATION']) {
    valid('GrantSource', { kind, key: 'source:1' });
  }
  for (const owner of ['AETHERIUS_SERVER', 'NATIVE_SERVER', 'NATIVE_CLIENT', 'DISABLED']) valid('EffectOwner', owner);
  for (const mode of ['off', 'audit', 'shadow', 'canary', 'active']) valid('FeatureMode', mode);
  for (const value of ['TRUE', 'FALSE', 'UNSUPPORTED', 'INVALID']) valid('ConditionResult', value);
  for (const status of ['SUPPORTED', 'PARTIAL', 'UNSUPPORTED', 'DEGRADED']) valid('Capability', {
    id: 'cap', version: 1, status, proof: status === 'SUPPORTED' ? ['test.txt'] : [], limitations: status === 'SUPPORTED' ? [] : ['reason'],
  });
  invalid('Capability', { id: 'cap', version: 1, status: 'UNSUPPORTED', proof: [], limitations: [] });
});

test('command results discriminate committed, pending, conflict and rejection', () => {
  for (const [status, extra] of [['accepted', { revision }], ['rejected', {}], ['conflict', { actualRevision: revision }], ['pending', {}]]) {
    valid('CommandResult', { status, requestId: 'r:1', reason: 'reason', ...extra });
  }
  invalid('CommandResult', { status: 'pending', requestId: 'r:1', reason: 'reason', revision });
  invalid('CommandResult', { status: 'conflict', requestId: 'r:1', reason: 'reason' });
});

test('ESM/ESP/ESL/ESPFE codecs match canonical schema, LIGHT metadata limits range', () => {
  for (const [plugin, kind, id] of [['Skyrim.esm', 'FULL', 0xffffff], ['Mundus.esp', 'FULL', 0x800], ['Light.esl', 'LIGHT', 0xfff], ['Flagged.esp', 'LIGHT', 0x801]]) {
    const key = createStableFormKey(plugin, id, kind);
    valid('StableFormKey', key);
    valid('CatalogEntry', { definition: definition('SPEL', key), winnerPlugin: plugin.toLowerCase(), pluginKind: kind, data: {} });
    assert.equal(parseStableFormKey(key, kind), key);
  }
  for (const key of ['test.esm|000000', 'test.esm|FF000800', 'test.esp|FE001801', '|000800', 'Test.esm|000800', 'test.esm|000abc', 'test.esl|001000', 'bad\nname.esp|000800']) invalid('StableFormKey', key);
  invalid('CatalogEntry', { definition: definition('SPEL', 'flagged.esp|001000'), winnerPlugin: 'override.esp', pluginKind: 'LIGHT', data: {} });
  invalid('CatalogEntry', { definition: definition('SPEL', 'light.esl|000801'), winnerPlugin: 'override.esp', pluginKind: 'FULL', data: {} });
});

test('hit evidence cannot claim results or validated facts, and failed checks are not facts', () => {
  invalid('ServerHitFacts', evidence);
  invalid('ClientHitEvidence', facts);
  for (const field of ['damage', 'healing', 'xp', 'duration']) invalid('ClientHitEvidence', { ...evidence, [field]: 10 });
  for (const check of Object.keys(facts.checks)) invalid('ServerHitFacts', { ...facts, checks: { ...facts.checks, [check]: false } });
});

test('runtime-only references never substitute for durable identity', () => {
  for (const characterKey of [binding.actorRef, binding.actorRef.actorId]) {
    invalid('GrantSet', { characterKey, revision, grants: [] });
    invalid('SessionBinding', { ...binding, characterKey });
  }
  invalid('DefinitionRef', { ...definition(), stableFormKey: 0x01000800 });
});

test('ACK requires whole session and revision; no remove-all operation or mutation fields', () => {
  valid('GrantProjection', { binding, set: { characterKey: binding.characterKey, revision, grants: [] } });
  for (const status of ['applied', 'unsupported', 'invalid']) valid('GrantProjectionAck', { binding, revision, status, reason: 'reason' });
  invalid('GrantProjection', { binding, set: specimens.GrantSet[0], removeAll: true });
  invalid('GrantProjectionAck', { binding: { ...binding, epoch: undefined }, revision, status: 'applied', reason: 'no epoch' });
});

test('safe integer revision counters and finite JSON wire numbers only', () => {
  for (const facts of [-1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, '1']) invalid('RevisionVector', { ...revision, facts });
  for (const delta of [NaN, Infinity, -Infinity]) invalid('ResourceMutation', { ...specimens.ResourceMutation[0], delta });
  invalid('CommandEnvelope', { ...specimens.CommandEnvelope[0], payload: { delta: Infinity } });
  valid('CommandEnvelope', { ...specimens.CommandEnvelope[0], expectedRevision: revision });
});
