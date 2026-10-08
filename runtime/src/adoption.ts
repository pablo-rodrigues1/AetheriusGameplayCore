import { compose } from '../../modules/actor-state-system/src/index.ts';
import { standingStoneGrants, StandingStoneError } from '../../modules/standing-stone-system/src/index.ts';
import type { StandingStoneCatalog } from '../../modules/standing-stone-system/src/index.ts';
import type { CharacterKey, SessionEpoch, StableFormKey } from '../../shared/contracts/src/index.ts';
import { canonicalJson, executeCommand } from '../../shared/persistence/src/index.ts';
import type { PoolPort } from '../../shared/persistence/src/index.ts';
import { scopedPool } from './persistence-scope.ts';

/** Development-only import. Caller stops both stone writers and uses the existing
 * gamemode pool. Proves ownership from spike projection, never from native save. */
export async function adoptSpikeChoice(pool: PoolPort, catalog: StandingStoneCatalog, characterKey: CharacterKey, schema = 'public') {
  return executeCommand(scopedPool(pool, schema), { requestId: `standing-stones.adopt:${characterKey}`,
    characterKey, epoch: 'development-adoption' as SessionEpoch, type: 'standing-stones.adopt', payload: { version: 1 } }, async tx => {
    const source = (await tx.query<{ stone_key: StableFormKey }>(
      'SELECT stone_key FROM spike_standing_stone_choices WHERE character_key=$1', [characterKey])).rows[0];
    if (!source) throw new StandingStoneError('SPIKE_CHOICE_MISSING');
    const grants = standingStoneGrants(catalog, { stoneKey: source.stone_key, revision: 1 });
    const projection = (await tx.query<{ grants: unknown }>(
      'SELECT grants FROM spike_standing_stone_projections WHERE character_key=$1', [characterKey])).rows[0];
    const old = projection?.grants as { kind?: string; definition?: { stableFormKey?: string; recordType?: string }; source?: { kind?: string } }[] | undefined;
    const expected = new Set(grants.map(grant => grant.definition.stableFormKey));
    if (!Array.isArray(old) || old.length !== expected.size || new Set(old.map(g => g.definition?.stableFormKey)).size !== old.length
      || old.some(g => g.kind !== 'spell' || g.definition?.recordType !== 'SPEL' || g.source?.kind !== 'STANDING_STONE'
        || !expected.has(g.definition.stableFormKey as StableFormKey))) throw new StandingStoneError('SPIKE_PROJECTION_MISMATCH');
    const existing = await tx.query('SELECT character_key FROM gc_standing_stone_choice WHERE character_key=$1', [characterKey]);
    const heads = await tx.query('SELECT character_key FROM gc_spell_projection_heads WHERE character_key=$1', [characterKey]);
    const rows = await tx.query('SELECT character_key FROM gc_spell_projections WHERE character_key=$1', [characterKey]);
    if (existing.rows.length || heads.rows.length || rows.rows.length) throw new StandingStoneError('CORE_STATE_ALREADY_EXISTS');
    const revision = { facts: 1, grants: 1, equipment: 0, effects: 0, catalog: 1 };
    const set = compose(characterKey, [grants], revision);
    await tx.query('INSERT INTO gc_standing_stone_choice (character_key,stone_key,revision) VALUES ($1,$2,$3)', [characterKey, source.stone_key, 1]);
    for (const grant of grants) {
      await tx.query(`INSERT INTO gc_spell_projections (character_key,stable_form_key,definition,revision,owned,active)
        VALUES ($1,$2,$3::jsonb,$4::jsonb,true,true)`, [characterKey, grant.definition.stableFormKey,
        canonicalJson(grant.definition), canonicalJson(revision)]);
    }
    // Import proves authorship, not that this process has reconciled the actor.
    await tx.query('INSERT INTO gc_spell_projection_heads (character_key,grant_set,complete) VALUES ($1,$2::jsonb,false)', [characterKey, canonicalJson(set)]);
    return { stoneKey: source.stone_key, revision: 1, adopted: [...expected] };
  });
}
