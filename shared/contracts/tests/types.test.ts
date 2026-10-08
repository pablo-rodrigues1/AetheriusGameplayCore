import type {
  ActorRef, ProfileKey, CharacterKey, StableFormKey, RuntimeFormId, SessionBinding,
  GrantSet, CommandEnvelope, EventEnvelope, JsonObject, ClientHitEvidence, ServerHitFacts,
  NativeCombatPort, Grant, ResourceSnapshot,
} from '../src/index.js';

declare const actor: ActorRef;
declare const profile: ProfileKey;
declare const character: CharacterKey;
declare const runtime: RuntimeFormId;
declare const binding: SessionBinding;
declare const grants: GrantSet;
declare const evidence: ClientHitEvidence;
declare const combat: NativeCombatPort;
declare const resource: ResourceSnapshot;
// @ts-expect-error Runtime actor cannot become durable character identity.
const badCharacter: CharacterKey = actor;
// @ts-expect-error Account/profile identity is distinct from character identity.
const badProfile: CharacterKey = profile;
// @ts-expect-error Character identity is distinct from account/profile identity.
const badAccount: ProfileKey = character;
// @ts-expect-error A raw number is never a stable record identity.
const badKey: StableFormKey = 0x01000800;
// @ts-expect-error Runtime FormID cannot be persisted as stable record identity.
const badRuntimeKey: StableFormKey = runtime;
// @ts-expect-error Unvalidated raw runtime number must cross a host/schema boundary.
const badActor: ActorRef = { actorId: 42 };
// @ts-expect-error Session DTO is readonly.
binding.epoch = binding.epoch;
// @ts-expect-error Nested actor DTO is readonly.
binding.actorRef.actorId = runtime;
// @ts-expect-error Revision vector is readonly.
grants.revision.facts = 9;
// @ts-expect-error Grant list is readonly.
grants.grants.push(grants.grants[0]!);
// @ts-expect-error Client flags are readonly.
evidence.flags.power = true;
// @ts-expect-error Evidence cannot be treated as validated server facts.
const badFacts: ServerHitFacts = evidence;
// @ts-expect-error Combat application cannot accept raw evidence as its facts.
combat.apply({ requestId: 'r', facts: evidence, owner: 'AETHERIUS_SERVER', damage: 2 });
// @ts-expect-error Resource DTOs expose no mutable internal state.
resource.values[0]!.current = 0;
declare const dto: JsonObject;
// @ts-expect-error Raw JSON object projection is readonly.
dto['value'] = 3;
declare const cmd: CommandEnvelope<'intent', { list: { value: number }[] }>;
// @ts-expect-error Generic command payload is recursively readonly.
cmd.payload.list[0]!.value = 2;
// @ts-expect-error Generic command list is readonly.
cmd.payload.list.push({ value: 2 });
declare const event: EventEnvelope<'fact', { nested: { value: number } }>;
// @ts-expect-error Generic event payload is recursively readonly.
event.payload.nested.value = 2;
declare const grant: Grant;
if (grant.kind === 'perk') {
  const type: 'PERK' = grant.definition.recordType;
  const rank: number = grant.rank;
  void [type, rank];
} else if (grant.kind === 'spell') {
  const type: 'SPEL' = grant.definition.recordType;
  // @ts-expect-error Spell grant has no perk rank.
  const rank: number = grant.rank;
  void [type, rank];
}
void [badCharacter, badProfile, badAccount, badKey, badRuntimeKey, badActor, badFacts];
