import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {api,utils,root,load,perkMigration} from './b5b-source.mjs';
import {setTimeout as delay} from 'node:timers/promises';
const {Pool}=createRequire(import.meta.url)('pg'),url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test');
const schema=`gc_b5b_adapter_${process.pid}_${randomBytes(4).toString('hex')}`,pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:5,options:`-c search_path=${schema},pg_catalog`});
const data=load('catalog/classes.json'),definitions=data.records.slice(0,3).map(r=>({stableFormKey:r.stableFormKey,recordType:r.recordType,catalogSignature:r.signature}));let profile=99000;const adapters=[];
before(async()=>{await pool.query(`CREATE SCHEMA "${schema}"`);await utils.applyMigrations(pool,[...await utils.readMigrations(`${root}/database/migrations`),perkMigration],schema);});
after(async()=>{await Promise.all(adapters.map(p=>p.shutdown()));await pool.query(`DROP SCHEMA "${schema}" CASCADE`);await pool.end();});
const revision=n=>({facts:n,grants:n,equipment:0,effects:0,catalog:1});
const grant=(definition,kind='CLASS',rank=1)=>({kind:'perk',definition,rank,revision:1,source:{kind,key:kind.toLowerCase()}});
function setup({portPool=pool}={}){
  const key=`profile:${++profile}`,binding={characterKey:key,profileKey:key,epoch:'epoch',actorRef:{actorId:91}},state={binding,user:0,session:'session',cycle:'spawn',challenge:'challenge',ready:true};
  let receiver,reset,current=true;const packets=[],acks=[],native=new Set();
  const channel={onReset:fn=>{reset=fn;return()=>{};},onAck:fn=>{receiver=fn;return()=>{};},current:()=>current?state:undefined,send:(_,p)=>{packets.push(p);return true;}};
  const port=new api.PerkDelivery({pool:portPool,schema,channel,catalogs:[{lookup:d=>definitions.some(x=>JSON.stringify(x)===JSON.stringify(d))?{status:'SUPPORTED',value:{definition:d}}:{status:'UNSUPPORTED'}}],rankRecords:new Map(),check:()=>{if(!current)throw Error('STALE');},nativeRecords:()=>native,warn:()=>{}});
  adapters.push(port);port.onAck(a=>acks.push(a));
  const publish=(grants,n=1,reconcile=false)=>port.publish({binding,set:{characterKey:key,grants,revision:revision(n)}},reconcile);
  const ack=(statuses,modify={})=>{const p=packets.at(-1);receiver(state,{channel:'aetherius.gameplay.grants',v:1,session:state.session,type:'ack',cycle:state.cycle,challenge:state.challenge,id:p.id,revision:p.revision,items:p.items.map((i,n)=>({key:i.key,signature:i.signature,action:i.action,status:statuses[n]??'APPLIED'})),...modify});};
  return {key,binding,state,port,packets,acks,native,publish,ack,reset:()=>reset(binding),invalidate:()=>current=false};
}
async function until(fn){const end=performance.now()+3000;while(!(await fn())){assert(performance.now()<end,'adapter timeout');await delay(5);}}
test('RACE and native standing-stone perks are never sent, shared record native source wins',async()=>{
  const f=setup();await f.publish([grant(definitions[0]),grant(definitions[0],'RACE'),grant(definitions[1],'STANDING_STONE'),grant(definitions[2])]);assert.deepEqual(f.packets[0].items.map(i=>i.key),[definitions[2].stableFormKey]);
});
test('real signed stone SPEL to MGEF PerkToApply links are identified for native suppression',()=>{
  const stones=load('catalog/standing-stones.json'),catalog=utils.definitionCatalog(stones);
  const keys=new Set();
  for(const root of catalog.roots){if(root.data.grantStatus!=='SUPPORTED')continue;
    const grants=api.standingStoneGrants(catalog,{stoneKey:root.definition.stableFormKey,revision:1});
    for(const key of api.nativeStonePerkKeys({characterKey:'profile:1',grants,revision:revision(1)},stones))keys.add(key);
  }
  assert(keys.size>0);assert(keys.has('skyrim.esm|0E5F46'));
});
test('unrepresentable rank is UNSUPPORTED by item, audited separate record rank remains allowed in full viper tests',async()=>{
  const f=setup(),result=await f.publish([grant(definitions[0],'CLASS',9)]);assert.equal(result.items[0].reason,'RANK_NOT_AUDITED_AS_DISTINCT_RECORD');assert.equal(f.packets[0].items.length,0);f.ack([]);await until(()=>f.acks.length);assert.equal(f.acks[0].status,'unsupported');assert.equal(f.port.status(f.binding).state,'PARTIAL');
});
test('timeout never becomes applied, expired ACK rejected, next reconciliation resends and confirms',async t=>{
  let now=0;t.mock.method(performance,'now',()=>now);const f=setup();await f.publish([grant(definitions[0])]);now=10001;f.ack(['APPLIED']);await delay(10);
  assert.equal(f.acks.length,0);assert.equal(f.port.status(f.binding).state,'SENT_UNCONFIRMED');assert.equal((await pool.query('SELECT count(*)::int AS n FROM gc_perk_projections WHERE character_key=$1',[f.key])).rows[0].n,0);
  await f.publish([grant(definitions[0])],1,true);assert.equal(f.packets.length,2);f.ack(['APPLIED']);await until(()=>f.acks.length===1);assert.equal(f.port.status(f.binding).state,'CONFIRMED');
});
test('ACK persistence failure rolls back entire batch; no success event before transaction commit',async()=>{
  let fail=true;const portPool={async connect(){const real=await pool.connect();let inserts=0;return {release:e=>real.release(e),async query(sql,p){if(fail&&sql.startsWith('INSERT INTO')&&++inserts===2)throw Error('INJECTED_FAILURE');return real.query(sql,p);}};}};
  const f=setup({portPool});await f.publish([grant(definitions[0]),grant(definitions[1])]);f.ack(['APPLIED','APPLIED']);await delay(40);assert.equal(f.acks.length,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM gc_perk_projections WHERE character_key=$1',[f.key])).rows[0].n,0);
  fail=false;f.ack(['APPLIED','APPLIED']);await until(()=>f.acks.length===1);assert.equal((await pool.query('SELECT count(*)::int AS n FROM gc_perk_projections WHERE character_key=$1',[f.key])).rows[0].n,2);
});
test('becoming native relinquishes durable ownership without remove; losing native source still protects that record',async()=>{
  const f=setup();await f.publish([grant(definitions[0])]);f.ack(['APPLIED']);await until(()=>f.acks.length);f.native.add(definitions[0].stableFormKey);
  await f.publish([grant(definitions[0])],2);assert.equal(f.packets.at(-1).items.length,0);assert.equal((await pool.query('SELECT owned FROM gc_perk_projections WHERE character_key=$1',[f.key])).rows[0].owned,false);
  f.native.clear();await f.publish([],3);assert.equal(f.packets.at(-1).items.length,0);
});
test('new cycle during in-flight ACK transaction prevents stale commit',async()=>{
  let invalidate;const portPool={async connect(){const real=await pool.connect();return {release:e=>real.release(e),async query(sql,p){const value=await real.query(sql,p);if(invalidate&&sql.startsWith('INSERT INTO'))invalidate();return value;}};}};
  const f=setup({portPool});invalidate=()=>{f.state.ready=false;f.reset();};await f.publish([grant(definitions[0])]);f.ack(['APPLIED']);await delay(40);assert.equal(f.acks.length,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM gc_perk_projections WHERE character_key=$1',[f.key])).rows[0].n,0);
});
