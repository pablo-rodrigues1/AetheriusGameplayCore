import test from 'node:test';
import assert from 'node:assert/strict';
import { compose, effectiveSet, diff, applyDiff, explain, revokeSource, compareRevisions } from '../src/index.ts';
import { createStableFormKey } from '../../../shared/contracts/src/identity.ts';

const character = 'profile:104';
const vector = (n = 0) => ({ facts: n, grants: n, equipment: 0, effects: 0, catalog: 1 });
const stone = { kind: 'STANDING_STONE', key: 'choice' };
const klass = { kind: 'CLASS', key: 'warrior' };
const definition = (id = 1, recordType = 'SPEL', signature = 'catalog-A') => ({
  stableFormKey: createStableFormKey('fixture.esp', id, 'FULL'), recordType, catalogSignature: signature
});
const spell = (id = 1, source = stone, revision = 0) => ({ kind: 'spell', definition: definition(id), source, revision });
const perk = (rank, source = stone, revision = 0) => ({ kind: 'perk', definition: definition(2, 'PERK'), rank, source, revision });
const set = (grants = [], n = 0) => compose(character, [grants], vector(n));
const keys = grants => grants.map(g => g.definition.stableFormKey);
function permutations(values) {
  if (values.length < 2) return [values];
  return values.flatMap((value, i) => permutations(values.filter((_, index) => index !== i)).map(rest => [value, ...rest]));
}
// Fixed reproducible generator. No wall clock, host or entropy dependency.
function generator(seed) {
  let state = seed >>> 0;
  return maximum => { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; return state % maximum; };
}
function shuffle(items, draw) {
  const out = [...items];
  for (let i = out.length - 1; i > 0; --i) { const j = draw(i + 1); [out[i], out[j]] = [out[j], out[i]]; }
  return out;
}
function generatedProviders(draw, revision) {
  return [0, 1, 2].map(origin => {
    const source = { kind: ['CLASS', 'RACE', 'STANDING_STONE'][origin], key: `origin|${origin}` };
    return Array.from({ length: 10 }, (_, id) => id).filter(() => draw(3) > 0).map(id => {
      const kind = ['spell', 'ability', 'power', 'perk', 'modifier'][id % 5];
      const grant = { kind, definition: definition(id + 1, kind === 'perk' ? 'PERK' : 'SPEL'), source, revision };
      if (kind === 'perk') grant.rank = 1 + draw(255);
      if (kind === 'modifier') grant.owner = 'NATIVE_CLIENT';
      return grant;
    });
  });
}

test('empty character and empty providers are valid; explanation is empty', () => {
  const empty = compose(character, [], vector());
  assert.deepEqual(empty, set());
  assert.deepEqual(effectiveSet(empty).grants, []);
  assert.deepEqual(explain(empty, character, definition()), []);
  assert.deepEqual(applyDiff(effectiveSet(empty), diff(empty, empty)), effectiveSet(empty));
});

test('two spell origins survive single-source revoke and leave on final revoke', () => {
  const before = set([spell(1), spell(1, klass)]);
  assert.equal(before.grants.length, 2);
  assert.equal(effectiveSet(before).grants.length, 1);
  assert.deepEqual(explain(before, character, definition()), [klass, stone]);
  const one = revokeSource(before, stone, vector(1));
  assert.deepEqual(diff(before, one).removed, []);
  assert.deepEqual(explain(one, character, definition()), [klass]);
  const none = revokeSource(one, klass, vector(2));
  assert.equal(diff(one, none).removed.length, 1);
  assert.deepEqual(explain(none, character, definition()), []);
  assert.deepEqual(applyDiff(effectiveSet(before), diff(before, one)), effectiveSet(one));
});

test('standing stone replacement removes only unsupported-by-other-origin items', () => {
  const before = set([spell(1), spell(3), spell(1, klass)]);
  const after = set([spell(4), spell(1, klass)], 1);
  const delta = diff(before, after);
  assert.deepEqual(keys(delta.removed), [definition(3).stableFormKey]);
  assert.deepEqual(keys(delta.added), [definition(4).stableFormKey]);
  assert.deepEqual(explain(after, character, definition(1)), [klass]);
  assert.deepEqual(explain(after, character, definition(3)), []);
  assert.deepEqual(explain(after, character, definition(4)), [stone]);
  assert.deepEqual(applyDiff(effectiveSet(before), delta), effectiveSet(after));
});

