import { parseStableRecordIdentity } from '../records/identity.mjs';

const AXES = ['x', 'y', 'z'];

function isFiniteVector(vector) {
  return vector !== null && typeof vector === 'object' && !Array.isArray(vector)
    && AXES.every((axis) => typeof vector[axis] === 'number' && Number.isFinite(vector[axis]));
}

/** Validate placed ACHR coordinates as authored in the winning record. No player-location fallback. */
export function validatePlacedSpawnLocation(spawnRef) {
  const errors = [];
  if (!spawnRef || spawnRef.type !== 'ACHR') errors.push('SPAWN_REFERENCE_NOT_ACHR');
  if (!parseStableRecordIdentity(spawnRef?.identity)) errors.push('SPAWN_IDENTITY_INVALID');
  if (!parseStableRecordIdentity(spawnRef?.cellIdentity)) errors.push('SPAWN_CELL_UNRESOLVED');
  if (!isFiniteVector(spawnRef?.position)) errors.push('SPAWN_POSITION_INVALID');
  if (!isFiniteVector(spawnRef?.rotation)) errors.push('SPAWN_ROTATION_INVALID');
  return errors;
}

/**
 * The host resolves the ACHR's original CELL into the SkyMP cell/worldspace FormDesc.
 * Exterior ACHRs may require a WRLD descriptor; never substitute the player's cell.
 * The returned vectors are new arrays because mp.set(locationalData) requires [x,y,z].
 */
export function prepareSkyMpSpawnLocation(spawnRef, resolveCellOrWorldDesc) {
  const issues = validatePlacedSpawnLocation(spawnRef);
  if (issues.length) return { status: 'FAILED', reason: 'SPAWN_LOCATION_INVALID', issues };
  if (typeof resolveCellOrWorldDesc !== 'function') {
    return { status: 'FAILED', reason: 'SPAWN_CELL_RESOLVER_UNBOUND' };
  }

  let resolved;
  try {
    resolved = resolveCellOrWorldDesc(Object.freeze({
      spawnStableIdentity: spawnRef.identity,
      cellIdentity: spawnRef.cellIdentity,
      locationIdentity: spawnRef.locationIdentity ?? null
    }));
  } catch {
    return { status: 'FAILED', reason: 'SPAWN_CELL_RESOLUTION_FAILED' };
  }
  const cellOrWorldDesc = typeof resolved === 'string'
    ? resolved
    : resolved?.status === 'RESOLVED' ? resolved.cellOrWorldDesc : null;
  if (typeof cellOrWorldDesc !== 'string' || !cellOrWorldDesc.trim()) {
    return { status: 'FAILED', reason: 'SPAWN_CELL_OR_WORLD_UNRESOLVED' };
  }
  return {
    status: 'RESOLVED',
    location: {
      cellOrWorldDesc,
      pos: AXES.map((axis) => spawnRef.position[axis]),
      rot: AXES.map((axis) => spawnRef.rotation[axis])
    }
  };
}
