const STONES = Object.freeze({
  'skyrim.esm|0D232D': Object.freeze({ spell: 'skyrim.esm|0E5F4C', plugin: 'Skyrim.esm', formId: '0E5F4C' }),
  'skyrim.esm|0D232E': Object.freeze({ spell: 'skyrim.esm|0E5F47', plugin: 'Skyrim.esm', formId: '0E5F47' }),
  'skyrim.esm|0D232F': Object.freeze({ spell: 'skyrim.esm|0E5F45', plugin: 'Skyrim.esm', formId: '0E5F45' }),
  'skyrim.esm|0D2330': Object.freeze({ spell: 'skyrim.esm|0E5F54', plugin: 'Skyrim.esm', formId: '0E5F54' }),
  'skyrim.esm|0D2331': Object.freeze({ spell: 'skyrim.esm|0E5F4E', plugin: 'Skyrim.esm', formId: '0E5F4E',
    additionalSpells: Object.freeze([{ stableFormKey: 'skyrim.esm|10E439', plugin: 'Skyrim.esm', formId: '10E439' }]) }),
  'skyrim.esm|0D2332': Object.freeze({ spell: 'skyrim.esm|0E5F5A', plugin: 'Skyrim.esm', formId: '0E5F5A' }),
  'skyrim.esm|0D2333': Object.freeze({ spell: 'skyrim.esm|0E5F5E', plugin: 'Skyrim.esm', formId: '0E5F5E' }),
  'skyrim.esm|0D2334': Object.freeze({ spell: 'skyrim.esm|0E5F51', plugin: 'Skyrim.esm', formId: '0E5F51' }),
  'skyrim.esm|0D2335': Object.freeze({ spell: 'skyrim.esm|0E732A', plugin: 'Skyrim.esm', formId: '0E732A' }),
  'skyrim.esm|0D2336': Object.freeze({ spell: 'skyrim.esm|0E5F58', plugin: 'Skyrim.esm', formId: '0E5F58' }),
  'skyrim.esm|0D2337': Object.freeze({ spell: 'skyrim.esm|0E7329', plugin: 'Skyrim.esm', formId: '0E7329' }),
  'skyrim.esm|0D2338': Object.freeze({ spell: 'skyrim.esm|0E7328', plugin: 'Skyrim.esm', formId: '0E7328' }),
  'skyrim.esm|0D2339': Object.freeze({ spell: 'skyrim.esm|0E5F61', plugin: 'Skyrim.esm', formId: '0E5F61' })
});

const STONE_FORM_IDS = Object.freeze(Object.fromEntries(
  Object.entries(STONES).map(([key, stone]) => [`${key.slice(key.lastIndexOf('|') + 1)}:Skyrim.esm`, key])
));
const SOURCE = Object.freeze({ kind: 'STANDING_STONE', key: 'standing-stone-choice' });
const ACTIVE_USER_LIMIT = 10;
const ACTIVE_POLL_MS = 1000;
const SPAWN_RESEND_GAP_MS = 3000;
const CREATE_TABLES_SQL = `
  CREATE TABLE IF NOT EXISTS spike_standing_stone_choices (
    character_key text PRIMARY KEY,
    stone_key text NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS spike_standing_stone_commands (
    request_id text PRIMARY KEY,
    character_key text NOT NULL,
    stone_key text NOT NULL,
    result jsonb NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now()
  );
  CREATE TABLE IF NOT EXISTS spike_standing_stone_projections (
    character_key text PRIMARY KEY,
    grants jsonb NOT NULL,
    updated_at timestamptz NOT NULL DEFAULT now()
  );`;

function spellGrant(stoneKey) {
  const stone = STONES[stoneKey];
  if (!stone) return [];
  return [stone.spell, ...(stone.additionalSpells ?? []).map(spell => spell.stableFormKey)]
    .map(stableFormKey => ({
      kind: 'spell', definition: { stableFormKey, recordType: 'SPEL' }, source: SOURCE
    }));
}

/** Pure spike composition: a single record-backed spell with explicit provenance. */
export function composeStandingStoneGrants(stoneKey) {
  return Object.freeze(spellGrant(stoneKey).map(grant => Object.freeze({
    ...grant,
    definition: Object.freeze(grant.definition),
    source: SOURCE
  })));
}

