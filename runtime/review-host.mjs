// Reviewer only: real native host opens UDP. Never run inside the Codex sandbox.
// Usage: node runtime/review-host.mjs <workspace> <evidence-dir> <port>
import assert from 'node:assert/strict';
import { readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
const [workspaceArg, evidenceArg, portArg] = process.argv.slice(2);
const port = Number(portArg);
assert(workspaceArg && evidenceArg && Number.isInteger(port) && port > 1024 && port <= 65535 && port !== 7777,
  'Usage: node runtime/review-host.mjs <workspace> <evidence-dir> <unused-port-except-7777>');
const workspace = path.resolve(workspaceArg), evidence = path.resolve(evidenceArg);
const url = new URL(process.env.AETHERIUS_TEST_DATABASE_URL ?? 'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.pathname === '/aetherius_test', 'Requires local aetherius_test');
const portCheck = spawnSync('pwsh', ['-NoProfile','-Command', `if (Get-NetUDPEndpoint -LocalPort ${port} -ErrorAction SilentlyContinue) { exit 2 }; Write-Output 'Requested UDP port free'`], { encoding: 'utf8' });
assert.equal(portCheck.status, 0, 'Requested port occupied or port check failed; no other server is stopped');
mkdirSync(evidence, { recursive: true });
const server = path.join(workspace, 'aetherius-server/build/dist/server');
const dataDir = path.join(server, 'data');
const manifest = JSON.parse(readFileSync(path.join(dataDir, 'aetherius-loadorder.json'), 'utf8'));
const settings = { port, listenHost:'127.0.0.1', maxPlayers:1, dataDir, loadOrder:manifest.loadOrder,
  npcEnabled:false, logLevel:'warn', reloot:{}, offlineMode:false };
const require = createRequire(import.meta.url);
globalThis.require = require; // ScampServer emitter setup uses the CommonJS loader.
process.env.GAME_DATABASE_URL = process.env.AETHERIUS_TEST_DATABASE_URL;
const pg = require(path.join(server, 'gamemode/core/pg.js'));
const addon = require(path.join(server, 'scam_native.node'));
const bundleFile = path.join(workspace, 'AetheriusGameplayCore/dist/aetherius-gameplay-core.cjs');
let first, second, schema, schemaCreated = false;
try {
  const mp = new addon.ScampServer(JSON.stringify(settings)); mp.tick();
  const pool = pg.init();
  schema = `gc_b1_review_${process.pid}`;
  await pool.query(`CREATE SCHEMA "${schema}"`);
  schemaCreated = true;
  const env = { NODE_ENV:'local', GAMEPLAY_CORE_ALLOW_DEV_OPTIONS:'true', GAMEPLAY_CORE_DATABASE_SCHEMA: schema, GAMEPLAY_CORE_APPLY_MIGRATIONS_DEV:'true' };
  const log = { info: message => console.log(message) };
  first = require(bundleFile).createGameplayCore({ mp, pg, env, log }); await first.initialize();
  const probe = core => {
    const replies=[]; process.emit('aetherius:gameplay-core:health-check', healthy => replies.push(healthy));
    assert.deepEqual(replies, [true]); assert.equal(core.healthCheck(), true);
    const report = core.capabilityReport();
    assert.equal(report.database.status,'SUPPORTED');
    for (const domain of ['races','standing-stones','classes']) assert.equal(report.systems.find(s => s.id===domain).catalog.status,'SUPPORTED');
    return report;
  };
  probe(first);
  mp.clear(); delete require.cache[require.resolve(bundleFile)];
  second = require(bundleFile).createGameplayCore({ mp, pg, env, log }); await second.initialize();
  assert.equal(first.healthCheck(),false); assert.equal(first.info().resources,0);
  const afterReload = probe(second);
  await second.shutdown(); await second.initialize(); probe(second);
  writeFileSync(path.join(evidence, 'result.json'), JSON.stringify({ result:'PASSED', port,
    oldResources:first.info().resources, report:afterReload },null,2));
  console.log('Real native host boot, independently loaded bundle replacement and reinitialize: PASSED');
} catch (error) {
  // Errors are intentionally sanitized; environment/driver causes may contain credentials.
  console.error(`Reviewer host acceptance failed: ${error?.code ?? 'ASSERTION_OR_HOST_FAILURE'}`); process.exitCode=1;
} finally {
  await first?.shutdown(); await second?.shutdown();
  if (schemaCreated) await pg.init().query(`DROP SCHEMA "${schema}" CASCADE`);
  await pg.close();
}
