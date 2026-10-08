import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { fileURLToPath } from 'node:url';

// Exercise real runtime-code resolution, beyond the erased FeatureMode type import.
const result = await build({
  stdin: {
    contents: "export { createStableFormKey } from '@aetherius/contracts';",
    resolveDir: fileURLToPath(new URL('./', import.meta.url)),
    loader: 'ts'
  },
  platform: 'node', format: 'esm', bundle: true, write: false, metafile: true
});
assert(Object.values(result.metafile.outputs).every(output => output.imports.length === 0));
const { createStableFormKey } = await import(`data:text/javascript;base64,${Buffer.from(result.outputFiles[0].text).toString('base64')}`);
assert.equal(createStableFormKey('Skyrim.esm', 0x123, 'FULL'), 'skyrim.esm|000123');
console.log('@aetherius/contracts default exports: real TS runtime codec bundled and executed; PASS');