function grantIdentity(grant) {
  return `${grant.kind}|${grant.definition.stableFormKey}|${grant.source.kind}|${grant.source.key}`;
}

/** Pure source-aware difference. Other origins prevent removal of a shared spell. */
export function planGrantProjection(previous, next) {
  const oldGrants = Array.isArray(previous) ? previous : [];
  const newGrants = Array.isArray(next) ? next : [];
  const oldIdentities = new Set(oldGrants.map(grantIdentity));
  const newIdentities = new Set(newGrants.map(grantIdentity));
  const hasSpell = (grants, key) => grants.some(grant => grant.kind === 'spell' && grant.definition.stableFormKey === key);
  const removed = oldGrants.filter(grant => grant.kind === 'spell'
    && !newIdentities.has(grantIdentity(grant))
    && !hasSpell(newGrants, grant.definition.stableFormKey));
  const added = newGrants.filter(grant => grant.kind === 'spell'
    && !oldIdentities.has(grantIdentity(grant))
    && !hasSpell(oldGrants, grant.definition.stableFormKey));
  return Object.freeze({ removed: Object.freeze(removed), added: Object.freeze(added) });
}

function parseGrants(value) {
  if (Array.isArray(value)) return value;
  if (typeof value === 'string') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return [];
}

function safeCall(log, fn) {
  try { return fn(); } catch (error) {
    log.info(`[standing-stone] Papyrus call failed: ${error instanceof Error ? error.message : String(error)}`);
    throw error;
  }
}

