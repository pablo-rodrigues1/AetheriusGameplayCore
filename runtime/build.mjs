import { build } from 'esbuild';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

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
  define: { BUNDLE_VERSION: JSON.stringify(version) },
  metafile: true,
  logLevel: 'info'
});
if (result.metafile.outputs['dist/aetherius-gameplay-core.cjs'].imports.length) {
  throw new Error('Spike bundle unexpectedly contains external imports');
}
console.log(`Bundle ${version}: one CommonJS file, zero external imports.`);
