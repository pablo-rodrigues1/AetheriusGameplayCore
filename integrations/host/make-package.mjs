#!/usr/bin/env node
// Gera o pacote de integracao do host (aetherius-server) a partir da arvore de
// trabalho, sem altera-la: so usa comandos git de leitura (rev-parse, status,
// diff, archive) e escreve somente em --out e em --prove.
//
// Uso:
//   node make-package.mjs --server <aetherius-server> [--out <pasta>] [--preview] [--prove <pasta vazia>]
//
//   --server   raiz do clone do aetherius-server (obrigatorio)
//   --out      onde gravar changes.patch, files/ e manifest.json
//              (padrao: a pasta deste script; obrigatorio com --preview)
//   --preview  marca a saida como previa (manifest.preview=true e PREVIA.txt)
//              e aceita arquivo ainda sem funcionalidade em features.json
//   --prove    extrai da base os arquivos tocados (git archive), aplica o patch
//              fora de qualquer repositorio e compara o resultado, por SHA-256,
//              com a arvore de trabalho. Sai com codigo 1 se algo divergir.
//
// Fim de linha: o clone local usa core.autocrlf=true e tem arquivos com CRLF e
// mistos. O patch e as copias em files/ ficam na forma do repositorio (LF), e
// os hashes do manifest sao dessa forma. A comparacao da prova normaliza a
// arvore de trabalho do mesmo jeito (CRLF -> LF).
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const fail = message => { console.error(`make-package: ${message}`); process.exit(1); };

const args = process.argv.slice(2);
const options = { preview: false };
for (let i = 0; i < args.length; i++) {
  const arg = args[i];
  if (arg === '--preview') options.preview = true;
  else if (['--server', '--out', '--prove'].includes(arg)) {
    if (args[i + 1] === undefined) fail(`${arg} exige um valor`);
    options[arg.slice(2)] = path.resolve(args[++i]);
  } else fail(`argumento desconhecido: ${arg}`);
}
if (!options.server) fail('informe --server <caminho do aetherius-server>');
if (options.preview && !options.out) fail('--preview exige --out (a previa nao e gravada na pasta do pacote)');
const out = options.out ?? here;
const server = options.server;
const inside = (child, parent) => { const r = path.relative(parent, child); return r === '' || (!r.startsWith('..') && !path.isAbsolute(r)); };
for (const target of [out, options.prove].filter(Boolean))
  if (inside(target, server)) fail(`${target} fica dentro do aetherius-server; escolha outra pasta`);

const config = JSON.parse(readFileSync(path.join(here, 'features.json'), 'utf8'));
const base = config.repository.baseline;
const sha256 = buffer => createHash('sha256').update(buffer).digest('hex');
const toLf = buffer => Buffer.from(buffer.toString('latin1').replace(/\r\n/g, '\n'), 'latin1');

// Leitura apenas: sem atualizacao oportunista do indice.
const gitEnv = { ...process.env, GIT_OPTIONAL_LOCKS: '0' };
function git(cwd, argv, { allowFailure = false, env = gitEnv } = {}) {
  const result = spawnSync('git', argv, { cwd, env, maxBuffer: 1 << 30, windowsHide: true });
  if (result.error) fail(`git nao executou: ${result.error.message}`);
  if (result.status !== 0 && !allowFailure) fail(`git ${argv.join(' ')} saiu com ${result.status}: ${result.stderr.toString()}`);
  return result;
}

const head = git(server, ['rev-parse', 'HEAD']).stdout.toString().trim();
if (head !== base) fail(`HEAD do aetherius-server e ${head}; o pacote e feito contra ${base}. Atualize features.json se a base mudou.`);

// --- o que mudou ------------------------------------------------------------
const status = git(server, ['-c', 'core.quotepath=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all']).stdout.toString('utf8');
const modified = [], added = [], removed = [];
for (const entry of status.split('\0').filter(Boolean)) {
  const code = entry.slice(0, 2), file = entry.slice(3);
  if (config.exclude.some(prefix => file.startsWith(prefix))) continue;
  if (code === ' M') modified.push(file);
  else if (code === ' D') removed.push(file);
  else if (code === '??') added.push(file);
  else fail(`estado git nao previsto "${code}" em ${file} (algo foi posto no indice, renomeado ou esta em conflito); resolva antes de gerar o pacote`);
}
for (const list of [modified, added, removed]) list.sort();
const all = [...modified, ...added, ...removed];
if (all.length === 0) fail('nenhuma mudanca encontrada no aetherius-server');
const unclassified = all.filter(file => !config.files[file]);
const mappedButUnchanged = Object.keys(config.files).filter(file => !all.includes(file)).sort();
for (const [file, features] of Object.entries(config.files))
  for (const feature of features)
    if (!config.features[feature]) fail(`features.json: ${file} cita a funcionalidade desconhecida "${feature}"`);
