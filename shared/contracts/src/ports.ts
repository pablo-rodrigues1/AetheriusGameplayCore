import type { PortResult, ConditionResult } from './capabilities.js';
import type { ActorRef, CatalogSignature, CharacterKey, DefinitionRef, PluginKind, RuntimeFormId, SessionBinding, StableFormKey } from './identity.js';
import type { GrantProjection, GrantProjectionAck } from './grants.js';
import type { JsonObject, CommandResult } from './messages.js';
import type { RevisionVector } from './revisions.js';

export type Unsubscribe = () => void;

export interface IdentityPort {
  /** Host authenticates profile -> character -> actor. Missing durable mapping is
   * UNSUPPORTED; offline client profile numbers do not establish this identity. */
  lookup(actor: ActorRef): PortResult<SessionBinding>;
  /** Checks the whole live binding; must be repeated after an await. This does
   * not reserve the session against future disconnect or character change. */
  isCurrent(binding: SessionBinding): boolean;
}

export interface CatalogEntry {
  readonly definition: DefinitionRef;
  readonly winnerPlugin: string;
  /** Kind of the defining plugin, not of the winning override. */
  readonly pluginKind: PluginKind;
  /** Detached immutable DTO. Domain-specific schema validation is still required. */
  readonly data: JsonObject;
}
export interface RecordCatalogPort {
  /** Memory-only lookup of the reconciled load-order winner, pinned to signature.
   * Missing record, mismatched type/signature or unreconciled catalog is UNSUPPORTED.
   * Existence does not certify effect, script, DLL or condition semantics. */
  lookup(definition: DefinitionRef): PortResult<CatalogEntry>;
  /** Boot-built memory mapping. FF/dynamic, absent records and signature mismatch
   * are UNSUPPORTED. The returned runtime id must never be persisted. */
  resolve(key: StableFormKey, signature: CatalogSignature): PortResult<RuntimeFormId>;
}

export interface ProjectionReceipt {
  readonly binding: SessionBinding;
  readonly revision: RevisionVector;
}
export interface GrantProjectionPort {
  /** Publishes the complete source-aware set. Host checks character/binding,
   * coherent revision and catalog. Equal revision + same set is idempotent;
   * equal revision + different set is invalid; stale/incomparable revisions are
   * rejected. Queuing success is not ACK, commit or proof of client effect results.
   * Reconcile by difference; removing one source retains other sources and native
   * grants. Never remove-all. Empty set revokes only grants managed by this port. */
  publish(projection: GrantProjection): Promise<PortResult<ProjectionReceipt>>;
  /** Host authenticates the ACK sender and matches the whole binding and exact
   * published revision. Old-session or stale ACKs cannot confirm current state.
   * ACK remains client delivery evidence; caller owns retry/timeout policy. */
  onAck(listener: (ack: GrantProjectionAck) => void): Unsubscribe;
}

export type Resource = 'health' | 'magicka' | 'stamina';
export interface ResourceValue { readonly resource: Resource; readonly current: number; readonly maximum: number }
export interface ResourceSnapshot {
  readonly binding: SessionBinding;
  readonly revision: number;
  readonly values: readonly ResourceValue[];
}
/** Trusted Core -> host request. Never a client command payload. */
export interface ResourceMutation {
  readonly requestId: string;
  readonly binding: SessionBinding;
  readonly expectedRevision: number;
  readonly resource: Resource;
  readonly delta: number;
}
export interface ResourceMutationReceipt {
  readonly requestId: string;
  readonly binding: SessionBinding;
  readonly revision: number;
}
export interface ResourcePort {
  /** Coherent memory snapshot from the unique runtime resource owner, in absolute
   * units. Missing effective bases/authority is UNSUPPORTED; replicated client
   * percentages alone do not prove a server-authoritative resource capability. */
  snapshot(binding: SessionBinding): PortResult<ResourceSnapshot>;
  /** Synchronous memory-only atomic mutation with revision/session checks and
   * duplicate request suppression for the session. Host enforces resource bounds
   * and no competing writer. This is runtime application, not durable DB commit. */
  apply(mutation: ResourceMutation): PortResult<ResourceMutationReceipt>;
}

