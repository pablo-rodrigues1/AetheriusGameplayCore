import {build} from 'esbuild';
import {readFileSync,readdirSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
export const root=fileURLToPath(new URL('../../',import.meta.url));
export const load=name=>JSON.parse(readFileSync(`${root}/${name}`,'utf8'));
const migration=await build({entryPoints:[`${root}/runtime/src/projection/migration.ts`],bundle:true,platform:'node',format:'esm',write:false});
export const {perkMigration}=await import(`data:text/javascript;base64,${Buffer.from(migration.outputFiles[0].text).toString('base64')}`);
const result=await build({absWorkingDir:root,entryPoints:['runtime/src/index.ts'],bundle:true,platform:'node',format:'esm',write:false,define:{
  BUNDLE_VERSION:JSON.stringify('B5b-source-test'),
  BUILD_DOMAINS:JSON.stringify(['standing-stones','races','classes'].map(name=>load(`catalog/${name}.json`))),
  BUILD_MIGRATIONS:JSON.stringify([...readdirSync(`${root}/database/migrations`).filter(f=>f.endsWith('.sql')).sort().map(version=>({version,sql:readFileSync(`${root}/database/migrations/${version}`,'utf8')})),perkMigration]),
  BUILD_RACE_OWNERSHIP:JSON.stringify(load('modules/race-system/ownership.json'))
}});
export const api=await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
const helpers=await build({absWorkingDir:root,stdin:{loader:'ts',resolveDir:root,contents:`export {RuntimeLeveling,levelingConfigs} from './runtime/src/leveling.ts'; export {Actors} from './runtime/src/actors.ts'; export {Scope,Hooks} from './runtime/src/scope.ts'; export {applyMigrations,readMigrations,withTransaction} from './shared/persistence/src/index.ts'; export {definitionCatalog} from './runtime/src/explanation.ts'; export {ConfigLoader} from './modules/leveling-system/src/config/loader.mjs';`},bundle:true,platform:'node',format:'esm',write:false});
export const utils=await import(`data:text/javascript;base64,${Buffer.from(helpers.outputFiles[0].text).toString('base64')}`);
