import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createStableFormKey, parseStableFormKey, formatStableFormKey, stableFormKeyParts } from '../.test-build/src/identity.js';

for (const [label, plugin, id, kind] of [
  ['ESM', 'Skyrim.esm', 0x12eb7, 'FULL'],
  ['ESP', 'Mundus.esp', 0xabc123, 'FULL'],
  ['ESL', 'Test.esl', 0xfff, 'LIGHT'],
  ['ESPFE', 'LightFlagged.esp', 0x801, 'LIGHT'],
  ['light ESM', 'LightFlagged.esm', 0x802, 'LIGHT'],
]) {
  test(`${label}: canonical parse/format round trip and local parts`, () => {
    const key = createStableFormKey(plugin, id, kind);
    const expected = `${plugin.toLowerCase()}|${id.toString(16).padStart(6, '0').toUpperCase()}`;
    assert.equal(key, expected);
    assert.equal(parseStableFormKey(formatStableFormKey(key, kind), kind), key);
    assert.equal(parseStableFormKey(`${plugin}|${id.toString(16).padStart(6, '0')}`, kind), key);
    assert.deepEqual(stableFormKeyParts(key, kind), { plugin: plugin.toLowerCase(), localFormId: id });
    assert.ok(Object.isFrozen(stableFormKeyParts(key, kind)));
  });
}

for (const [value, kind] of [
  ['skyrim.esm|01012EB7', 'FULL'], ['light.esp|FE001801', 'LIGHT'],
  ['test.esm|FF000800', 'FULL'], ['test.esp|1000000', 'FULL'],
  ['test.esm|000000', 'FULL'], ['|000800', 'FULL'],
  ['C:/test.esp|000800', 'FULL'], ['dir\\test.esp|000800', 'FULL'],
  ['test.esp:000800', 'FULL'], ['000800:Test.esp', 'FULL'],
  [' test.esp|000800', 'FULL'], ['test.esp |000800', 'FULL'],
  ['test.txt|000800', 'FULL'], ['.esp|000800', 'FULL'],
  ['test.esp|GG0001', 'FULL'], ['test.esp|00001', 'FULL'],
  ['test.esl|001000', 'LIGHT'], ['test.esl|000800', 'FULL'],
  ['test.esp|001000', 'LIGHT'], ['test.esm|001000', 'LIGHT'],
  ['test.esp|000800', undefined], ['test.esp|000800', 'GUESS'],
  ['bad\nname.esp|000800', 'FULL'], [42, 'FULL'],
]) {
  test(`reject invalid key ${JSON.stringify(value)}, kind=${kind}`, () => {
    assert.throws(() => parseStableFormKey(value, kind));
  });
}

test('creation rejects raw runtime numbers without truncating or masking', () => {
  for (const id of [0x01000800, 0xfe001801, 0xff000800, 0x1000000, 0, -1, 0.5, NaN, Infinity, '2048']) {
    assert.throws(() => createStableFormKey('test.esp', id, 'FULL'));
  }
  assert.throws(() => createStableFormKey('', 0x800, 'FULL'));
  assert.throws(() => createStableFormKey(null, 0x800, 'FULL'));
});

test('24-bit FULL and 12-bit LIGHT inclusive upper limits, no inference by .esp', () => {
  assert.equal(createStableFormKey('test.esp', 0xffffff, 'FULL'), 'test.esp|FFFFFF');
  assert.equal(createStableFormKey('test.esp', 0xfff, 'LIGHT'), 'test.esp|000FFF');
  assert.equal(createStableFormKey('test.esp', 0x1000, 'FULL'), 'test.esp|001000');
  assert.throws(() => createStableFormKey('test.esp', 0x1000, 'LIGHT'));
  assert.throws(() => formatStableFormKey('test.esl|001000', 'LIGHT'));
});
