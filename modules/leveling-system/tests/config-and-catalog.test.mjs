import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ConfigLoader } from '../src/config/loader.mjs';
import { EnemyXpCatalog } from '../src/domain/catalog.mjs';
import { EnemyLevelScalingPolicy } from '../src/math/scaling.mjs';
import { ContentRelevancePolicy } from '../src/policies/content-relevance.mjs';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const loaded = await new ConfigLoader(root).load();

test('production balance configuration is structurally READY', () => {
  assert.equal(loaded.errors.length, 0);
  assert.equal(loaded.status, 'READY');
  assert.equal(loaded.configVersion, 'user-approved-2026-09-12-r3');
});

test('entire authorized XP snapshot is represented without silent legacy values', () => {
  const expected = {
    Bandit: 10, Riekling: 10, 'Silver Hand': 12, Reaver: 13, Forsworn: 15, 'Warlock / Necromancer': 15, Cultist: 15, Falmer: 20, Vampire: 30, Thalmor: 18,
    Skeleton: 10, Draugr: 18, 'Ghost / Phantom': 20, 'Corrupted Shade': 21, Boneman: 22, Mistman: 24, Wrathman: 28,
    'Dragon Priest': 500, 'Ice Wraith': 14, Chaurus: 15, Troll: 16, 'Chaurus Hunter': 18, Spriggan: 18, 'Ash Spawn': 18, Giant: 20, Hagraven: 21, 'Wispmother / Wisp': 22, Gargoyle: 22, 'Ash Guardian': 26, Lurker: 28, Seeker: 30,
    Mudcrab: 3, Skeever: 4, Slaughterfish: 4, Wolf: 5, Horker: 6, 'Frostbite Spider': 7, 'Sabre Cat': 9, Bear: 10, 'Death Hound': 12, Netch: 13, Mammoth: 15,
    'Dwarven Spider': 12, 'Dwarven Sphere': 18, 'Dwarven Ballista': 24, 'Dwarven Centurion': 30,
    'Flame Atronach': 20, 'Frost Atronach': 22, 'Storm Atronach': 25, Dremora: 30, Dragon: 1000
  };
  const profiles = loaded.configs.enemyBaseXp.profiles;
  const originalProfiles = profiles.filter((profile) => !profile.balanceId.startsWith('mundo.'));
  const worldProfiles = profiles.filter((profile) => profile.balanceId.startsWith('mundo.'));
  const originalScaledProfiles = originalProfiles.filter((profile) => profile.awardMode === 'SCALED');
  const originalByBalanceId = new Map(originalProfiles.map((profile) => [profile.balanceId, profile]));
  assert.equal(originalProfiles.length, Object.keys(expected).length, 'all 51 original authorized profiles remain represented');
  assert.equal(originalByBalanceId.size, originalProfiles.length, 'original balance identifiers are unique');
  assert.equal(worldProfiles.length, originalScaledProfiles.length,
    'each SCALED original profile has exactly one mundo.* profile');
  assert.equal(profiles.length, Object.keys(expected).length + originalScaledProfiles.length,
    'total is the original authorized snapshot plus one mundo.* profile per SCALED original');
  for (const [label, value] of Object.entries(expected)) {
    const profile = originalProfiles.find((candidate) => candidate.sourceLabel === label);
    assert.ok(profile, `missing ${label}`);
    assert.equal(profile.awardMode === 'FIXED' ? profile.fixedXp : profile.baseXp, value, label);
  }
  const seenWorldProfiles = new Set();
  for (const worldProfile of worldProfiles) {
    const originalBalanceId = worldProfile.balanceId.slice('mundo.'.length);
    const original = originalByBalanceId.get(originalBalanceId);
    assert.ok(original, `${worldProfile.balanceId} has no original balance profile`);
    assert.equal(original.awardMode, 'SCALED', `${worldProfile.balanceId} must correspond to a scalable original profile`);
    assert.equal(worldProfile.balanceId, `mundo.${original.balanceId}`);
    assert.equal(worldProfile.sourceLabel, `${original.sourceLabel} (mundo)`);
    assert.equal(worldProfile.awardMode, 'SCALED');
    assert.deepEqual(worldProfile.eventXpCategories, original.eventXpCategories.map((category) => `${category}_mundo`),
      `${worldProfile.balanceId} must map each original category to its mundo counterpart`);
    assert.equal(seenWorldProfiles.has(original.balanceId), false, `${worldProfile.balanceId} duplicates its original profile`);
    seenWorldProfiles.add(original.balanceId);
  }
  for (const original of originalScaledProfiles) {
    assert.equal(seenWorldProfiles.has(original.balanceId), true, `missing mundo.${original.balanceId}`);
  }
  const catalog = new EnemyXpCatalog(loaded.configs.enemyBaseXp);
  assert.equal(catalog.resolveExact('vampire').profile.baseXp, 30);
  assert.equal(catalog.resolveExact('unknown').ok, false);
  assert.equal(catalog.resolveExact('thalmor').profile.baseXp, 18);
  assert.equal(profiles.find((profile) => profile.sourceLabel === 'Cultist').mappingStatus, 'ASSIGNED');
  assert.equal(profiles.find((profile) => profile.sourceLabel === 'Corrupted Shade').difficultyCategory, 'HARD');
  assert.equal(profiles.find((profile) => profile.sourceLabel === 'Falmer').difficultyCategory, 'MEDIUM');
  assert.equal(profiles.find((profile) => profile.sourceLabel === 'Thalmor').difficultyCategory, 'MEDIUM');
  assert.equal(profiles.find((profile) => profile.sourceLabel === 'Ice Wraith').difficultyCategory, 'MEDIUM');
  assert.deepEqual(profiles.find((profile) => profile.sourceLabel === 'Wispmother / Wisp').eventXpCategories, ['wispmother', 'wisp']);
  assert.deepEqual(profiles.filter((profile) => profile.mappingStatus === 'UNRESOLVED').map((profile) => profile.sourceLabel), []);
});

