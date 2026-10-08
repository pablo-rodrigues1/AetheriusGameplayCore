import assert from 'node:assert/strict';
import { after, before, test } from 'node:test';
import { createRequire } from 'node:module';
import { randomBytes } from 'node:crypto';
import { build } from 'esbuild';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { spellMp, sessionEvents } from './projection-host.mjs';
import { fakeHost, logger } from './host.mjs';
const require = createRequire(import.meta.url);
const { Pool } = require('pg');
const { SpellProjection, createGameplayCore } = require('../../dist/aetherius-gameplay-core.cjs');
const compiled = await build({ entryPoints: [fileURLToPath(new URL('../../shared/persistence/src/index.ts', import.meta.url))], bundle:true, platform:'node', format:'esm', write:false });
const persistence = await import(`data:text/javascript;base64,${Buffer.from(compiled.outputFiles[0].text).toString('base64')}`);
const databaseUrl = process.env.AETHERIUS_TEST_DATABASE_URL;
if (!databaseUrl) throw Error('AETHERIUS_TEST_DATABASE_URL required; no tests skipped');
const url = new URL(databaseUrl);
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname) && url.pathname === '/aetherius_test', 'Requires local aetherius_test');
const pool = new Pool({ connectionString:databaseUrl, max:6, connectionTimeoutMillis:2000 });
const schema = `gc_b5a_${process.pid}_${randomBytes(5).toString('hex')}`;
const domains = await Promise.all(['standing-stones','races'].map(name => readFile(new URL(`../../catalog/${name}.json`, import.meta.url), 'utf8').then(JSON.parse)));
const records = [...new Map(domains.flatMap(d => d.records).map(r => [r.stableFormKey,r])).values()];
const definitions = records.map(r => ({ stableFormKey:r.stableFormKey, recordType:r.recordType, catalogSignature:r.signature }));
const [a,b,c] = definitions.filter(d => d.recordType === 'SPEL');
const race = definitions.find(d => d.recordType === 'RACE');
const revision = n => ({ facts:n, grants:n, equipment:0, effects:0, catalog:1 });
const grant = (definition, source='one', kind='ability') => ({ kind, definition, source:{ kind:'SYSTEM', key:source }, revision:0,
  ...(kind==='perk' ? { rank:1 } : {}), ...(kind==='modifier' ? {owner:'NATIVE_CLIENT'} : {}) });
const intent = (binding, grants, n=1) => ({ binding, set:{ characterKey:binding.characterKey, revision:revision(n), grants } });
const ports = [];
let sequence=300;
const table = name => `"${schema}".${name}`;
const deferred = () => { let resolve; const promise=new Promise(r => { resolve=r; }); return { promise, resolve }; };
function setup({ shift=1000, portPool=pool, ready=true }={}) {
  const profile=++sequence;
  let current = { characterKey:`profile:${profile}`, profileKey:`profile:${profile}`, actorRef:{ actorId:profile+1000 }, epoch:'epoch-one' };
  const mp=spellMp(definitions,shift), actors=sessionEvents(), signal=new AbortController();
  const catalog={ lookup(d) { return definitions.some(x => x.stableFormKey===d.stableFormKey && x.recordType===d.recordType && x.catalogSignature===d.catalogSignature) ? {status:'SUPPORTED',value:{definition:d}} : {status:'UNSUPPORTED',reason:'absent'}; },
    resolve(key, signature) { return definitions.some(d => d.stableFormKey===key && d.catalogSignature===signature) ? {status:'SUPPORTED',value:mp.ids.get(key)} : {status:'UNSUPPORTED',reason:'absent'}; } };
  const identity={ isCurrent:b => !!current && JSON.stringify(current)===JSON.stringify(b), lookup:() => ({status:'SUPPORTED',value:current}) };
  const create = () => { const port=new SpellProjection({ pool:portPool, schema, mp, catalogs:[catalog], identity, actors, signal:signal.signal, warn:()=>{} }); ports.push(port); return port; };
  const port=create(); if (ready) actors.ready(current);
  return { port, mp, actors, signal, create, identity, catalog, get binding(){ return current; },
    disconnect() { const old=current; current=undefined; actors.unbound(old); return old; },
    reconnect(old) { current={...old,epoch:'epoch-two'}; actors.ready(current); return current; } };
}
const mutations = f => f.mp.calls.filter(call => ['AddSpell','RemoveSpell'].includes(call.method));
async function head(binding) { return (await pool.query(`SELECT * FROM ${table('gc_spell_projection_heads')} WHERE character_key=$1`,[binding.characterKey])).rows[0]; }
async function rows(binding) { return (await pool.query(`SELECT * FROM ${table('gc_spell_projections')} WHERE character_key=$1 ORDER BY stable_form_key`,[binding.characterKey])).rows; }
before(async () => {
  await pool.query(`CREATE SCHEMA "${schema}"`);
  const files=await persistence.readMigrations(fileURLToPath(new URL('../../database/migrations/',import.meta.url)));
  const applied=await persistence.applyMigrations(pool,files,schema); assert.equal(applied.applied.length,3);
  assert.equal((await persistence.applyMigrations(pool,files,schema)).unchanged,3);
  assert.equal((await persistence.migrationStatus(pool,files,schema)).length,3);
});
after(async () => { await Promise.all(ports.map(p => p.shutdown())); await pool.query(`DROP SCHEMA "${schema}" CASCADE`); await pool.end(); });

