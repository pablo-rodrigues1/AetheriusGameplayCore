import { PersistenceError } from './transaction.js';

/** Deliberately small additive DDL grammar; unknown SQL is rejected, never executed. */
export function validateMigrationSql(sql: string): readonly string[] {
  const fail = (): never => { throw new PersistenceError('MIGRATION_SQL_REJECTED',
    'Persistence: migration requires additive CREATE TABLE/INDEX with unqualified gc_ names and supported built-in types'); };
  // Do not strip comments with a regex: a comment marker in a literal is data.
  const tokens: string[] = [];
  let offset = 0;
  while (offset < sql.length) {
    const rest = sql.slice(offset);
    const whitespace = /^\s+/.exec(rest);
    if (whitespace) { offset += whitespace[0].length; continue; }
    if (rest.startsWith('--')) {
      const end = rest.indexOf('\n'); offset += end < 0 ? rest.length : end + 1; continue;
    }
    if (rest.startsWith('/*')) {
      let depth = 1; offset += 2;
      while (depth && offset < sql.length) {
        if (sql.startsWith('/*', offset)) { depth++; offset += 2; }
        else if (sql.startsWith('*/', offset)) { depth--; offset += 2; }
        else offset++;
      }
      if (depth) fail();
      continue;
    }
    // No quoted identifiers, literals, operators, qualified names or executable expressions.
    const token = /^(?:[a-zA-Z_][a-zA-Z_0-9]*|[0-9]+|[(),;])/.exec(rest);
    if (!token) return fail();
    tokens.push(token[0].toLowerCase()); offset += token[0].length;
  }
  let i = 0;
  const statements: string[] = [];
  const peek = () => tokens[i];
  const eat = (token: string) => { if (peek() === token) { i++; return true; } return false; };
  const need = (token: string) => { if (!eat(token)) fail(); };
  const identifier = (prefix = false): string => {
    const name = tokens[i++];
    if (!name || !/^[a-z_][a-z_0-9]{0,62}$/.test(name) || (prefix && !/^gc_[a-z_0-9]+$/.test(name))) fail();
    return name!;
  };
  const columns = () => {
    need('('); identifier(); while (eat(',')) identifier(); need(')');
  };
  const type = () => {
    const name = tokens[i++];
    if (!name || !['text', 'jsonb', 'integer', 'bigint', 'smallint', 'boolean', 'timestamptz', 'uuid', 'numeric', 'varchar'].includes(name)) fail();
    if (eat('(')) {
      if (!['numeric', 'varchar'].includes(name!)) fail();
      if (!/^[0-9]+$/.test(tokens[i++] ?? '')) fail();
      if (eat(',')) { if (name !== 'numeric' || !/^[0-9]+$/.test(tokens[i++] ?? '')) fail(); }
      need(')');
    }
  };
  const constraints = () => {
    while (peek() !== ',' && peek() !== ')') {
      if (eat('not')) need('null');
      else if (eat('null') || eat('unique')) { /* no expression */ }
      else if (eat('primary')) need('key');
      else if (eat('default')) {
        const value = tokens[i++];
        if (!value || !/^(?:current_timestamp|null|true|false|[0-9]+)$/.test(value)) fail();
      } else if (eat('references')) { identifier(true); columns(); }
      else fail();
    }
  };
  while (i < tokens.length) {
    const start = i;
    need('create');
    const unique = eat('unique');
    if (eat('table')) {
      if (unique) fail();
      identifier(true); need('(');
      do {
        if (eat('constraint')) identifier(true);
        if (eat('primary')) { need('key'); columns(); }
        else if (eat('unique')) columns();
        else if (eat('foreign')) { need('key'); columns(); need('references'); identifier(true); columns(); }
        else { identifier(); type(); constraints(); }
      } while (eat(','));
      need(')');
    } else if (eat('index')) {
      identifier(true); need('on'); identifier(true); columns();
    } else fail();
    // Always reconstruct validated tokens, not the original free-form SQL.
    statements.push(tokens.slice(start, i).join(' '));
    if (i < tokens.length) need(';');
  }
  if (!statements.length) fail();
  return Object.freeze(statements);
}
