import { validatePlacedSpawnLocation } from './spawning/location.mjs';

export function buildReadinessReport({ sourceLockOk = false, plugins = [], loadOrderValidation = { ok: false, issues: [] }, enemyRegistry = { enemies: [] }, reachability = [], dungeons = [], patchRequirements = [], integration = {} } = {}) {
  const errors = [];
  const warnings = [];
  const info = [];
  if (!sourceLockOk) errors.push({ code: 'SOURCE_LOCK_MISSING', message: 'source commits are not locked' });
  if (!loadOrderValidation.ok) errors.push(...(loadOrderValidation.issues ?? []).filter((issue) => issue.severity === 'ERROR'));
  warnings.push(...(loadOrderValidation.issues ?? []).filter((issue) => issue.severity === 'WARN'));
  const unresolvedEnemies = enemyRegistry.enemies.filter((enemy) => enemy.classificationStatus !== 'RESOLVED' || !enemy.xpCategory || !enemy.winningOverridePlugin || String(enemy.questSafetyStatus ?? '').startsWith('UNVERIFIED'));
  if (unresolvedEnemies.length) warnings.push({ code: 'ENEMIES_REQUIRE_REVIEW', count: unresolvedEnemies.length });
  const orphanCount = reachability.reduce((sum, report) => sum + (report.orphanEnemies?.length ?? 0), 0);
  if (orphanCount) errors.push({ code: 'LVLN_ORPHAN_ENEMIES', count: orphanCount });
  const brokenReachability = reachability.filter((report) => report.hasCriticalFailure);
  if (brokenReachability.length) errors.push({ code: 'LVLN_REACHABILITY_FAILURE', count: brokenReachability.length });
  const unassignedDungeons = dungeons.filter((dungeon) => dungeon.classification === 'UNASSIGNED' || !dungeon.progressionContext?.valid);
  if (unassignedDungeons.length) warnings.push({ code: 'DUNGEONS_UNASSIGNED', count: unassignedDungeons.length });
  const dungeonsWithoutSpawns = dungeons.filter((dungeon) => !Array.isArray(dungeon.spawnRefs) || dungeon.spawnRefs.length === 0);
  if (dungeonsWithoutSpawns.length) errors.push({ code: 'DUNGEON_SPAWN_REFERENCES_MISSING', count: dungeonsWithoutSpawns.length });
  const invalidSpawnLocations = dungeons.flatMap((dungeon) =>
    (Array.isArray(dungeon.spawnRefs) ? dungeon.spawnRefs : []).flatMap((spawnRef) => {
      const issues = validatePlacedSpawnLocation(spawnRef);
      return issues.length ? [{ dungeonId: dungeon.dungeonId, spawnStableIdentity: spawnRef?.identity ?? null, issues }] : [];
    })
  );
  if (invalidSpawnLocations.length) errors.push({
    code: 'DUNGEON_SPAWN_LOCATION_INVALID',
    count: invalidSpawnLocations.length,
    examples: invalidSpawnLocations.slice(0, 10)
  });
  const unresolvedDungeonActorBases = dungeons.reduce((sum, dungeon) => sum + (dungeon.contentEvidence?.unresolvedActorBases ?? 0), 0);
  if (unresolvedDungeonActorBases) errors.push({ code: 'DUNGEON_ACTOR_BASES_UNRESOLVED', count: unresolvedDungeonActorBases });
  const unresolvedDungeonActorFamilies = dungeons.reduce((sum, dungeon) => sum + (dungeon.contentEvidence?.unresolvedActorFamilies ?? 0), 0);
  if (unresolvedDungeonActorFamilies) errors.push({ code: 'DUNGEON_ACTOR_FAMILIES_UNRESOLVED', count: unresolvedDungeonActorFamilies });
  if (patchRequirements.some((patch) => patch.status === 'REQUIRED' && patch.applied !== true)) errors.push({ code: 'REQUIRED_SKYMP_PATCH_NOT_APPLIED' });
  if (integration.inGameValidated !== true) warnings.push({ code: 'IN_GAME_VALIDATION_PENDING' });
  info.push({ code: 'PLUGIN_COUNT', count: plugins.length });
  info.push({ code: 'ENEMY_COUNT', count: enemyRegistry.enemies.length });
  info.push({ code: 'DUNGEON_COUNT', count: dungeons.length });
  info.push({ code: 'XP_CALCULATION', status: 'NOT_IMPLEMENTED_BY_DESIGN' });
  info.push({ code: 'CLASS_LEVEL_INDEPENDENT', status: true });
  if (integration.housecarlEpoch) info.push({ code: 'HOUSECARL_EPOCH', status: integration.housecarlEpoch });
  if (integration.profilePluginCounts?.length) info.push({ code: 'MO2_PROFILE_ACTIVE_PLUGIN_COUNTS', status: integration.profilePluginCounts.join(',') });
  const readyForProduction = errors.length === 0 && unresolvedEnemies.length === 0 && unassignedDungeons.length === 0 && integration.inGameValidated === true;
  return {
    schemaVersion: 1,
    title: 'Aetherius Enemy System Readiness',
    readyForProduction,
    errors,
    warnings,
    info,
    generatedAt: new Date().toISOString()
  };
}

export function formatReadinessReport(report) {
  const lines = [report.title];
  lines.push(`[${report.readyForProduction ? 'OK' : 'ERROR'}] READY_FOR_PRODUCTION = ${report.readyForProduction}`);
  const detail = (item) => [item.authorityId, item.filename, item.before && item.after ? `${item.before}->${item.after}` : null].filter(Boolean).join(': ');
  for (const item of report.errors) lines.push(`[ERROR] ${item.code}${item.count !== undefined ? ` (${item.count})` : ''}${detail(item) ? ` - ${detail(item)}` : ''}`);
  for (const item of report.warnings) lines.push(`[WARN] ${item.code}${item.count !== undefined ? ` (${item.count})` : ''}${detail(item) ? ` - ${detail(item)}` : ''}`);
  for (const item of report.info) lines.push(`[INFO] ${item.code}${item.count !== undefined ? ` = ${item.count}` : item.status !== undefined ? ` = ${item.status}` : ''}`);
  return lines.join('\n');
}