test('first publication, duplicate revision makes zero host calls, swap removes A/adds B only', async () => {
  const f=setup(), input=intent(f.binding,[grant(a)]);
  assert.equal((await f.port.publish(input)).value.items[0].status,'APPLIED_HOST');
  assert.deepEqual(mutations(f).map(x=>x.method),['AddSpell']);
  const count=f.mp.calls.length;
  assert.equal((await f.port.publish(input)).value.state,'UNCHANGED'); assert.equal(f.mp.calls.length,count);
  const swap=await f.port.publish(intent(f.binding,[grant(b)],2)); assert.equal(swap.value.state,'APPLIED_HOST');
  assert.deepEqual(mutations(f).map(x=>x.method),['AddSpell','RemoveSpell','AddSpell']);
  assert.deepEqual([...f.mp.learned(f.binding.actorRef.actorId)],[f.mp.ids.get(b.stableFormKey)]);
});
test('external learned and base spells survive grant followed by revoke, durable protected tombstones', async () => {
  const f=setup(), binding=f.binding;
  f.mp.learned(binding.actorRef.actorId).add(f.mp.ids.get(a.stableFormKey));
  f.mp.base(binding.actorRef.actorId).add(f.mp.ids.get(b.stableFormKey));
  const first=await f.port.publish(intent(binding,[grant(a),grant(b)]));
  assert(first.value.items.every(i=>i.status==='ALREADY_PRESENT'));
  const revoked=await f.port.publish(intent(binding,[],2)); assert.equal(revoked.status,'SUPPORTED');
  assert.equal(mutations(f).filter(c=>c.method==='RemoveSpell').length,0);
  assert(f.mp.learned(binding.actorRef.actorId).has(f.mp.ids.get(a.stableFormKey)));
  assert((await rows(binding)).every(r=>!r.owned && !r.active));
  await f.port.shutdown(); const next=f.create(); f.actors.ready(binding);
  await next.publish(intent(binding,[grant(a)],3)); await next.publish(intent(binding,[],4));
  assert.equal(mutations(f).filter(c=>c.method==='RemoveSpell').length,0);
});
test('two sources and different SPEL grant kinds produce one addition; one source revoked produces no mutation', async () => {
  const f=setup();
  await f.port.publish(intent(f.binding,[grant(a,'race'),grant(a,'stone','spell')]));
  assert.equal(mutations(f).length,1);
  await f.port.publish(intent(f.binding,[grant(a,'race')],2)); assert.equal(mutations(f).length,1);
  await f.port.publish(intent(f.binding,[],3)); assert.equal(mutations(f).length,2);
});
test('non-SPEL unsupported per item while SPEL applies; empty set revokes only Core row', async () => {
  const f=setup();
  const result=await f.port.publish(intent(f.binding,[grant(race,'class','modifier'),grant(a)]));
  assert.equal(result.value.state,'PARTIAL'); assert.equal(result.value.items.find(i=>i.definition.recordType==='RACE').status,'UNSUPPORTED');
  assert.equal(mutations(f).length,1); assert.equal((await rows(f.binding)).length,1);
  const hostCalls=f.mp.calls.length;
  const repeated=await f.port.publish(intent(f.binding,[grant(race,'class','modifier'),grant(a)]));
  assert.equal(repeated.value.state,'PARTIAL'); assert.equal(f.mp.calls.length,hostCalls,'unsupported kind must not force repeated host calls');
  await f.port.publish(intent(f.binding,[],2)); assert.equal(mutations(f).length,2);
});
test('missing catalog/signature unsupported without blocking valid item', async () => {
  const f=setup(); const bad={...b,catalogSignature:'not-the-winner'};
  const result=await f.port.publish(intent(f.binding,[grant(a),grant(bad)]));
  assert.equal(result.value.state,'PARTIAL'); assert(result.value.items.some(i=>i.reason==='CATALOG_UNSUPPORTED'));
  assert.equal(mutations(f).length,1); assert.equal((await head(f.binding)).complete,false);
});
test('stale, incomparable, equal revision different content and character mismatch rejected', async () => {
  const f=setup(); const initial=intent(f.binding,[grant(a)],3); await f.port.publish(initial);
  const inputs=[intent(f.binding,[],2), {...intent(f.binding,[],4),set:{...initial.set,revision:{...revision(4),catalog:0}}},intent(f.binding,[],3),
    {...intent(f.binding,[],4),set:{...initial.set,characterKey:'profile:999999'}}];
  const count=f.mp.calls.length;
  for(const input of inputs) assert.equal((await f.port.publish(input)).status,'UNSUPPORTED');
  assert.equal(f.mp.calls.length,count); assert.deepEqual((await head(f.binding)).grant_set.revision,revision(3));
});
test('publication before ready is pending and does not write; ready drains; reconnect reapplies missing once', async () => {
  const f=setup({ready:false}), first=f.binding;
  assert.equal((await f.port.publish(intent(first,[grant(a)]))).value.state,'PENDING');
  assert.equal(mutations(f).length,0); assert.equal(await head(first),undefined);
  f.actors.ready(first);
  await f.port.publish(intent(first,[grant(a)])); assert.equal(mutations(f).length,1);
  f.disconnect(); f.mp.learned(first.actorRef.actorId).clear(); const next=f.reconnect(first);
  await f.port.publish(intent(next,[grant(a)])); assert.equal(mutations(f).length,2);
  await f.port.publish(intent(next,[grant(a)])); assert.equal(mutations(f).length,2);
  assert.equal((await rows(next))[0].owned,true);
});
test('restart and actor-ready rehydrate recorded set without owner republishing', async () => {
  const f=setup(); await f.port.publish(intent(f.binding,[grant(a)])); await f.port.shutdown();
  f.mp.learned(f.binding.actorRef.actorId).clear(); const next=f.create(); f.actors.ready(f.binding);
  await next.publish(intent(f.binding,[grant(a)])); assert.equal(mutations(f).length,2);
  assert.equal((await rows(f.binding))[0].owned,true);
});
test('disconnect during database read discards publication; no host calls or projection records', async () => {
  const gate=deferred(), entered=deferred();
  const portPool={async connect(){const real=await pool.connect();return {release:e=>real.release(e),async query(sql,args){
    const r=await real.query(sql,args); if(sql.startsWith('SELECT grant_set')){entered.resolve();await gate.promise;} return r;
  }};}};
  const f=setup({portPool}), old=f.binding;
  const publishing=f.port.publish(intent(old,[grant(a)])); await entered.promise; f.disconnect(); gate.resolve();
  assert.equal((await publishing).reason,'STALE_BINDING'); assert.equal(f.mp.calls.length,0);
  assert.equal(await head(old),undefined); assert.equal((await rows(old)).length,0);
});
test('disconnect while waiting for character lock does not apply after reconnect', async () => {
  const f=setup(), binding=f.binding, locked=await pool.connect();
  await locked.query('SELECT pg_advisory_lock($1::bigint)',[-Number(binding.characterKey.slice(8))]);
  try {
    const publishing=f.port.publish(intent(binding,[grant(a)])); f.disconnect();
    await locked.query('SELECT pg_advisory_unlock($1::bigint)',[-Number(binding.characterKey.slice(8))]);
    assert.equal((await publishing).reason,'STALE_BINDING'); assert.equal(mutations(f).length,0); assert.equal(await head(binding),undefined);
  } finally {locked.release();}
});
test('crash between native addition and DB recording: next instance converges and preserves uncertain ownership', async () => {
  let fail=true;
  const portPool={async connect(){const real=await pool.connect();return {release:e=>real.release(e),async query(sql,args){
    if(fail && sql.startsWith('INSERT INTO') && sql.includes('gc_spell_projections')) {fail=false;throw Error('injected DB write failure');}
    return real.query(sql,args);
  }};}};
  const f=setup({portPool}), input=intent(f.binding,[grant(a)]);
  assert.equal((await f.port.publish(input)).status,'UNSUPPORTED'); assert.equal(mutations(f).length,1);
  assert.equal(await head(f.binding),undefined); await f.port.shutdown();
  const next=f.create(); f.actors.ready(f.binding); const result=await next.publish(input);
  assert.equal(result.status,'SUPPORTED'); assert.equal(mutations(f).length,1);
  assert.equal((await rows(f.binding))[0].owned,false,'cannot infer ownership after unrecorded addition');
  await next.publish(intent(f.binding,[],2)); assert.equal(mutations(f).length,1);
});
test('partial native failure retries same revision from durable progress; no repeated removal', async () => {
  const f=setup(); await f.port.publish(intent(f.binding,[grant(a)]));
  f.mp.fail('AddSpell'); const next=intent(f.binding,[grant(b)],2);
  assert.equal((await f.port.publish(next)).status,'UNSUPPORTED');
  assert.equal((await head(f.binding)).complete,false);
  assert.equal((await f.port.publish(intent(f.binding,[grant(a)],1))).status,'UNSUPPORTED');
  assert.equal((await f.port.publish(next)).status,'SUPPORTED');
  assert.equal(mutations(f).filter(x=>x.method==='RemoveSpell').length,1);
  assert(f.mp.learned(f.binding.actorRef.actorId).has(f.mp.ids.get(b.stableFormKey)));
});
test('two independent ports serialize on the real DB, two characters remain independent', async () => {
  const f=setup(), second=f.create(); f.actors.ready(f.binding);
  const results=await Promise.all([f.port.publish(intent(f.binding,[grant(a)])),second.publish(intent(f.binding,[grant(a)]))]);
  assert(results.every(r=>r.status==='SUPPORTED')); assert.equal(mutations(f).length,1);
  const other=setup(); const both=await Promise.all([f.port.publish(intent(f.binding,[grant(b)],2)),other.port.publish(intent(other.binding,[grant(c)]))]);
  assert(both.every(r=>r.status==='SUPPORTED')); assert.equal((await rows(other.binding)).length,1);
});
test('plugin moves position between boots: durable identity resolves to new native ID', async () => {
  const f=setup(); await f.port.publish(intent(f.binding,[grant(a)])); await f.port.shutdown();
  const shifted=spellMp(definitions,7000), actors=sessionEvents();
  const catalog={lookup:f.catalog.lookup,resolve:(key,signature)=>f.catalog.resolve(key,signature).status==='SUPPORTED' ? {status:'SUPPORTED',value:shifted.ids.get(key)} : {status:'UNSUPPORTED',reason:'absent'}};
  const port=new SpellProjection({pool,schema,mp:shifted,catalogs:[catalog],identity:f.identity,actors,signal:new AbortController().signal,warn:()=>{}}); ports.push(port);
  actors.ready(f.binding); await port.publish(intent(f.binding,[grant(a)]));
  assert(shifted.learned(f.binding.actorRef.actorId).has(shifted.ids.get(a.stableFormKey)));
  const serialized=JSON.stringify(await rows(f.binding)); assert(!serialized.includes('runtimeFormId')); assert.equal((await rows(f.binding))[0].stable_form_key,a.stableFormKey);
});
test('no client ACK is emitted, missing DB/host is explicit; malformed read fails without mutation', async () => {
  const f=setup(); let acks=0; const unsubscribe=f.port.onAck(()=>acks++);
  const result=await f.port.publish(intent(f.binding,[grant(a)])); assert.equal(result.value.delivery,'UNCONFIRMED'); assert.equal(acks,0); unsubscribe();
  const unavailable=new SpellProjection({pool:undefined,mp:f.mp,catalogs:[f.catalog],identity:f.identity,actors:f.actors,signal:f.signal.signal,warn:()=>{},unavailableReason:'MIGRATIONS_NOT_CURRENT'}); ports.push(unavailable);
  assert.equal((await unavailable.publish(intent(f.binding,[grant(a)]))).reason,'MIGRATIONS_NOT_CURRENT');
  const broken=setup(); const native=broken.mp.callPapyrusFunction;
  broken.mp.callPapyrusFunction=(...args)=>args[2]==='GetSpellCount' ? undefined : native(...args);
  assert.equal((await broken.port.publish(intent(broken.binding,[grant(a)]))).reason,'SPELL_READ_UNSUPPORTED'); assert.equal(mutations(broken).length,0);
});
test('runtime context shares port, applies only active/canary; shutdown aborts held contexts', async t => {
  t.mock.timers.enable({apis:['setTimeout','setInterval']});
  for (const mode of ['audit','shadow','canary','active']) {
    let ctx;
    const mp=fakeHost({catalogAvailable:true});
    const runtime=createGameplayCore({mp,pg:{init:()=>pool},env:{GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_PROBE:mode},log:logger()});
    runtime.register({id:'probe',start:c=>{ctx=c;}}); await runtime.initialize();
    try {
      assert(ctx.projection); assert.equal(ctx.projection.capability().status,'PARTIAL');
      const binding=runtime.identity.lookup({actorId:91}).value;
      const result=await ctx.projection.publish(intent(binding,[]));
      assert.equal(result.status,mode==='active' ? 'SUPPORTED' : 'UNSUPPORTED');
      assert.equal(result.status==='SUPPORTED' ? result.value.state : result.reason,mode==='active' ? 'PENDING' : 'FEATURE_MODE_OR_BINDING_REFUSED');
      await runtime.shutdown(); assert.equal((await ctx.projection.publish(intent(binding,[]))).status,'UNSUPPORTED');
    } finally {await runtime.shutdown();}
  }
});

