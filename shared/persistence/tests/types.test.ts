import type { CharacterKey, SessionEpoch } from '../../contracts/src/identity.js';
import type { CommandEnvelope, CommandResult } from '../../contracts/src/messages.js';
import type { PersistenceCommand, PoolPort } from '../src/index.js';
import { executeCommand } from '../src/index.js';

const envelope: CommandEnvelope<'chooseStone', { stone: string }> = {
  requestId: 'typed', characterKey: 'profile:7' as CharacterKey, epoch: 'epoch' as SessionEpoch,
  type: 'chooseStone', payload: { stone: 'defining-plugin|local-id' }
};
const compatible: PersistenceCommand = envelope;
export async function compileContractUsage(pool: PoolPort) {
  return executeCommand<CommandResult>(pool, compatible, async tx => {
    // @ts-expect-error The callback cannot release the borrowed connection.
    tx.release();
    return { status: 'accepted', requestId: envelope.requestId, reason: 'CHOSEN',
      revision: { facts: 1, grants: 0, equipment: 0, effects: 0, catalog: 0 } };
  });
}
