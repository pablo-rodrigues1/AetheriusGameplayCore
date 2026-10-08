import { cp, mkdir, readFile, readdir, symlink } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
const root = fileURLToPath(new URL('../', import.meta.url));
const staging = path.join(root, 'runtime/.packages/Core');
const [operation, ...flags] = process.argv.slice(2);
if (!['typecheck', 'test', 'build'].includes(operation)) throw Error('Usage: packages.mjs typecheck|test|build [--foundation] [--unit]');
const runtimeRequire = createRequire(new URL('./package.json', import.meta.url));
const tooling = path.dirname(path.dirname(runtimeRequire.resolve('typescript/package.json')));
const npmCli = process.env.npm_execpath;
if (!npmCli) throw Error('Run this script with npm run from the Core root');
// Read-only packages are copied into a build sandbox owned by runtime. Tests and
// source are unchanged; their normal relative output paths stay inside staging.
const ignored = new Set(['node_modules', '.git', '.npm-cache', '.build', '.test-build', 'build', 'dist']);
const filter = source => !ignored.has(path.basename(source));
await mkdir(staging, { recursive: true });
for (const name of ['shared', 'tools', 'database', 'catalog', 'tsconfig.base.json'])
  await cp(path.join(root, name), path.join(staging, name), { recursive: true, filter });
if (!flags.includes('--foundation')) await cp(path.join(root, 'modules'), path.join(staging, 'modules'), { recursive: true, filter });
await mkdir(path.join(staging, 'runtime'), { recursive: true });
// Old B3 tsconfig explicitly names runtime/node_modules/@types. This junction
// supplies the package's own declared dependencies without changing that config.
const junction = path.join(staging, 'runtime/node_modules');
if (!existsSync(junction)) await symlink(tooling, junction, 'junction');
const coreJunction = path.join(staging, 'node_modules');
if (!existsSync(coreJunction)) await symlink(tooling, coreJunction, 'junction');
const env = { ...process.env, PATH: `${path.join(tooling, '.bin')}${path.delimiter}${process.env.PATH}`, NODE_PATH: tooling };
let failures = 0;
function run(directory, script, command) {
  console.log(`PACKAGE ${path.relative(staging, directory)} :: ${script}`);
  const args = command ?? [npmCli, 'run', script, '--workspaces=false'];
  const result = spawnSync(process.execPath, args, { cwd: directory, env, stdio: 'inherit' });
  if (result.status !== 0) { failures++; console.error(`FAILED ${directory}: exit=${result.status}`); }
}
for (const group of ['shared', 'tools', ...flags.includes('--foundation') ? [] : ['modules']]) {
  for (const dir of (await readdir(path.join(staging, group), { withFileTypes: true })).filter(d => d.isDirectory()).sort((a,b) => a.name.localeCompare(b.name))) {
    const directory = path.join(staging, group, dir.name);
    if (!existsSync(path.join(directory, 'package.json'))) continue;
    const manifest = JSON.parse(await readFile(path.join(directory, 'package.json'), 'utf8'));
    if (operation === 'test' && flags.includes('--unit') && manifest.name === '@aetherius/persistence') {
      run(directory, 'build'); run(directory, 'unit tests', ['--test', 'tests/unit.test.mjs']);
      console.log('B3 integration not executed: one case opens a local listening socket; reviewer runs npm test');
    } else if (manifest.scripts?.[operation]) run(directory, operation);
    else if (operation === 'typecheck' && existsSync(path.join(directory, 'tsconfig.json'))) run(directory, 'typecheck', [runtimeRequire.resolve('typescript/bin/tsc'), '--noEmit', '-p', 'tsconfig.json']);
    else console.log(`PACKAGE ${manifest.name}: no ${operation} command (no TypeScript if typecheck)`);
  }
}
// Runtime emits only into dist; the spike and new runtime acceptance run in place.
if (operation === 'build') run(path.join(root, 'runtime'), 'bundle', ['build.mjs']);
if (operation === 'typecheck') run(path.join(root, 'runtime'), 'typecheck');
if (operation === 'test') run(path.join(root, 'runtime'), 'test');
console.log(`Packages ${operation}: failures=${failures}; artifacts under runtime/.packages and dist`);
process.exitCode = failures ? 1 : 0;
