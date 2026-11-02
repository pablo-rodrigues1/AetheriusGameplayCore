# DS-5a: physical shadow with prepared catalog and Core profiles

The historical S3 spike below is superseded for host installation by ds5a/Host.h.
It remains available only to its standalone regression tests. Current settings:

```json
{"aetheriusCombat":{"families":{"melee":"shadow","ranged":"shadow","unarmed":"shadow"},"multipliers":{"pve":1,"pvp":1}}}
```

Absent families/off installs the existing TES5 chain without a DS-5a wrapper.
active is recognized but returns UNSUPPORTED / ACTIVE_REQUIRES_DS7; it cannot apply
a candidate before actual hit identity and cutover certification. Old shadow and
physicalRecords settings no longer enable the installed formula.

Core boot calls setAetheriusCombatCatalog(json): effective combat records, stable
keys plus boot-resolved ids, GMST winners and preserved record ENCH DamageResist.
The accepted native table is immutable. Missing/invalid initial table is unsupported.
CombatProfileBinding converts each actor projection once per revision on publication,
never on hits. Cache uses weak owners, max 4096; null clears it, and maintenance
outside hits removes destroyed actors. Disconnected players/generation changes are
rejected. NPC requests use a fixed 2048-id queue drained by Core every 250 ms; the
first hit may be unsupported. The normalized observation binding only reads the
creature already confirmed by the host; it never changes spawn or base (Q13).

No-perk candidate: WEAP + worn AMMO / RACE unarmed, profile skills, winning GMST
Scaling (weapon +0.5%, armor +0.4% on the installed winners), absolute Q4 curve,
record DamageResist once outside Scaling/Q16, native block state plus blocked flag,
PvE/PvP G and neutral RefinementTierProvider (0). It does not certify block geometry.
Q16 contributes zero with an explicit unsupported mask. Perks, critical, power,
sneak and bash bonuses are excluded pending DS-5b. Invalid numbers keep legacy damage.

getAetheriusCombatCapabilities() returns ownership/modes per family; Core verifies it.
getAetheriusCombatShadow() returns a JSON string only on request: last 1024 samples,
profile revisions, components, status/reason, Q16/refinement and conversion counter.
Hit code uses no JSON, I/O or per-hit logging. Buffer sequence is not hit identity.

DS-7 hit identity (Aetherius, 27/10/2026): HitMessage carries `hitSeq`, a number the
client increments on every OnHit. ActionListener::OnHit keeps one HitSequenceWindow
per connection (UserInfo; highest number + previous 1023) and drops a repeated
number (DUPLICATE_HIT_SEQ) or one older than the window (STALE_HIT_SEQ) before any
other check. A hit without `hitSeq` (outdated client) is rejected (NO_HIT_SEQ, one
warning per connection). The window resets on reconnect; no time-based expiry.
Trace: hitIdentity HOST_DEDUPED_CLIENT_HIT_SEQ plus `hitSeq` per sample.
Limit: this stops the same message being applied twice. It does not merge two
game hit events for one swing, nor a client inventing new numbers; splash/CanHit
and the DS-5b attack evidence still cover those. active remains blocked
(ACTIVE_REQUIRES_DS7) until two-client application is certified.

Native acceptance: aetherius-shadow-test --ds5a <loadorder-manifest>. Benchmark
reports median/p99 of 20,001 individual hits after warmup, with the full real legacy chain.
Core source mirror: modules/damage-system/server/server/cpp/server_guest_lib/aetherius_combat/ds5a/.
The isolated local-server script runtime/tests/ds5a-host.mjs is prepared for Opus;
no local server or Skyrim game session was run by the implementer.

---

## Historical S3 documentation (superseded above)

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

## DS-5b — extensão do candidato shadow

`ds5a/Rules.h` converte o compiled CLASS por revisão e avalia as nove condições DS-3;
`Physical.h::FinishPerks` aplica os entry points físicos, crítico separado e caps;
`NativeRecords.h::HydrateNative` carrega tipos/CRDT/template e GMST de forte no boot;
`AttackEvidence.h` mantém a confirmação limitada por ator, hoster e geração.
`ActionListener::OnUpdateAnimation` só registra após a autorização existente.

Perks UNSUPPORTED inteiras, origens não CLASS, Q15/Q16, furtivo, fórmula de bash e
combinações de operações não comutativas sem prova de ordem são recusados explicitamente.
Forte exige flag e animação exata recente (1500 ms); evento desconhecido é convencional.
RNG do servidor tem estado/draw no trace; chance sem provider certificado fica zero.
Nenhuma mudança de ownership aplicado, opção nova ou cutover. active exige DS-7.

Aceites sem sockets: aetherius-shadow-test --ds5b <manifest> <DS5B_GOLDEN_RULES.json>,
--ds5a e as suítes existentes. Corpus/runner dourado e espelho estão no Core.
Detalhes, fontes e limitações em modules/damage-system/docs/FONTES_E_DONOS.md §15;
evidências em _work/evidence/DS-5b. Build autorizado somente build/ds5b-server.
