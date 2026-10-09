// Read-only staff tool. Uses the gamemode's existing pg.js pool and signed
// offline definitions. No server, migrations, host mutations or new pool.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';
const [pgPath,characterKey,schema='public']=process.argv.slice(2);
if(!pgPath||!/^profile:[1-9][0-9]*$/.test(characterKey??'')||!Number.isSafeInteger(Number(characterKey.slice(8)))
  ||!/^[a-z_][a-z_0-9]{0,62}$/.test(schema)||schema.startsWith('pg_')) {
  console.error('Usage: node runtime/explain-character.mjs <gamemode/core/pg.js> <profile:id> [schema]');process.exit(2);
}
const root=fileURLToPath(new URL('../',import.meta.url));
let pg,client;
try {
  const compiled=await build({absWorkingDir:root,stdin:{loader:'ts',resolveDir:root,contents:"export {explainCharacter} from './runtime/src/explanation.ts'; export {developmentLevel} from './modules/class-progression-system/src/index.ts';"},bundle:true,platform:'node',format:'esm',write:false});
  const {explainCharacter,developmentLevel}=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const load=name=>JSON.parse(readFileSync(resolve(root,name),'utf8'));
  const devLevel=developmentLevel(process.env.GAMEPLAY_CORE_DEV_CLASS_LEVEL,process.env);
  if(devLevel!==undefined)console.error(`DEV class level override=${devLevel}; read only`);
  pg=createRequire(import.meta.url)(resolve(pgPath));client=await pg.init().connect();
  await client.query('BEGIN TRANSACTION ISOLATION LEVEL REPEATABLE READ READ ONLY');
  await client.query(`SET LOCAL search_path TO "${schema}", pg_catalog`);
  const hasClasses=(await client.query("SELECT to_regclass('gc_character_class') IS NOT NULL AND to_regclass('gc_leveling_progress') IS NOT NULL AS available")).rows[0].available;
  if(!hasClasses&&devLevel!==undefined)throw Error('CLASS_MIGRATION_UNAVAILABLE');
  const report=await explainCharacter(client,characterKey,load('catalog/standing-stones.json'),load('catalog/races.json'),load('modules/race-system/ownership.json'),hasClasses?load('catalog/classes.json'):undefined,devLevel);
  await client.query('COMMIT');console.log(JSON.stringify({...report,classStatus:hasClasses?'SUPPORTED':'UNSUPPORTED: apply C3a migrations 0006/0007'},null,2));
}catch(error){
  try{await client?.query('ROLLBACK');}catch{}
  console.error(error?.code==='DEV_OPTIONS_REFUSED'?`ERROR ${error.message}`:/^[A-Z0-9_]+$/.test(error?.code??error?.message??'')?error.code??error.message:'EXPLANATION_FAILED');process.exitCode=1;
}finally{client?.release();if(pg)await pg.close();}