export interface ClientHitEvidence {
  readonly trust: 'CLIENT_EVIDENCE';
  readonly binding: SessionBinding;
  readonly occurrenceId: string;
  readonly aggressor: ActorRef;
  readonly target: ActorRef;
  readonly source: RuntimeFormId;
  readonly projectile: RuntimeFormId | null;
  readonly flags: {
    readonly power: boolean; readonly sneak: boolean;
    readonly bash: boolean; readonly blocked: boolean;
  };
}
/** Server asserts only these checks, not the truth of reported flags/occurrence. */
export interface ServerHitFacts {
  readonly trust: 'SERVER_VALIDATED';
  readonly hitId: string;
  readonly binding: SessionBinding;
  readonly target: ActorRef;
  readonly source: DefinitionRef<'WEAP' | 'SPEL' | 'RACE'>;
  readonly revision: RevisionVector;
  readonly checks: {
    readonly senderAuthorized: true;
    readonly actorsEligible: true;
    readonly sameWorld: true;
    readonly sourceAuthorized: true;
    readonly cooldownAccepted: true;
  };
}
export interface CombatApplication {
  readonly requestId: string;
  readonly facts: ServerHitFacts;
  readonly owner: 'AETHERIUS_SERVER' | 'NATIVE_SERVER';
  /** Computed by the certified server owner, never copied from client evidence. */
  readonly damage: number;
}
export interface CombatReceipt { readonly requestId: string; readonly hitId: string; readonly applied: boolean; readonly reason: string }
export interface NativeCombatPort {
  /** Host validates against one coherent memory snapshot; missing context or
   * uncertified family is UNSUPPORTED. This never promotes client flags to facts.
   * No I/O, callbacks or promises on the hit path. */
  validate(evidence: ClientHitEvidence): PortResult<ServerHitFacts>;
  /** Single-owner, memory-only application at most once per hitId/requestId.
   * Checks live epoch/revision and certification; shadow never applies.
   * Rejected/duplicate application is explicit in the receipt. No durable commit. */
  apply(application: CombatApplication): PortResult<CombatReceipt>;
  /** Memory-only certified evaluator; unknown function/context -> UNSUPPORTED,
   * malformed -> INVALID. Host's unknown-as-true evaluator is incompatible. */
  evaluateCondition(definition: DefinitionRef, facts: ServerHitFacts): ConditionResult;
}

export interface DeathParticipant { readonly actorRef: ActorRef; readonly characterKey: CharacterKey | null }
export interface NativeDeathFact {
  readonly eventId: string;
  readonly victim: DeathParticipant;
  readonly killer: DeathParticipant | null;
  readonly spawnGeneration: string;
  readonly sequence: number;
  readonly occurredAt: number;
}
export interface NativeDeathPort {
  /** Host-origin accepted death with generation/sequence; eventId is stable on
   * retry. Killer null means uncredited, not an inferred environmental cause.
   * Unknown NPC CharacterKey stays null; never invent one from actorId.
   * No XP here; downstream durable inbox/ledger deduplicates and assigns rewards.
   * This callback does not guarantee DB persistence or exactly-once delivery. */
  onDeath(listener: (fact: NativeDeathFact) => void): Unsubscribe;
}

export interface InventoryItemChange {
  readonly instanceKey: string;
  readonly definition: DefinitionRef;
  /** Exact owner-managed item/extradata identity; no baseId-only approximation. */
  readonly extraData: JsonObject;
  readonly countDelta: number;
}
export interface InventoryTransaction {
  readonly requestId: string;
  readonly characterKey: CharacterKey;
  readonly expectedRevision: number;
  readonly items: readonly InventoryItemChange[];
  readonly goldDelta: number;
}
export interface InventoryReservation { readonly requestId: string; readonly reservationId: string }
export interface InventoryTransactionPort {
  /** Delegates to the existing transaction-service owner, using the gamemode
   * pool/ledger. Reserves exact instances and validates balance/ownership; same
   * requestId + payload is idempotent, changed payload conflicts. UNSUPPORTED if
   * atomic native/DB recovery cannot be guaranteed. Prepare is not success/commit. */
  prepare(transaction: InventoryTransaction): Promise<PortResult<InventoryReservation>>;
  /** accepted only after durable commit and recorded recoverable native projection;
   * pending means delivery is unresolved. Never absorb a native delivery failure
   * as success. Host owns recovery, locking and the one inventory; no new ledger. */
  commit(reservation: InventoryReservation): Promise<CommandResult>;
  /** Returns durable outcome for the same request, resumes projection idempotently;
   * does not create another transaction or re-add saved inventory on reconnect. */
  recover(requestId: string): Promise<CommandResult>;
  /** Releases an uncommitted reservation idempotently. A committed reservation
   * cannot be cancelled or compensated implicitly; reports explicit rejection. */
  cancel(reservation: InventoryReservation): Promise<CommandResult>;
}

export interface ClockReading {
  readonly generation: string;
  readonly monotonicMs: number;
  readonly unixMs: number;
}
export interface ClockPort {
  /** Memory-only server clock; monotonic only within generation. unixMs can jump,
   * so never compare monotonic times across restart or use wall time for hit rate.
   * No client timestamp, file access or network synchronization in this method. */
  read(): ClockReading;
}
export interface RngRequest { readonly streamKey: string; readonly drawIndex: number }
export interface RngPort {
  /** Memory-only server RNG, [0,1); same server seed/version + stream + draw index
   * reproduces the value. No client seed, hidden global draw order or Math.random
   * fallback. Unsupported deterministic RNG must be declared explicitly. */
  draw(request: RngRequest): PortResult<number>;
}
