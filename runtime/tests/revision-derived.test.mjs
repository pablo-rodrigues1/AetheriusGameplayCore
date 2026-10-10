import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createRequire} from 'node:module';
import {randomBytes,createHash} from 'node:crypto';
import {api,utils,root,load,perkMigration} from './b5b-source.mjs';
import {spellMp,sessionEvents} from './projection-host.mjs';
const {Pool}=createRequire(import.meta.url)('pg'),url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test');
const schema=`gc_fix1010_${process.pid}_${randomBytes(4).toString('hex')}`;
const pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:5,options:`-c search_path=${schema},pg_catalog`});
before(async()=>{await pool.query(`CREATE SCHEMA "${schema}"`);await utils.applyMigrations(pool,[...await utils.readMigrations(`${root}/database/migrations`),perkMigration],schema);});
after(async()=>{await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();});

test('FIX-1010 catalog signature exchange across boots advances publication counters; same derivation stays idempotent; old publication refused',async()=>{
  const binding={characterKey:'profile:101010',profileKey:'profile:101010',epoch:'first',actorRef:{actorId:91}};
  const domain=load('catalog/standing-stones.json');
  const original=api.standingStoneGrants(utils.definitionCatalog(domain),{stoneKey:'skyrim.esm|0D232D',revision:2});
  assert(original.length>0);
  const external=domain.records.find(r=>r.recordType==='SPEL'&&!original.some(g=>g.definition.stableFormKey===r.stableFormKey));
  const definitions=[...original.map(g=>g.definition),{stableFormKey:external.stableFormKey,recordType:'SPEL',catalogSignature:external.signature}];
  const mp=spellMp(definitions),actors=sessionEvents();
  mp.learned(91).add(mp.ids.get(external.stableFormKey));
  let current=original;
  // Two catalog versions for the same stable records. The replacement signature
  // is an explicit version fixture, not a claim about another installed winner.
  const catalog={lookup:d=>current.some(g=>JSON.stringify(g.definition)===JSON.stringify(d))?{status:'SUPPORTED',value:{definition:d}}:{status:'UNSUPPORTED'},
    resolve:(key,signature)=>current.some(g=>g.definition.stableFormKey===key&&g.definition.catalogSignature===signature)?{status:'SUPPORTED',value:mp.ids.get(key)}:{status:'UNSUPPORTED'}};
  const port=new api.SpellProjection({pool,schema,mp,catalogs:[catalog],identity:{isCurrent:()=>true},actors,signal:new AbortController().signal,warn:()=>{}});
  actors.ready(binding);
  const make=()=>{const c=new api.ActorComposition({pool,schema,check:()=>{},publish:(b,set)=>port.publish({binding:b,set})});
    c.register({id:'standing-stones',read:async()=>({revision:2,grants:current})});return c;};
  let composition=make();
  const first=await composition.recompose(binding);assert.equal(first.status,'SUPPORTED');
  const old=await composition.inspect(binding);await composition.shutdown();
  current=original.map(g=>({...g,definition:{...g.definition,catalogSignature:createHash('sha256').update(g.definition.catalogSignature+'catalog-v2').digest('hex')}}));
  composition=make();const next=await composition.recompose(binding);assert.equal(next.status,'SUPPORTED');
  assert(next.value.revision.grants>old.revision.grants);assert(next.value.revision.catalog>old.revision.catalog);
  assert.equal(next.value.revision.facts,old.revision.facts);
  const count=mp.calls.length;const duplicate=await composition.recompose(binding);assert.equal(duplicate.value.state,'UNCHANGED');assert.equal(mp.calls.length,count);
  assert.equal((await port.publish({binding,set:old})).reason,'STALE_OR_INCOMPARABLE_REVISION');
  assert(mp.learned(91).has(mp.ids.get(external.stableFormKey)));assert(!mp.calls.some(c=>c.method==='RemoveSpell'));
  await composition.shutdown();await port.shutdown();
});