test('perk rank is max, independent of provider order; revocation can downgrade rank', () => {
  for (const providers of permutations([[perk(2)], [perk(5, klass)]])) {
    const before = compose(character, providers, vector());
    assert.equal(effectiveSet(before).grants[0].rank, 5);
    assert.deepEqual(explain(before, character, definition(2, 'PERK')), [klass, stone]);
    const after = revokeSource(before, klass, vector(1));
    const delta = diff(before, after);
    assert.equal(delta.changed[0].rankChanged, true);
    assert.equal(delta.changed[0].next.rank, 2);
    assert.deepEqual(delta.removed, []);
    assert.deepEqual(explain(after, character, definition(2, 'PERK')), [stone]);
    assert.deepEqual(applyDiff(effectiveSet(before), delta), effectiveSet(after));
  }
});

test('same sourceKey in different kinds is distinct; revoke is exact', () => {
  const race = { kind: 'RACE', key: stone.key };
  const before = set([spell(), spell(1, race), spell(1, { ...stone, key: 'other-choice' })]);
  const after = revokeSource(before, stone, vector(1));
  assert.equal(after.grants.length, 2);
  assert.deepEqual(diff(before, after).removed, []);
});

test('identical cross-provider grants union once, conflicting duplicates fail', () => {
  assert.equal(compose(character, [[spell()], [spell()]], vector()).grants.length, 1);
  assert.throws(() => compose(character, [[spell()], [spell(1, stone, 1)]], vector()), /CONFLICTING_GRANT/);
  assert.throws(() => compose(character, [[perk(1)], [perk(2)]], vector()), /CONFLICTING_GRANT/);
  assert.throws(() => set([spell(), spell()]), /DUPLICATE_PROVIDER_GRANT/);
  assert.throws(() => set([perk(1), perk(2)]), /DUPLICATE_PROVIDER_GRANT/);
});

test('all contract grant kinds compose; modifier ownership conflicts are explicit', () => {
  const base = spell();
  const grants = [base, { ...base, kind: 'ability' }, { ...base, kind: 'power' }, perk(2),
    { ...spell(3), kind: 'modifier', owner: 'NATIVE_CLIENT' }];
  assert.equal(effectiveSet(set(grants)).grants.length, 5);
  assert.deepEqual(explain(set(grants), character, base.definition), [stone]);
  const modifier = grants.at(-1);
  assert.throws(() => set([modifier, { ...modifier, source: klass, owner: 'AETHERIUS_SERVER' }]), /CONFLICTING_OWNER/);
});

test('definition version and record type must agree even across kinds and origins', () => {
  assert.throws(() => set([spell(), { ...spell(1, klass), definition: definition(1, 'SPEL', 'catalog-B') }]), /CONFLICTING_DEFINITION/);
  assert.throws(() => set([spell(2), perk(2, klass)]), /CONFLICTING_DEFINITION/);
  const before = set([spell()]);
  const after = set([{ ...spell(), definition: definition(1, 'SPEL', 'catalog-B') }], 1);
  assert.equal(diff(before, after).changed[0].rankChanged, false);
  assert.deepEqual(applyDiff(effectiveSet(before), diff(before, after)), effectiveSet(after));
});

test('partial revision order rejects stale, incomparable, and equal-with-different-content snapshots', () => {
  assert.equal(compareRevisions(vector(), vector()), 'equal');
  assert.equal(compareRevisions(vector(), vector(1)), 'before');
  assert.equal(compareRevisions(vector(1), vector()), 'after');
  assert.equal(compareRevisions({ ...vector(), facts: 2 }, { ...vector(), grants: 2 }), 'incomparable');
  assert.throws(() => diff(set([], 1), set()), /STALE_REVISION/);
  const left = compose(character, [], { ...vector(), facts: 2 });
  const right = compose(character, [], { ...vector(), grants: 2 });
  assert.throws(() => diff(left, right), /INCOMPARABLE_REVISION/);
  assert.throws(() => diff(set(), set([spell()])), /REVISION_CONTENT_CONFLICT/);
  assert.throws(() => diff(set([spell()]), set([spell(1, stone, 1)])), /REVISION_CONTENT_CONFLICT/);
  assert.throws(() => revokeSource(set([spell()]), stone, vector()), /REVISION_CONTENT_CONFLICT/);
  const bumped = set([spell()], 1);
  assert.deepEqual(diff(set([spell()]), bumped).changed, []);
  assert.deepEqual(applyDiff(effectiveSet(set([spell()])), diff(set([spell()]), bumped)), effectiveSet(bumped));
});

