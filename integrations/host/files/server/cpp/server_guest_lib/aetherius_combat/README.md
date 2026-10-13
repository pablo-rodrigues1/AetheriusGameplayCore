# A6-S3: physical damage shadow spike

This disposable spike wraps the existing TES5 -> DamageMult -> SweetPieDamage ->
SweetPieSpell -> DamageMultConditional chain. It always returns that chain's
result. Candidate exceptions, unsupported contexts and invalid numbers affect
only shadow diagnostics. Spell calculations call only the existing chain.

Enable in the local `build/dist/server/server-settings.json`, then restart:

```json
{
  "aetheriusCombat": {
    "shadow": true,
    "physicalRecords": ["Skyrim.esm:01397E", "Skyrim.esm:012E46"]
  }
}
```

These two keys select the laboratory equipment; their values come from the
host's load-order winners. The list is explicit because the current libespm
type enumeration does not support WEAP/ARMO. Configure every weapon and armor
used in a shadow session. A missing prepared record yields `UNSUPPORTED`, never
a substituted damage. Startup rejects missing plugins/records, duplicate keys,
nonphysical records and lists larger than 4096. The immutable prepared table is
runtime-local; no runtime FormID is persisted as record identity.

Disable with `shadow: false` or remove `aetheriusCombat`, then restart. This
constructs exactly the previous chain and adds no candidate or diagnostic API.
Rebuilding can overwrite local settings: run `server/tools/sync-client-plugins.js`
against the correct MO2 instance again, then restore this local setting.

## Reading diagnostics

When enabled, `mp.getAetheriusCombatShadow()` returns a JSON **string**. Call it
on request outside the hit path, on the same server thread:

```js
const snapshot = JSON.parse(mp.getAetheriusCombatShadow());
```

The non-destructive snapshot contains the latest 1024 physical hits in sequence
order, overwrite count, cumulative failure counters and `neutralProfile: true`
on every sample. Status is `CALCULATED`, `UNSUPPORTED`, `EXCEPTION` or `INVALID`.
Failed candidates serialize as `null`. `failures` counts exceptions and invalid
numbers; `unsupported` is a separate counter. Reasons: 0 none, 1 unarmed race
snapshot, 2 source not equipped, 3 missing prepared record, 4 weapon data/type,
5 enchanted armor, 6 equipment capacity, 7 duplicate weapon, 8 magic.

JSON allocation happens only in the requested read. Recording uses one fixed
`std::array`, no per-hit logging, no callback and no retained actor pointers.
There is no concurrent reader support; the host calls the formula and JS on its
server thread. Output consumers must cap their own retention. Existing host
logging and network/resource application are preserved by the spike.

## Candidate limits

The copied physical pipeline uses an explicit empty profile: no skills or perks,
revision zero, no effective resource attributes, no item or actor providers,
critical chance zero, tracing disabled. It installs no ActorCombatState and no
effect store. A neutral candidate is an experimental comparison, not a complete
or certified result. Skills, grants and revision must eventually come from
ActorState via CombatProfileProjection. Runtime resources stay with the host.

Equipment is read by const reference from the host, with at most 64 entries per
actor. Weapon must be worn exactly once. Enchanted armor and unknown prepared
records are unsupported. Unarmed is unsupported until a bounded native race
snapshot is available; the current GetRaceId accessor can parse appearance on a
hit. Magical weapon contributions, ammo, critical data, refinement and other
providers are not evaluated by this physical-only experiment.

Power/sneak/bash packet flags grant no candidate bonus. Blocking requires both
the hit flag and native Block state; this retains the original candidate rule
but does not certify block geometry or client combat DLL semantics.

## Reproduction and source provenance

### FIX-1010 safety audit (10 October 2026)

`--npc <manifest>` in the existing standalone runner exercises the actual
`0422B4:Skyrim.esm` NPC, hosted by a player, without opening a socket. Its raw
race is `109C7C:Skyrim.esm`; native UseTraits template resolution selects
`0131FA:Skyrim.esm`, matching the session warning. The pre-fix reproduction did
not produce an access violation. The crash remains unconfirmed; keep both
weaponPoison and shadow disabled pending independent review and game evidence.

D-P1 now requires a native player actor with an associated user, a world with
records and resolvable hit/effect sources. NPC attackers never enter poison.
Effect timers retain weak source and target references, validate the user again
and stop after disconnect/destruction. Resource publication refuses an absent
connected recipient before changing resources. Equipment publications deduplicate
recipients after hoster resolution; an NPC listener cannot echo to the owner.
NPC equipment packets retain the maintainer forwarding path.

The shadow adapter retains values from records at construction; on hits it reads
equipment by const reference and uses bounded maps/buffers. It does not use
GetParent, GetActorToSendTo, GetIdx, inventory, user callbacks or effect timers
in its candidate calculation. Candidate exceptions are ordinary C++ exceptions;
the wrapper does not intercept Windows access violations. NPC and detached-actor
candidate cases are covered without enabling shadow in the local server. Nothing
in this audit establishes a common cause with the 7 October crash, destroyActor
or Papyrus Activate. Full findings and command output: `_work/evidence/FIX-1010/`.

Configure the existing build with `-DAETHERIUS_SHADOW_TESTS=ON` and build Release
targets `skymp5-server` and `aetherius-shadow-test`. Execute
`build/server/cpp/Release/aetherius-shadow-test.exe` with the absolute path to
`build/dist/server/data/aetherius-loadorder.json`. The isolated runner avoids
generating Papyrus fixtures outside the order's allowed paths. It also registers
as a Catch test if the full unit suite is built separately.

Eight headers are byte-for-byte copies from GameplayCore's damage-system:
CombatSettings, DamageContext, CombatTrace, StableFormKey, ActorCombatState,
PerkRegistry, ArmorCurve and PhysicalDamagePipeline. The AetheriusDamageFormula
host adapter is rewritten for this neutral, bounded spike. Providers, equipment
cache, ActiveEffectStore, magic pipeline, metrics, audited perk catalogue and the
old integration patches are not installed. Historical damage-system integration
instructions do not describe this host spike; this file and the A6-S3 report do.

Evidence and delivery report live in the workspace's `_work/evidence/A6-S3/`
and `_work/orders/A6-S3-formula-dano-shadow.result.md`. No game session or
production cutover is certified by automated acceptance.
