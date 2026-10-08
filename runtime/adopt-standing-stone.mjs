// Development maintenance process only. Never run automatically during boot.
import { createRequire } from 'node:module';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';
const [pgPath, dataDir, characterKey, schema = 'public', development] = process.argv.slice(2);
if (!pgPath || !dataDir || !/^profile:[1-9][0-9]*$/.test(characterKey ?? '') || development !== '--development' || process.argv.length !== 7)
  throw Error('Usage: node runtime/adopt-standing-stone.mjs <gamemode/core/pg.js> <host-data-dir> <profile:id> <schema> --development');
if (process.env.ENABLE_STANDING_STONE_SPIKE === 'true' || ['canary','active'].includes(process.env.GAMEPLAY_CORE_MODE_STANDING_STONES))
  throw Error('Disable both stone writers and disconnect the adopting character before maintenance');
// Do not discover credentials. The operator supplies the gamemode environment.
const url = new URL(process.env.GAME_DATABASE_URL ?? process.env.DATABASE_URL ?? 'missing:');
if (!['localhost','127.0.0.1','[::1]'].includes(url.hostname) || !['/aetherius_test','/aetherius_dev'].includes(url.pathname))
  throw Error('Development adoption requires an explicit local gamemode database environment');
const root = fileURLToPath(new URL('../', import.meta.url));
const compiled = await build({ absWorkingDir: root, stdin: { loader:'ts', resolveDir:root, contents: `
  export {adoptSpikeChoice} from './runtime/src/adoption.ts';
  export {migrationStatus,readMigrations} from './shared/persistence/src/index.ts';
  export {contentSignature,recordSignature} from './shared/record-catalog/src/index.ts';
  export {fingerprintFiles} from './tools/catalog/host.ts';
` }, bundle:true, platform:'node', format:'esm', write:false });
const api = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
let pg;
try {
  const data = JSON.parse(await readFile(resolve(root,'catalog/standing-stones.json'),'utf8'));
  const loadOrder = JSON.parse(await readFile(resolve(dataDir,'aetherius-loadorder.json'),'utf8')).loadOrder;
  if (data.domain !== 'standing-stones' || api.contentSignature(data) !== data.signature) throw Error('CATALOG_INTEGRITY_FAILED');
  const observed = api.fingerprintFiles(loadOrder, resolve(dataDir), [data]);
  for (const dependency of data.dependencies) {
    const actual = observed.find(p => p.filename.toLowerCase() === dependency.filename.toLowerCase());
    if (!actual || actual.status || actual.size !== dependency.size || actual.crc32 !== dependency.crc32 || actual.isLight !== dependency.isLight)
      throw Error('CATALOG_FILES_UNAVAILABLE');
  }
  // This is an offline definition view, with no fabricated runtime FormIDs.
  const records = new Map(data.records.map(r => {
    const plugin = data.dependencies.find(p => p.filename.toLowerCase() === r.definingPlugin.toLowerCase());
    if (!plugin || api.recordSignature(r, plugin) !== r.signature) throw Error('RECORD_INTEGRITY_FAILED');
    return [r.stableFormKey, { definition: { stableFormKey:r.stableFormKey, recordType:r.recordType, catalogSignature:r.signature }, data:r.data }];
  }));
  const catalog = { status:'SUPPORTED', roots:data.roots.map(key => records.get(key)), unsupported:data.unsupported, byKey:key => records.get(key) };
  pg = createRequire(import.meta.url)(resolve(pgPath)); const pool = pg.init();
  const name = (await pool.query('SELECT current_database() AS name')).rows[0].name;
  if (!['aetherius_test','aetherius_dev'].includes(name)) throw Error('DEVELOPMENT_DATABASE_REQUIRED');
  await api.migrationStatus(pool, await api.readMigrations(resolve(root,'database/migrations')), schema);
  console.log(JSON.stringify(await api.adoptSpikeChoice(pool, catalog, characterKey, schema)));
} catch (error) {
  const reason = /^[A-Z0-9_]+$/.test(error?.code ?? error?.message ?? '') ? error.code ?? error.message : 'ADOPTION_FAILED';
  console.error(reason); process.exitCode = 1;
} finally { if (pg) await pg.close(); }