test('malformed inputs fail with path/code rather than silent normalization', () => {
  const bad = [
    [{ ...spell(), source: undefined }, /source/],
    [{ ...spell(), source: { kind: 'CLASS', key: '' } }, /source.key/],
    [{ ...spell(), source: { kind: 'UNKNOWN', key: 'key' } }, /INVALID_SOURCE_KIND/],
    [{ ...spell(), definition: { ...definition(), stableFormKey: 'fixture.esp|000000' } }, /INVALID_DEFINITION/],
    [{ ...spell(), definition: { ...definition(), stableFormKey: 'Fixture.esp|000001' } }, /INVALID_DEFINITION/],
    [{ ...spell(), definition: { ...definition(), stableFormKey: 'fixture.esp|FE001001' } }, /INVALID_DEFINITION/],
    [{ ...spell(), definition: { ...definition(), stableFormKey: 'fixture.esl|001000' } }, /INVALID_DEFINITION/],
    [{ ...spell(), definition: definition(1, 'PERK') }, /INVALID_DEFINITION_TYPE/],
    [{ ...spell(), definition: { ...definition(), catalogSignature: ' ' } }, /catalogSignature/],
    [{ ...spell(), definition: { ...definition(), recordType: 'NOPE' } }, /INVALID_RECORD_TYPE/],
    [{ ...spell(), kind: 'unknown' }, /INVALID_GRANT_KIND/],
    [{ ...spell(), revision: -1 }, /INVALID_REVISION/],
    [{ ...spell(), revision: Number.MAX_SAFE_INTEGER + 1 }, /INVALID_REVISION/],
    [{ ...spell(), extra: true }, /INVALID_FIELDS/],
    [perk(0), /INVALID_RANK/], [perk(256), /INVALID_RANK/], [perk(1.5), /INVALID_RANK/],
    [{ ...spell(), kind: 'modifier', owner: 'UNKNOWN' }, /INVALID_OWNER/]
  ];
  for (const [grant, pattern] of bad) assert.throws(() => set([grant]), pattern);
  assert.throws(() => compose('', [], vector()), /characterKey/);
  assert.throws(() => compose(character, null, vector()), /INVALID_PROVIDERS/);
  assert.throws(() => compose(character, [null], vector()), /INVALID_PROVIDER_OUTPUT/);
  assert.throws(() => compose(character, Array(1), vector()), /INVALID_PROVIDER_OUTPUT/);
  assert.throws(() => set(Array(1)), /INVALID_GRANT/);
  for (const revision of [{}, { ...vector(), effects: -1 }, { ...vector(), grants: NaN }, { ...vector(), equipment: 1.1 }]) {
    assert.throws(() => compose(character, [], revision), /INVALID_FIELDS|INVALID_REVISION/);
  }
});

test('character and explanation definition mismatches cannot leak another state', () => {
  const before = set([spell()]);
  assert.throws(() => diff(before, compose('profile:105', [], vector(1))), /CHARACTER_MISMATCH/);
  assert.throws(() => explain(before, 'profile:105', definition()), /CHARACTER_MISMATCH/);
  assert.throws(() => explain(before, character, definition(1, 'SPEL', 'old-catalog')), /DEFINITION_MISMATCH/);
  assert.deepEqual(explain(before, character, definition(8)), []);
});

test('copies are deeply frozen without freezing or retaining caller-owned DTOs', () => {
  const grant = spell(); const rev = vector();
  const before = compose(character, [[grant]], rev);
  grant.source.key = 'changed'; grant.definition.catalogSignature = 'changed'; rev.facts = 99;
  assert.equal(before.grants[0].source.key, 'choice');
  assert.equal(before.grants[0].definition.catalogSignature, 'catalog-A');
  assert.equal(before.revision.facts, 0);
  assert.equal(Object.isFrozen(grant), false);
  assert.throws(() => { before.grants[0].definition.catalogSignature = 'write'; }, TypeError);
  assert.throws(() => { effectiveSet(before).grants[0].sources.push(klass); }, TypeError);
  assert.throws(() => { explain(before, character, definition())[0].key = 'write'; }, TypeError);
});