if (unclassified.length && !options.preview)
  fail(`arquivos sem funcionalidade em features.json:\n  ${unclassified.join('\n  ')}`);

// --- patch --------------------------------------------------------------------
let patch = '';
if (modified.length || removed.length) {
  patch += git(server, ['-c', 'core.autocrlf=true', '-c', 'core.safecrlf=false', '-c', 'core.quotepath=false',
    '-c', 'diff.autoRefreshIndex=false', 'diff', '--no-color', '--no-ext-diff', '--no-renames', '--binary',
    '--full-index', base, '--', ...modified, ...removed]).stdout.toString('latin1');
}
const finalContent = new Map();
for (const file of modified) finalContent.set(file, toLf(readFileSync(path.join(server, file))));
for (const file of added) {
  const content = toLf(readFileSync(path.join(server, file)));
  if (content.includes(0)) fail(`${file} parece binario; este gerador so trata arquivo de texto novo`);
  finalContent.set(file, content);
  const blob = createHash('sha1').update(`blob ${content.length}\0`).update(content).digest('hex');
  patch += `diff --git a/${file} b/${file}\nnew file mode 100644\nindex ${'0'.repeat(40)}..${blob}\n`;
  if (content.length === 0) continue;
  const text = content.toString('latin1');
  const endsWithNewline = text.endsWith('\n');
  const lines = (endsWithNewline ? text.slice(0, -1) : text).split('\n');
  patch += `--- /dev/null\n+++ b/${file}\n@@ -0,0 +1${lines.length === 1 ? '' : `,${lines.length}`} @@\n`;
  patch += lines.map(line => `+${line}\n`).join('');
  if (!endsWithNewline) patch += '\\ No newline at end of file\n';
}
const patchBuffer = Buffer.from(patch, 'latin1');