test('native calls occur outside transactions; post-await disconnect rolls back projection recording', async () => {
  let active=false, disconnectAfterInsert;
  const portPool={async connect(){const real=await pool.connect();return {release:e=>real.release(e),async query(sql,args){
    const result=await real.query(sql,args);
    if(sql==='BEGIN') active=true;
    if(sql==='COMMIT' || sql==='ROLLBACK') active=false;
    if(sql.startsWith('INSERT INTO') && sql.includes('gc_spell_projections') && disconnectAfterInsert) disconnectAfterInsert();
    return result;
  }};}};
  const f=setup({portPool}), native=f.mp.callPapyrusFunction;
  f.mp.callPapyrusFunction=(...args)=>{assert.equal(active,false,'host call inside DB transaction');return native(...args);};
  const binding=f.binding;
  await f.port.publish(intent(binding,[grant(a)]));
  disconnectAfterInsert=()=>f.disconnect();
  const failed=await f.port.publish(intent(binding,[grant(a),grant(b)],2));
  assert.equal(failed.reason,'STALE_BINDING'); assert.equal(active,false);
  assert.deepEqual((await head(binding)).grant_set.revision,revision(1),'stale session cannot commit new projection revision');
  assert.equal((await rows(binding)).length,1);
});

test('rejected removal reports the failed item and retry preserves unrelated external spell', async () => {
  const f=setup(), binding=f.binding;
  f.mp.learned(binding.actorRef.actorId).add(f.mp.ids.get(c.stableFormKey));
  await f.port.publish(intent(binding,[grant(a)]));
  f.mp.fail('RemoveSpell');
  const failed=await f.port.publish(intent(binding,[],2));
  assert.equal(failed.status,'UNSUPPORTED'); assert.equal(failed.items.find(i=>i.definition.stableFormKey===a.stableFormKey).status,'FAILED');
  assert.equal((await rows(binding)).find(r=>r.stable_form_key===a.stableFormKey).active,true);
  assert.equal((await f.port.publish(intent(binding,[],2))).status,'SUPPORTED');
  assert(f.mp.learned(binding.actorRef.actorId).has(f.mp.ids.get(c.stableFormKey)));
});

test('caller mutation during queued publication cannot alter detached grants or revision', async () => {
  const f=setup(), input=intent(f.binding,[grant(a)]);
  const task=f.port.publish(input);
  input.set.revision.facts=99; input.set.grants.length=0; input.binding={...input.binding,epoch:'forged'};
  assert.equal((await task).status,'SUPPORTED');
  const stored=await head(f.binding); assert.deepEqual(stored.grant_set.revision,revision(1));
  assert.equal(stored.grant_set.grants[0].definition.stableFormKey,a.stableFormKey);
});
