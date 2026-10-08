import assert from 'node:assert/strict';
import { test } from 'node:test';
import { readdir, readFile } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { canonicalJson, validateMigrationSql } from '../build/persistence/src/index.js';

test('canonical JSON ignores object insertion order, preserves array order and rejects lossy inputs', () => {
  assert.equal(canonicalJson({ z: [1, { b: true, a: null }], a: -0 }), '{"a":0,"z":[1,{"a":null,"b":true}]}');
  assert.notEqual(canonicalJson([1, 2]), canonicalJson([2, 1]));
  const cycle = {}; cycle.self = cycle;
  for (const value of [undefined, NaN, Infinity, 1n, new Date(), cycle, { a: undefined }, [1, , 3]]) {
    assert.throws(() => canonicalJson(value), TypeError);
  }
  assert.throws(() => canonicalJson({ get a() { throw Error('must not run'); } }), /getters/);
});

test('package code has only gc_ table references and cannot instantiate/import a second pg pool', async () => {
  const sourceDir = new URL('../src/', import.meta.url);
  const migrationDir = new URL('../../../database/migrations/', import.meta.url);
  const files = [
    ...(await readdir(sourceDir)).filter(n => n.endsWith('.ts')).map(n => new URL(n, sourceDir)),
    ...(await readdir(migrationDir)).filter(n => n.endsWith('.sql')).map(n => new URL(n, migrationDir))
  ];
  let references = 0;
  for (const file of files) {
    const source = await readFile(file, 'utf8');
    assert.doesNotMatch(source, /\bnew\s+(?:\w+\.)?Pool\s*\(/);
    assert.doesNotMatch(source, /(?:from\s*|require\s*\(|import\s*\()\s*['"]pg(?:['"/])/);
    assert.doesNotMatch(source, /\b(?:users|sessions)\b/i);
    for (const match of source.matchAll(/\b(?:FROM|JOIN|INTO|UPDATE|TABLE|REFERENCES)\s+(gc_[a-z_0-9]+|[a-z_][a-z_0-9]*)\b/g)) {
      assert.match(match[1], /^gc_/, `foreign table-like SQL reference in ${file.pathname}`);
      references++;
    }
  }
  assert.ok(references > 0);
  console.log(`static package scan: ${files.length} files, ${references} gc_ SQL targets; no pg import/Pool construction/foreign tables`);
});

test('maintenance CLI validates arguments and reports safe errors without connecting', () => {
  const path = new URL('../migrate.mjs', import.meta.url);
  const usage = spawnSync(process.execPath, [fileURLToPath(path)], { encoding: 'utf8' });
  assert.equal(usage.status, 1);
  assert.match(usage.stderr, /Usage:/);
});

test('SQL migration policy is fail-closed for foreign tables, expressions and indirect access', () => {
  const invalid = [
    'CREATE TABLE foreign_table (id text)',
    'CREATE TABLE gc_ok (id text REFERENCES foreign_table (id))',
    'CREATE TABLE gc_ok (id text, FOREIGN KEY (id) REFERENCES foreign_table (id))',
    'CREATE TABLE gc_ok (LIKE foreign_table INCLUDING ALL)',
    'CREATE TABLE gc_ok AS SELECT * FROM foreign_table',
    'CREATE INDEX gc_idx ON foreign_table (id)',
    'CREATE TABLE public.gc_ok (id text)',
    'CREATE TABLE "gc_ok" (id text)',
    'CREATE TABLE gc_ok (id custom_type)',
    'CREATE TABLE gc_ok (id text DEFAULT unsafe_function())',
    'CREATE TABLE gc_ok (id text CHECK (unsafe_function(id)))',
    'CREATE TABLE gc_ok (id text); DELETE FROM foreign_table',
    'DO $$ BEGIN DELETE FROM foreign_table; END $$',
    'ALTER TABLE gc_ok RENAME TO foreign_table',
    'DROP TABLE gc_ok CASCADE',
    'CREATE TABLE gc_ok (id text); COMMIT',
    'CREATE TABLE gc_ok (id text) INHERITS (foreign_table)',
    'CREATE TABLE gc_ok (id text); /* unterminated'
  ];
  for (const sql of invalid) assert.throws(() => validateMigrationSql(sql), { code: 'MIGRATION_SQL_REJECTED' }, sql);
  assert.equal(validateMigrationSql(`-- foreign_table is only a comment
    CREATE TABLE gc_a (id text PRIMARY KEY);
    /* outer /* inner */ end */ CREATE TABLE gc_b (id text REFERENCES gc_a(id));
    CREATE UNIQUE INDEX gc_idx ON gc_b (id);`).length, 3);
});
