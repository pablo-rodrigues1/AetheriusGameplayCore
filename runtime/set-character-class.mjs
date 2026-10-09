// Staff command; shares the domain command and existing gamemode pool.
import {createRequire} from 'node:module';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
const [pgPath,characterKey,classId,schema='public',requestId=randomUUID()]=process.argv.slice(2);
if(!pgPath||!/^profile:[1-9][0-9]*$/.test(characterKey??'')||!Number.isSafeInteger(Number(characterKey.slice(8)))||!classId
  ||!/^[a-z_][a-z_0-9]{0,62}$/.test(schema)||schema.startsWith('pg_')){
  console.error('Usage: node runtime/set-character-class.mjs <pg.js> <profile:id> <class> [schema] [requestId]');process.exit(2);
}
const root=fileURLToPath(new URL('../',import.meta.url));let pg;
try{
  const compiled=await build({absWorkingDir:root,stdin:{loader:'ts',resolveDir:root,contents:`
    export {createClassCommands} from './modules/class-progression-system/src/index.ts';
    export {scopedPool} from './runtime/src/persistence-scope.ts';
    export {definitionCatalog} from './runtime/src/explanation.ts';
  `},bundle:true,platform:'node',format:'esm',write:false});
  const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const data=JSON.parse(readFileSync(resolve(root,'catalog/classes.json'),'utf8'));api.definitionCatalog(data);
  pg=createRequire(import.meta.url)(resolve(pgPath));
  const result=await api.createClassCommands(api.scopedPool(pg.init(),schema),data).set({characterKey,classId,requestId,epoch:'staff-offline'});
  console.log(JSON.stringify(result,null,2));if(result.status==='conflict')process.exitCode=1;
}catch(error){console.error(/^[A-Z0-9_]+$/.test(error?.code??error?.message??'')?error.code??error.message:'CLASS_COMMAND_FAILED');process.exitCode=1;}
finally{if(pg)await pg.close();}