test('authorized enemy scaling uses the second +2% softcap through level 100', () => {
  const policy = new EnemyLevelScalingPolicy(loaded.configs.enemyLevelScaling);
  assert.equal(policy.resolve(1).value, 1);
  assert.equal(policy.resolve(20).value.toFixed(2), '4.80');
  assert.equal(policy.resolve(21).value.toFixed(2), '4.85');
  assert.equal(policy.resolve(40).value.toFixed(2), '5.80');
  assert.equal(policy.resolve(41).value.toFixed(2), '5.82');
  assert.equal(policy.resolve(100).value.toFixed(2), '7.00');
});

test('party tables are exact and content relevance follows the approved floor', () => {
  assert.deepEqual(loaded.configs.partyXp.normal.multipliers, { '1': 1, '2': 0.9, '3': 0.85, '4': 0.8, '5': 0.75, '6': 0.7, '7': 0.65, '8': 0.6 });
  assert.equal(loaded.configs.partyXp.raid.multipliers['20'], 0.4);
  const policy = new ContentRelevancePolicy(loaded.configs.contentRelevance);
  assert.deepEqual(policy.resolve(5, { recommendedClassMin: 10, recommendedClassMax: 20 }), { ok: true, multiplier: 1, status: 'BELOW_RANGE' });
  assert.deepEqual(policy.resolve(15, { recommendedClassMin: 10, recommendedClassMax: 20 }), { ok: true, multiplier: 1, status: 'WITHIN_RANGE' });
  assert.deepEqual(policy.resolve(21, { recommendedClassMin: 10, recommendedClassMax: 20 }), { ok: true, multiplier: 0.95, status: 'ABOVE_RANGE' });
  assert.deepEqual(policy.resolve(40, { recommendedClassMin: 1, recommendedClassMax: 10 }), { ok: true, multiplier: 0.1, status: 'ABOVE_RANGE' });
});
