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
`profileId`. The spike uses that profile ID for this experiment. This is not
the canonical `CharacterKey` and must be replaced by a session-bound identity
port before a durable feature ships. The active-character scan follows the
existing local host bounds (users 1–10 and profiles 1–50).

Run the integration test from the workspace root with
`AETHERIUS_TEST_DATABASE_URL` set from `_work/db.env`:

```powershell
node --test AetheriusGameplayCore/runtime/spike-standing-stone/index.test.mjs
```

The tests truncate only the spike tables in the disposable test database.