export function createStandingStoneSpike({ mp, pg, log }) {
  const pool = pg.init();
  const stoneRuntimeIds = new Map();
  const spellRuntimeIds = new Map();
  const activeActors = new Map();
  let previousOnActivate;
  let activateHandler;
  let pollTimer;
  let initialized = false;
  let polling = false;
  let requestSequence = 0;

  function actorRef(actorId) {
    return { type: 'form', desc: mp.getDescFromId(actorId) };
  }

  function spellRef(grant) {
    const key = grant.definition.stableFormKey;
    const runtimeId = spellRuntimeIds.get(key);
    if (!runtimeId) throw new Error(`UNSUPPORTED spell mapping ${key}`);
    return { type: 'espm', desc: mp.getDescFromId(runtimeId) };
  }

  function papyrus(method, actorId, grant) {
    const args = method === 'AddSpell' ? [spellRef(grant), false] : [spellRef(grant)];
    return safeCall(log, () => mp.callPapyrusFunction('method', 'Actor', method, actorRef(actorId), args));
  }

  function dispatchDiff(actorId, diff) {
    for (const grant of diff.removed) papyrus('RemoveSpell', actorId, grant);
    for (const grant of diff.added) papyrus('AddSpell', actorId, grant);
  }

  async function withCharacterLock(characterKey, action) {
    const client = await pool.connect();
    let locked = false;
    try {
      await client.query('SELECT pg_advisory_lock(hashtextextended($1, 0))', [characterKey]);
      locked = true;
      return await action(client);
    } finally {
      if (locked) {
        try { await client.query('SELECT pg_advisory_unlock(hashtextextended($1, 0))', [characterKey]); }
        catch (error) { log.info(`[standing-stone] advisory unlock failed: ${error instanceof Error ? error.message : String(error)}`); }
      }
      client.release();
    }
  }

  async function loadProjection(client, characterKey) {
    const result = await client.query(
      'SELECT grants FROM spike_standing_stone_projections WHERE character_key = $1', [characterKey]);
    return parseGrants(result.rows[0]?.grants);
  }

  async function saveProjection(client, characterKey, grants) {
    await client.query(`
      INSERT INTO spike_standing_stone_projections (character_key, grants)
      VALUES ($1, $2::jsonb)
      ON CONFLICT (character_key) DO UPDATE
        SET grants = EXCLUDED.grants, updated_at = now()`, [characterKey, JSON.stringify(grants)]);
  }

  /** requestId is durable idempotency; projection happens only for its first commit. */
  async function chooseStandingStone({ requestId, characterKey, stone, actorId }) {
    if (typeof requestId !== 'string' || !requestId.trim()) throw new TypeError('requestId is required');
    if (typeof characterKey !== 'string' || !characterKey.trim()) throw new TypeError('characterKey is required');
    if (!STONES[stone]) throw new Error(`UNSUPPORTED standing stone ${String(stone)}`);

    return withCharacterLock(characterKey, async client => {
      await client.query('BEGIN');
      try {
        const prior = await client.query(
          'SELECT character_key, stone_key, result FROM spike_standing_stone_commands WHERE request_id = $1', [requestId]);
        if (prior.rows.length) {
          const row = prior.rows[0];
          if (row.character_key !== characterKey || row.stone_key !== stone) {
            throw new Error('IDEMPOTENCY_KEY_REUSED with different standing-stone command');
          }
          await client.query('COMMIT');
          return Object.freeze({ ...row.result, duplicate: true });
        }

        const previous = await client.query(
          'SELECT stone_key FROM spike_standing_stone_choices WHERE character_key = $1 FOR UPDATE', [characterKey]);
        const previousStone = previous.rows[0]?.stone_key ?? null;
        await client.query(`
          INSERT INTO spike_standing_stone_choices (character_key, stone_key)
          VALUES ($1, $2)
          ON CONFLICT (character_key) DO UPDATE
            SET stone_key = EXCLUDED.stone_key, updated_at = now()`, [characterKey, stone]);
        const result = Object.freeze({ requestId, characterKey, previousStone, stone, duplicate: false });
        await client.query(`
          INSERT INTO spike_standing_stone_commands (request_id, character_key, stone_key, result)
          VALUES ($1, $2, $3, $4::jsonb)`, [requestId, characterKey, stone, JSON.stringify(result)]);
        const beforeProjection = await loadProjection(client, characterKey);
        await client.query('COMMIT');

        const nextProjection = composeStandingStoneGrants(stone);
        dispatchDiff(actorId, planGrantProjection(beforeProjection, nextProjection));
        await client.query('BEGIN');
        await saveProjection(client, characterKey, nextProjection);
        await client.query('COMMIT');
        log.info(`[standing-stone] command recorded and projection sent: stone=${stone} character=${characterKey}`);
        return result;
      } catch (error) {
        try { await client.query('ROLLBACK'); } catch { /* retain original error */ }
        throw error;
      }
    });
  }

  async function rehydrate(characterKey, actorId) {
    return withCharacterLock(characterKey, async client => {
      const fact = await client.query(
        'SELECT stone_key FROM spike_standing_stone_choices WHERE character_key = $1', [characterKey]);
      const stone = fact.rows[0]?.stone_key;
      if (!stone || !STONES[stone]) return Object.freeze({ characterKey, grants: [] });
      const previous = await loadProjection(client, characterKey);
      const next = composeStandingStoneGrants(stone);
      dispatchDiff(actorId, planGrantProjection(previous, next));
      await client.query('BEGIN');
      await saveProjection(client, characterKey, next);
      await client.query('COMMIT');
      return Object.freeze({ characterKey, stone, grants: next });
    });
  }

  function resendAfterSpawn(characterKey, actorId) {
    const timer = setTimeout(async () => {
      if (activeActors.get(actorId) !== characterKey) return;
      try {
        const client = await pool.connect();
        try {
          const fact = await client.query(
            'SELECT stone_key FROM spike_standing_stone_choices WHERE character_key = $1', [characterKey]);
          const grants = composeStandingStoneGrants(fact.rows[0]?.stone_key);
          for (const grant of grants) papyrus('RemoveSpell', actorId, grant);
          for (const grant of grants) papyrus('AddSpell', actorId, grant);
        } finally { client.release(); }
      } catch (error) {
        log.info(`[standing-stone] spawn resend failed for provisional character ${characterKey}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }, SPAWN_RESEND_GAP_MS);
    if (typeof timer.unref === 'function') timer.unref();
  }

  function characterKeyForActor(actorId) {
    const profileId = typeof mp.get === 'function' ? mp.get(actorId, 'profileId') : undefined;
    if (!Number.isSafeInteger(profileId) || profileId <= 0) return null;
    return `profile:${profileId}`;
  }

  async function scanActiveActors() {
    if (polling || typeof mp.isConnected !== 'function' || typeof mp.getUserActor !== 'function') return;
    polling = true;
    try {
      const seen = new Set();
      for (let userId = 1; userId <= ACTIVE_USER_LIMIT; userId += 1) {
        if (!mp.isConnected(userId)) continue;
        const actorId = mp.getUserActor(userId);
        if (!Number.isSafeInteger(actorId) || actorId <= 0) continue;
        const characterKey = characterKeyForActor(actorId);
        if (!characterKey) continue;
        seen.add(actorId);
        if (activeActors.get(actorId) === characterKey) continue;
        activeActors.set(actorId, characterKey);
        log.info(`[standing-stone] active actor associated: character=${characterKey}`);
        try {
          await rehydrate(characterKey, actorId);
          resendAfterSpawn(characterKey, actorId);
        } catch (error) {
          log.info(`[standing-stone] rehydration failed for provisional character ${characterKey}: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      for (const actorId of activeActors.keys()) if (!seen.has(actorId)) activeActors.delete(actorId);
    } finally { polling = false; }
  }

  function activation(targetId, casterId) {
    const stone = [...stoneRuntimeIds].find(([, runtimeId]) => runtimeId === targetId)?.[0] ?? null;
    if (!stone || !STONES[stone] || !stoneRuntimeIds.has(stone)) {
      return typeof previousOnActivate === 'function' ? previousOnActivate(targetId, casterId) : undefined;
    }

    const characterKey = characterKeyForActor(casterId);
    if (!characterKey) {
      log.info(`[standing-stone] activation vetoed: no provisional active-character key for actor ${casterId}`);
      return false;
    }
    log.info(`[standing-stone] activation recognized: stone=${stone} character=${characterKey}`);
    requestSequence += 1;
    const requestId = `standing-stone:${Date.now()}:${casterId}:${requestSequence}`;
    void chooseStandingStone({ requestId, characterKey, stone, actorId: casterId })
      .catch(error => log.info(`[standing-stone] activation persisted/projection failed for request ${requestId}: ${error instanceof Error ? error.message : String(error)}`));
    return false;
  }

  async function initialize() {
    if (initialized) return;
    for (const [descriptor, stone] of Object.entries(STONE_FORM_IDS)) {
      try {
        const runtimeId = mp.getIdFromDesc(descriptor);
        if (Number.isSafeInteger(runtimeId) && runtimeId > 0) stoneRuntimeIds.set(stone, runtimeId);
      } catch { /* missing load-order records remain explicitly unsupported */ }
    }
    for (const stone of Object.values(STONES)) {
      const records = [{ stableFormKey: stone.spell, plugin: stone.plugin, formId: stone.formId }, ...(stone.additionalSpells ?? [])];
      for (const record of records) {
        try {
          const runtimeId = mp.getIdFromDesc(`${record.formId}:${record.plugin}`);
          if (Number.isSafeInteger(runtimeId) && runtimeId > 0) spellRuntimeIds.set(record.stableFormKey, runtimeId);
        } catch { /* missing load-order records remain explicitly unsupported */ }
      }
    }
    const unsupported = Object.entries(STONES).filter(([key, stone]) => !stoneRuntimeIds.has(key)
      || [stone.spell, ...(stone.additionalSpells ?? []).map(spell => spell.stableFormKey)]
        .some(spellKey => !spellRuntimeIds.has(spellKey))).map(([key]) => key);
    if (unsupported.length) log.info(`[standing-stone] unsupported winner/load-order mappings: ${unsupported.join(', ')}`);

    const client = await pool.connect();
    try { await client.query(CREATE_TABLES_SQL); }
    finally { client.release(); }

    previousOnActivate = mp.onActivate;
    activateHandler = activation;
    mp.onActivate = activateHandler;
    pollTimer = setInterval(() => { void scanActiveActors(); }, ACTIVE_POLL_MS);
    if (typeof pollTimer.unref === 'function') pollTimer.unref();
    initialized = true;
    await scanActiveActors();
  }

  function shutdown() {
    if (pollTimer) clearInterval(pollTimer);
    pollTimer = undefined;
    if (mp.onActivate === activateHandler) mp.onActivate = previousOnActivate;
    activeActors.clear();
    initialized = false;
  }

  return Object.freeze({ initialize, shutdown, chooseStandingStone, rehydrate });
}

export const standingStoneDefinitions = STONES;
