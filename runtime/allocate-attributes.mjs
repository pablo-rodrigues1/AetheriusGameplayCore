// Staff only: same domain command, existing gamemode pool; no live-host claim.
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {randomUUID} from 'node:crypto';
import {build} from 'esbuild';
const [pgPath,characterKey,h,m,s,schema='public',requestId=randomUUID()]=process.argv.slice(2);
const values=[h,m,s];
if(!pgPath||!/^profile:[1-9][0-9]*$/.test(characterKey??'')||!Number.isSafeInteger(Number(characterKey.slice(8)))
  ||values.some(n=>!/^\d+$/.test(n??'')||!Number.isSafeInteger(Number(n)))
  ||!/^[a-z_][a-z_0-9]{0,62}$/.test(schema)||schema.startsWith('pg_')){
  console.error('Usage: node runtime/allocate-attributes.mjs <pg.js> <profile:id> <health delta> <magicka delta> <stamina delta> [schema] [requestId]');process.exit(2);
}
const root=fileURLToPath(new URL('../',import.meta.url));let pg;
try{
  const compiled=await build({absWorkingDir:root,stdin:{loader:'ts',resolveDir:root,contents:`
    export {createAttributeCommands,developmentLevel,withDevelopmentLevel} from './modules/class-progression-system/src/index.ts';
    export {levelingLevelPort} from './modules/leveling-system/src/persistence/durable.ts';
    export {scopedPool} from './runtime/src/persistence-scope.ts';
  `},bundle:true,platform:'node',format:'esm',write:false});
  const api=await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
  const devLevel=api.developmentLevel(process.env.GAMEPLAY_CORE_DEV_CLASS_LEVEL,process.env);
  if(devLevel!==undefined)console.error('DEV class level override='+devLevel+'; read only');
  pg=createRequire(import.meta.url)(resolve(pgPath));
  const receipt=await api.createAttributeCommands(api.scopedPool(pg.init(),schema),api.withDevelopmentLevel(api.levelingLevelPort,devLevel))
    .allocate({characterKey,requestId,epoch:'staff-offline',health:Number(h),magicka:Number(m),stamina:Number(s)});
  console.log(JSON.stringify({receipt,delivery:'NOT_SENT: offline staff tool; reconnect or actor-ready reloads durable allocation'},null,2));
  if(receipt.status==='conflict')process.exitCode=1;
}catch(error){console.error(error?.code==='DEV_OPTIONS_REFUSED'?error.message:/^[A-Z0-9_]+$/.test(error?.code??error?.message??'')?error.code??error.message:'ATTRIBUTE_COMMAND_FAILED');process.exitCode=1;}
finally{if(pg)await pg.close();}