// --- saida ----------------------------------------------------------------------
mkdirSync(out, { recursive: true });
rmSync(path.join(out, 'files'), { recursive: true, force: true });
for (const [file, content] of finalContent) {
  const target = path.join(out, 'files', file);
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, content);
}
writeFileSync(path.join(out, 'changes.patch'), patchBuffer);
const statusOf = file => modified.includes(file) ? 'modified' : added.includes(file) ? 'added' : 'removed';
const manifest = {
  schemaVersion: 1,
  preview: options.preview,
  generatedAt: new Date().toISOString(),
  generatedBy: 'integrations/host/make-package.mjs',
  format: 'patch git unificado (arquivos novos incluidos) mais copia integral dos arquivos no estado final',
  lineEndings: 'LF em changes.patch e em files/; sha256 e size calculados sobre o conteudo com CRLF convertido em LF',
  repository: { ...config.repository, headWhenGenerated: head },
  patch: { path: 'changes.patch', bytes: patchBuffer.length, sha256: sha256(patchBuffer) },
  excluded: config.exclude,
  features: config.features,
  featuresWithoutHostFiles: config.featuresWithoutHostFiles,
  counts: { modified: modified.length, added: added.length, removed: removed.length },
  unclassified,
  mappedButUnchanged,
  files: all.map(file => ({
    path: file,
    status: statusOf(file),
    features: config.files[file] ?? ['NAO-CLASSIFICADO'],
    ...(finalContent.has(file) ? { size: finalContent.get(file).length, sha256: sha256(finalContent.get(file)) } : {})
  }))
};
writeFileSync(path.join(out, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
const previewNote = path.join(out, 'PREVIA.txt');
if (options.preview) writeFileSync(previewNote,
  `PREVIA gerada em ${manifest.generatedAt}. Nao e o pacote de entrega: a arvore do aetherius-server ainda estava mudando.\n`);
else rmSync(previewNote, { force: true });
console.log(`${options.preview ? 'PREVIA' : 'pacote'}: ${modified.length} alterados, ${added.length} novos, ${removed.length} removidos; patch ${patchBuffer.length} bytes sha256=${manifest.patch.sha256}`);
if (unclassified.length) console.log(`SEM FUNCIONALIDADE em features.json (${unclassified.length}):\n  ${unclassified.join('\n  ')}`);
if (mappedButUnchanged.length) console.log(`em features.json mas sem mudanca na arvore (${mappedButUnchanged.length}):\n  ${mappedButUnchanged.join('\n  ')}`);

// --- prova ------------------------------------------------------------------------
if (options.prove) {
  const dir = options.prove;
  if (existsSync(dir) && readdirSync(dir).length) fail(`--prove: ${dir} nao esta vazia`);
  mkdirSync(dir, { recursive: true });
  const fromBase = [...modified, ...removed];
  if (fromBase.length) {
    // core.autocrlf=false: os bytes exatos dos blobs da base, sem conversao de checkout.
    const tar = git(server, ['-c', 'core.autocrlf=false', 'archive', '--format=tar', base, '--', ...fromBase]).stdout;
    for (let offset = 0; offset + 512 <= tar.length;) {
      const header = tar.subarray(offset, offset + 512);
      if (header.every(byte => byte === 0)) break;
      const field = (start, length) => header.subarray(start, start + length).toString('latin1').replace(/\0.*$/s, '');
      const size = parseInt(field(124, 12).trim() || '0', 8);
      const type = field(156, 1) || '0';
      const name = (field(345, 155) ? field(345, 155) + '/' : '') + field(0, 100);
      if (type === '0') {
        const target = path.join(dir, name);
        if (!inside(target, dir)) fail(`--prove: caminho inesperado no archive: ${name}`);
        mkdirSync(path.dirname(target), { recursive: true });
        writeFileSync(target, tar.subarray(offset + 512, offset + 512 + size));
      } else if (!['5', 'g', 'x'].includes(type)) fail(`--prove: entrada tar nao prevista (tipo ${type}) em ${name}`);
      offset += 512 + Math.ceil(size / 512) * 512;
    }
  }
  for (const file of fromBase) if (!existsSync(path.join(dir, file))) fail(`--prove: ${file} nao veio no archive da base`);
  // GIT_CEILING_DIRECTORIES impede o git de achar um repositorio acima da pasta de prova.
  const applyEnv = { ...gitEnv, GIT_CEILING_DIRECTORIES: path.dirname(dir) };
  const inRepo = git(dir, ['rev-parse', '--is-inside-work-tree'], { allowFailure: true, env: applyEnv });
  if (inRepo.status === 0) fail(`--prove: ${dir} esta dentro de um repositorio git`);
  // core.autocrlf=false: fora de um repositorio vale a configuracao da maquina, e com
  // autocrlf=true o git apply gravaria CRLF; a prova compara os bytes na forma LF.
  const apply = git(dir, ['-c', 'core.autocrlf=false', 'apply', '--verbose', path.join(out, 'changes.patch')], { allowFailure: true, env: applyEnv });
  process.stdout.write(apply.stdout.toString() + apply.stderr.toString());
  if (apply.status !== 0) fail(`--prove: git apply saiu com ${apply.status}`);
  let mismatches = 0;
  for (const entry of manifest.files) {
    const target = path.join(dir, entry.path);
    if (entry.status === 'removed') {
      const ok = !existsSync(target); if (!ok) mismatches++;
      console.log(`${ok ? 'OK      ' : 'DIVERGE '} removido ${entry.path}`);
      continue;
    }
    const applied = existsSync(target) ? sha256(readFileSync(target)) : 'AUSENTE';
    const tree = sha256(toLf(readFileSync(path.join(server, entry.path))));
    const copy = sha256(readFileSync(path.join(out, 'files', entry.path)));
    const ok = applied === tree && copy === tree && tree === entry.sha256;
    if (!ok) mismatches++;
    console.log(`${ok ? 'OK      ' : 'DIVERGE '} ${entry.status.padEnd(8)} ${entry.sha256} ${entry.path}${ok ? '' : ` (aplicado=${applied} arvore=${tree} copia=${copy})`}`);
  }
  console.log(`prova: ${manifest.files.length} arquivos, ${mismatches} divergencias; base ${base}`);
  if (mismatches) process.exit(1);
}