test('diff replay rejects wrong base, tampering, duplicate operations and old revisions', () => {
  const before = set([perk(2)]); const after = set([perk(3), spell(3)], 1);
  const delta = diff(before, after); const effective = effectiveSet(before);
  assert.throws(() => applyDiff(effective, { ...delta, previousRevision: vector(5) }), /DIFF_BASE_REVISION_MISMATCH/);
  assert.throws(() => applyDiff(effective, { ...delta, characterKey: 'profile:105' }), /CHARACTER_MISMATCH/);
  assert.throws(() => applyDiff(effective, { ...delta, added: [...delta.added, ...delta.added] }), /DUPLICATE_DIFF_ITEM/);
  assert.throws(() => applyDiff(effective, { ...delta, changed: [{ ...delta.changed[0], rankChanged: false }] }), /DIFF_RANK_FLAG_MISMATCH/);
  assert.throws(() => applyDiff(effective, { ...delta, changed: [{ ...delta.changed[0], previous: { ...delta.changed[0].previous, rank: 7 } }] }), /DIFF_ITEM_MISMATCH/);
  assert.throws(() => applyDiff(effectiveSet(set([], 2)), { ...delta, previousRevision: vector(2) }), /STALE_REVISION/);
  assert.throws(() => applyDiff(effective, { ...delta, revision: vector() }), /REVISION_CONTENT_CONFLICT/);
  assert.throws(() => applyDiff({ ...effective, grants: [...effective.grants, ...effective.grants] }, delta), /DUPLICATE_EFFECTIVE_GRANT/);
});

test('property: deterministic union for generated provider/grant permutations (120 seeds)', () => {
  for (let seed = 1; seed <= 120; ++seed) {
    const draw = generator(seed);
    const providers = generatedProviders(draw, 0);
    const expected = compose(character, providers, vector());
    for (const order of permutations(providers)) {
      for (let repeat = 0; repeat < 3; ++repeat) {
        const actual = compose(character, order.map(grants => shuffle(grants, draw)), vector());
        assert.deepEqual(actual, expected, `seed ${seed}`);
        assert.deepEqual(effectiveSet(actual), effectiveSet(expected), `effective seed ${seed}`);
      }
    }
  }
});

test('property: all input-grant permutations of a mixed two-origin fixture', () => {
  const providers = [[spell(), perk(2), spell(3)], [spell(1, klass), perk(4, klass), spell(3, klass)]];
  const expected = compose(character, providers, vector());
  for (const left of permutations(providers[0])) for (const right of permutations(providers[1])) {
    for (const output of [[left, right], [right, left]]) assert.deepEqual(compose(character, output, vector()), expected);
  }
});

test('property: applying a generated diff reproduces exact next effective set (240 seeds)', () => {
  for (let seed = 1; seed <= 240; ++seed) {
    const draw = generator(seed);
    const before = compose(character, generatedProviders(draw, 0), vector());
    const after = compose(character, generatedProviders(draw, 1), vector(1));
    const beforeJson = JSON.stringify(before);
    const delta = diff(before, after);
    assert.deepEqual(applyDiff(effectiveSet(before), delta), effectiveSet(after), `seed ${seed}`);
    assert.equal(JSON.stringify(before), beforeJson);
    for (const item of effectiveSet(after).grants) {
      const expected = after.grants.filter(g => g.definition.stableFormKey === item.definition.stableFormKey).map(g => g.source);
      assert.deepEqual(explain(after, character, item.definition), expected, `explanation seed ${seed}`);
    }
  }
});

test('property: sequential source revokes preserve other supports (100 seeds)', () => {
  for (let seed = 1; seed <= 100; ++seed) {
    const draw = generator(seed); const providers = generatedProviders(draw, 0);
    let before = compose(character, providers, vector());
    const sources = [klass, { kind: 'RACE', key: 'origin|1' }, { kind: 'STANDING_STONE', key: 'origin|2' }];
    sources[0] = { kind: 'CLASS', key: 'origin|0' };
    for (const [index, source] of sources.entries()) {
      const after = revokeSource(before, source, vector(index + 1));
      const delta = diff(before, after);
      assert.deepEqual(applyDiff(effectiveSet(before), delta), effectiveSet(after), `seed ${seed}`);
      for (const removed of delta.removed) assert.equal(after.grants.some(g => g.definition.stableFormKey === removed.definition.stableFormKey && g.kind === removed.kind), false);
      before = after;
    }
    assert.deepEqual(before.grants, []);
  }
});
