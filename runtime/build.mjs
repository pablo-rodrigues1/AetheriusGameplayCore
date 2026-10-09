import { build } from 'esbuild';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { builtinModules } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build as compileMigration } from 'esbuild';
const migrationModule = await compileMigration({entryPoints:[fileURLToPath(new URL('./src/projection/migration.ts',import.meta.url))],bundle:true,platform:'node',format:'esm',write:false});
const {perkMigration}=await import(`data:text/javascript;base64,${Buffer.from(migrationModule.outputFiles[0].text).toString('base64')}`);

const root = fileURLToPath(new URL('../', import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
const dist = path.join(root, 'dist');
await mkdir(dist, { recursive: true });
// Keep generated output ignored without changing the repository's root files.
await writeFile(path.join(dist, '.gitignore'), '*\n');
const result = await build({
  absWorkingDir: root,
  entryPoints: ['runtime/src/index.ts'],
  outfile: 'dist/aetherius-gameplay-core.cjs',
  bundle: true,
  platform: 'node',
  format: 'cjs',
  target: 'node22',
  define: {
    BUNDLE_VERSION: JSON.stringify(version),
    BUILD_DOMAINS: JSON.stringify(await Promise.all(['standing-stones', 'races', 'classes'].map(name =>
      readFile(path.join(root, 'catalog', `${name}.json`), 'utf8').then(JSON.parse)))),
    BUILD_MIGRATIONS: JSON.stringify([...(await Promise.all((await readdir(path.join(root, 'database/migrations')))
      .filter(name => name.endsWith('.sql')).sort().map(async name => ({ version: name,
        sql: await readFile(path.join(root, 'database/migrations', name), 'utf8') })))),perkMigration]),
    BUILD_RACE_OWNERSHIP: JSON.stringify(JSON.parse(await readFile(path.join(root, 'modules/race-system/ownership.json'), 'utf8')))
  },
  metafile: true,
  logLevel: 'info'
});
const imports = result.metafile.outputs['dist/aetherius-gameplay-core.cjs'].imports;
if (imports.some(item => !builtinModules.includes(item.path.replace(/^node:/, '')))) {
  throw new Error('Bundle unexpectedly contains third-party external imports');
}
console.log(`Bundle ${version}: one CommonJS file, zero third-party imports; Node builtins=${imports.map(i => i.path).join(',')}.`);
