import type { CharacterKey, SessionEpoch } from './identity.js';
import type { RevisionVector } from './revisions.js';
export type JsonPrimitive = null | boolean | number | string;
export type JsonValue = JsonPrimitive | JsonObject | readonly JsonValue[];
export interface JsonObject { readonly [key: string]: JsonValue }
export type DeepReadonly<T> = T extends readonly unknown[]
  ? { readonly [K in keyof T]: DeepReadonly<T[K]> }
  : T extends object ? { readonly [K in keyof T]: DeepReadonly<T[K]> } : T;
export interface CommandEnvelope<Type extends string = string, Payload extends JsonValue = JsonValue> {
  readonly requestId: string;
  readonly characterKey: CharacterKey;
  readonly epoch: SessionEpoch;
  readonly expectedRevision?: RevisionVector;
  readonly type: Type;
  readonly payload: DeepReadonly<Payload>;
}
interface ResultBase { readonly requestId: string; readonly reason: string }
export type CommandResult =
  | (ResultBase & { readonly status: 'accepted'; readonly revision: RevisionVector })
  | (ResultBase & { readonly status: 'rejected' })
  | (ResultBase & { readonly status: 'conflict'; readonly actualRevision: RevisionVector })
  | (ResultBase & { readonly status: 'pending' });
/** Durable facts only: emitted via outbox after transaction commit. */
export interface EventEnvelope<Type extends string = string, Payload extends JsonValue = JsonValue> {
  readonly eventId: string;
  readonly producer: string;
  readonly version: number;
  readonly type: Type;
  readonly payload: DeepReadonly<Payload>;
}
