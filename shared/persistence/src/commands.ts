import type { CommandEnvelope, JsonValue } from '../../contracts/src/messages.js';
import { canonicalJson, freezeJson, sha256 } from './canonical.js';
import { assertCharacterKey, lockCharacter, lockKey, withTransaction } from './transaction.js';
import type { PoolPort, QueryExecutor } from './transaction.js';

/** Database receipt, not the domain's CommandResult or a client-delivery receipt. */
export type CommandReceipt<T> =
  | { readonly status: 'accepted'; readonly requestId: string; readonly replayed: boolean; readonly result: T }
  | { readonly status: 'conflict'; readonly requestId: string; readonly reason: 'REQUEST_ID_REUSED' };

// JsonValue is already readonly. Avoid expanding DeepReadonly<JsonValue> indefinitely
// in TS 5.9; retain all fixed envelope fields from the canonical contract.
export type PersistenceCommand = Omit<CommandEnvelope<string, null>, 'payload'> & { readonly payload: JsonValue };

function nonempty(value: string, name: string): void {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) throw new TypeError(`Persistence: ${name} is required`);
}

export async function executeCommand<T>(
  pool: PoolPort, input: PersistenceCommand,
  effect: (tx: QueryExecutor, command: PersistenceCommand) => Promise<T>
): Promise<CommandReceipt<T>> {
  nonempty(input.requestId, 'requestId');
  nonempty(input.type, 'type');
  nonempty(input.epoch, 'epoch');
  assertCharacterKey(input.characterKey);
  if (Object.keys(input).some(key => !['requestId', 'characterKey', 'type', 'epoch', 'payload', 'expectedRevision'].includes(key))) {
    throw new TypeError('Persistence: unexpected command envelope field');
  }
  if (input.expectedRevision !== undefined) {
    const fields = ['facts', 'grants', 'equipment', 'effects', 'catalog'];
    const revision = input.expectedRevision;
    if (revision === null || typeof revision !== 'object' || Object.keys(revision).length !== fields.length
      || fields.some(field => {
        const value = (revision as unknown as Record<string, unknown>)[field];
        return typeof value !== 'number' || !Number.isSafeInteger(value) || value < 0;
      })) throw new TypeError('Persistence: invalid expectedRevision');
  }
  // Snapshot before the first await: caller mutation cannot change hash versus effect.
  const command = freezeJson<unknown>(JSON.parse(canonicalJson(input))) as PersistenceCommand;
  const content = {
    characterKey: command.characterKey, type: command.type, payload: command.payload,
    ...(command.expectedRevision === undefined ? {} : { expectedRevision: command.expectedRevision })
  };
  // epoch is session evidence, not durable intent. Reconnect may retry the same intent.
  const hash = sha256(canonicalJson(content));
  return withTransaction(pool, async tx => {
    // Global request identity, including accidental reuse by another character.
    // Every caller takes locks in this order to avoid request/character inversions.
    await lockKey(tx, 'request', command.requestId);
    await lockCharacter(tx, command.characterKey);
    const prior = await tx.query<{ content_sha256: string; result: T }>(
      'SELECT content_sha256, result FROM gc_commands WHERE request_id = $1', [command.requestId]);
    if (prior.rows[0]) {
      if (prior.rows[0].content_sha256 !== hash) return Object.freeze({
        status: 'conflict' as const, requestId: command.requestId, reason: 'REQUEST_ID_REUSED' as const
      });
      return Object.freeze({ status: 'accepted' as const, requestId: command.requestId,
        replayed: true, result: freezeJson(prior.rows[0].result) });
    }
    const encoded = canonicalJson(await effect(tx, command));
    await tx.query(`INSERT INTO gc_commands (request_id, character_key, command_type, content_sha256, result)
      VALUES ($1, $2, $3, $4, $5::jsonb)`,
    [command.requestId, command.characterKey, command.type, hash, encoded]);
    return Object.freeze({ status: 'accepted' as const, requestId: command.requestId,
      replayed: false, result: freezeJson(JSON.parse(encoded) as T) });
  });
}
