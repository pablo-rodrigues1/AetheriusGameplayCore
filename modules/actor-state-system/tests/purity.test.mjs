import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { compose, effectiveSet, diff, applyDiff } from '../src/index.ts';

const require = createRequire(import.meta.url);
const ts = require('../../../runtime/node_modules/typescript');
const moduleSrc = fileURLToPath(new URL('../src/', import.meta.url));
const contractSrc = fileURLToPath(new URL('../../../shared/contracts/src/', import.meta.url));
const forbidden = new Set(['Date', 'performance', 'process', 'globalThis', 'global', 'window', 'fetch',
  'WebSocket', 'XMLHttpRequest', 'require', 'setTimeout', 'setInterval', 'setImmediate', 'eval', 'Function']);

// Production is checked as an AST, including every transitive runtime import.
// fs and the compiler belong only to this test, never the production graph.
function auditSource(source, filename, imports = []) {
  const tree = ts.createSourceFile(filename, source, ts.ScriptTarget.Latest, true);
  function visit(node) {
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) {
      const typeOnly = node.isTypeOnly || node.importClause?.isTypeOnly;
      if (node.moduleSpecifier && !typeOnly) {
        const specifier = node.moduleSpecifier.text;
        if (!specifier.startsWith('.')) throw new Error(`IMPURE_IMPORT: ${specifier}`);
        imports.push(specifier);
      }
    }
    if (ts.isCallExpression(node) && node.expression.kind === ts.SyntaxKind.ImportKeyword) throw new Error('IMPURE_DYNAMIC_IMPORT');
    if (ts.isIdentifier(node) && forbidden.has(node.text)) throw new Error(`IMPURE_GLOBAL: ${node.text}`);
    if (ts.isPropertyAccessExpression(node) && node.expression.getText(tree) === 'Math' && node.name.text === 'random') throw new Error('IMPURE_RANDOM');
    if (ts.isElementAccessExpression(node) && node.expression.getText(tree) === 'Math') throw new Error('IMPURE_COMPUTED_MATH');
    ts.forEachChild(node, visit);
  }
  visit(tree);
  return imports;
}
function auditGraph(filename, visited = new Set()) {
  const resolved = path.resolve(filename);
  if (visited.has(resolved)) return visited;
  if (![moduleSrc, contractSrc].some(root => resolved.startsWith(root))) throw new Error(`IMPURE_DEPENDENCY: ${resolved}`);
  visited.add(resolved);
  for (const specifier of auditSource(fs.readFileSync(resolved, 'utf8'), resolved)) {
    auditGraph(path.resolve(path.dirname(resolved), specifier.replace(/\.js$/, '.ts')), visited);
  }
  return visited;
}

test('production import graph has no database, files, network, host, clock or random access', () => {
  const graph = auditGraph(path.join(moduleSrc, 'index.ts'));
  assert.equal(graph.size, 3); // index.ts, validation.ts, shared identity codec
  // Include otherwise unreferenced production files so a new hidden store is caught.
  for (const filename of fs.readdirSync(moduleSrc).filter(name => name.endsWith('.ts'))) auditGraph(path.join(moduleSrc, filename));
});

test('purity guard rejects prohibited imports and direct or aliased clock/random access', () => {
  for (const name of ['pg', 'fs', 'net', 'node:fs', 'node:net', 'http', 'node:crypto']) {
    assert.throws(() => auditSource(`import x from '${name}';`, 'probe.ts'), /IMPURE_IMPORT/);
    assert.throws(() => auditSource(`export * from '${name}';`, 'probe.ts'), /IMPURE_IMPORT/);
  }
  for (const source of ['Date.now()', 'new Date()', 'const now = Date.now;', 'Math.random()',
    'const random = Math.random;', 'Math["random"]()', 'fetch("x")', 'process.env.VALUE',
    'globalThis.Date.now()', 'import("pg")', 'require("pg")', 'setTimeout(() => {}, 1)']) {
    assert.throws(() => auditSource(source, 'probe.ts'), /IMPURE_/);
  }
});

test('composition and replay run with poisoned wall clock and entropy', () => {
  const savedNow = Date.now; const savedRandom = Math.random;
  try {
    Date.now = () => { throw new Error('wall clock accessed'); };
    Math.random = () => { throw new Error('random accessed'); };
    const revision = { facts: 0, grants: 0, equipment: 0, effects: 0, catalog: 0 };
    const before = compose('profile:104', [], revision);
    const after = compose('profile:104', [], { ...revision, facts: 1 });
    assert.deepEqual(applyDiff(effectiveSet(before), diff(before, after)), effectiveSet(after));
  } finally { Date.now = savedNow; Math.random = savedRandom; }
});
