# A6-S2 standing-stone spike

This disposable vertical slice is behind `ENABLE_STANDING_STONE_SPIKE=true` in
the injected bundle environment. An unset or other value leaves the feature off.
The outer `ENABLE_GAMEPLAY_CORE` flag in the gamemode must also be enabled.

The catalog maps the 13 `Skyrim.esm` activators (`0D232D`–`0D2339`) to the
matching `pDoom<Stone>Ability` object properties in `STONE_ACTIVATORS.jsonl`.
The corresponding spell StableFormKeys resolve to the winners in
`MUNDUS.jsonl`. It also includes the Apprentice secondary spell linked by
`pdoomApprenticeNegativeAbility`. The exports contain 15 winning
`DoomStone.*Spell` records, but the Steed sprint spell is only linked from a
Mundus perk record; the activator export does not link that perk. This spike
therefore leaves that one record `UNSUPPORTED` rather than infer an additional
grant. The catalog covers 14 direct/explicit spell links. No localized names or
runtime FormIDs are persisted.

`chooseStandingStone` serializes each character's command and Papyrus projection
with a PostgreSQL advisory lock on a connection borrowed from the existing
`core/pg.js` pool. Its fact, request ledger, and last confirmed source grant
snapshot use `spike_` tables. A repeated request returns the ledger result and
does not project a second time. A failed database write occurs after
`onActivate` has synchronously returned `false`; native activation stays
vetoed, the failure is logged, and no local/native fallback runs. The player
must activate again after the database recovers. A projection failure leaves
the previous confirmed snapshot so a later rehydration can retry the diff.

Rehydration uses the persisted fact and snapshot. The host deletes and rebuilds
the client's learned-spell list during spawn, so the spike re-sends the current
spells by remove/add after a three-second delay. The grant difference function
is source-aware; the runtime has only the standing-stone origin until a real
ActorState supplies grants from other origins.

Identity is provisional. `phase0-basic.js` passes only `{ mp, pg, env, log }`;
it does not expose `commands.getActiveCharacterData()`. In the current local
autowhitelist path, `registerActiveCharacter` fabricates `character.id` from
`profileId`. The spike reads the actor profile directly with `mp.get(actorId, 'profileId')` and uses `profile:<profileId>` as the provisional key, following the D1 proposal. Missing, zero, negative, or invalid profile IDs veto activation and are logged. This is not the session-bound canonical `CharacterKey` and must be replaced by an identity port before a durable feature ships. The active-actor scan follows the existing host bound of users 1–10; profile IDs are not enumerated.

Activation events carry the placed reference ID, while the catalog contains
base activator IDs. The handler reads that reference's `baseDesc`, resolves it
through `mp.getIdFromDesc`, and compares the resulting runtime ID with the
catalog IDs resolved during initialization. Missing or invalid base descriptions
are delegated to the previous handler without logging.

Run the integration test from the workspace root with
`AETHERIUS_TEST_DATABASE_URL` set from `_work/db.env`:

```powershell
node --test AetheriusGameplayCore/runtime/spike-standing-stone/index.test.mjs
```

The tests truncate only the spike tables in the disposable test database.
