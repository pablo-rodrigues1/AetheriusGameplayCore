import assert from 'node:assert/strict';
import {test,before,after} from 'node:test';
import {createRequire} from 'node:module';
import {randomBytes} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {readFile} from 'node:fs/promises';
import {api,utils,root,load,perkMigration} from './b5b-source.mjs';
import {classHost} from './class-host.mjs';
import {officialHost} from './official-host.mjs';
import {logger} from './host.mjs';
import {developmentEnv} from './development-env.mjs';
import {client} from './perk-client.mjs';
import {xpInput} from './xp-event.mjs';
import {perksPerClass} from '../../tools/catalog/perks-per-class.mjs';
// Client executes gameplayGrantService.ts itself, using SP's void add/remove
// and boolean HasPerk. Wire ACK: receivePerks/apply/update in that file;
// exact example: _work/evidence/H/server-20261012-150751.log, 15:10:43.
const {Pool}=createRequire(import.meta.url)('pg'),url=new URL(process.env.AETHERIUS_TEST_DATABASE_URL??'missing:');
assert(['localhost','127.0.0.1','[::1]'].includes(url.hostname)&&url.pathname==='/aetherius_test','Only local aetherius_test');
const schema='gc_c3b_sweep_'+randomBytes(8).toString('hex');
const pool=new Pool({connectionString:process.env.AETHERIUS_TEST_DATABASE_URL,max:8,connectionTimeoutMillis:2000,options:'-c search_path='+schema+',pg_catalog'});
const data=load('catalog/classes.json'),runtimes=[];
const milestones=[...data.classes].sort((a,b)=>a.id.localeCompare(b.id,'en')).flatMap(c=>[...c.stages].sort((a,b)=>a.level-b.level).map(s=>({classId:c.id,level:s.level,stage:s})));
const total=milestones.length,stepLines=f=>f.log.messages.filter(l=>/DEV sweep \d+\/\d+ /.test(l));
const expected=(id,level)=>new Set(data.classes.find(c=>c.id===id).stages.filter(s=>s.level<=level).flatMap(s=>s.perks.filter(p=>p.status==='SUPPORTED').map(p=>p.stableFormKey)));
let profile=993000;
before(async()=>{await pool.query('CREATE SCHEMA "'+schema+'"');await utils.applyMigrations(pool,[...await utils.readMigrations(root+'/database/migrations'),perkMigration],schema);});
after(async()=>{await Promise.all(runtimes.map(c=>c.shutdown()));await pool.query('DROP SCHEMA "'+schema+'" CASCADE');await pool.end();});
async function until(fn,timeout=15000){const end=performance.now()+timeout;while(!(await fn())){if(performance.now()>end)throw Error('C3b condition timeout');await delay(5);}}
async function fixture({enabled=true,env={},original='viper',intercept,extraPerk=false,seedProgress=false}={}){
  const mp=classHost({catalogAvailable:true,offlineMode:true}),log=logger(),c=client(),packets=[],acks=[],callsAtAck=[],atSend=new Map();
  mp.profiles.set(91,++profile);mp.appearances.set(91,{raceId:mp.ids.get('skyrim.esm|013746')});
  mp.getUserActor=user=>[...mp.users].find(([actor,u])=>u===user&&mp.online.includes(actor))?.[0]??0;
  const official=officialHost(mp);official.authenticate(91);
  let f,automatic=true,outstanding=false,canPump=()=>true;
  const pump=()=>{if(canPump())c.update();};
  mp.sendCustomPacket=(user,raw)=>{try{assert.equal(user,0);const p=JSON.parse(raw);packets.push(p);if(['hello','challenge'].includes(p.type))outstanding=false;
    if(p.type==='perks'){atSend.set(p.id,{calls:c.calls.length,present:new Set(p.items.filter(i=>i.action==='ensure'&&c.forms.has(i.key)&&c.perks.has(c.forms.get(i.key).id)).map(i=>i.key))});if(enabled&&env.GAMEPLAY_CORE_DEV_CLASS_SWEEP!=='false')assert.equal(outstanding,false,'never two deliveries in flight');outstanding=true;intercept?.(p,packets.filter(p=>p.type==='perks').length,f);}
    c.receive(p);}catch(error){log.info('HARNESS_SEND_ERROR: '+error.message);throw error;}};
  c.emitter.on('sendMessage',e=>{const p=JSON.parse(e.message.contentJsonDump);
    if(p.type==='ack'){acks.push(p);callsAtAck.push(c.calls.length);const sent=atSend.get(p.id);for(const key of sent.present)assert(!c.calls.slice(sent.calls).some(call=>call[1]===key),'shared presence never triggers add/remove');outstanding=false;}
    if(automatic)mp.emitter.emit('customPacket',0,e.message.contentJsonDump);});
  for(const r of data.records)c.register({stableFormKey:r.stableFormKey});
  const barrier=c.spawn();
  const core=api.createGameplayCore({mp,pg:{init:()=>pool},log,env:{...developmentEnv,GAMEPLAY_CORE_DATABASE_SCHEMA:schema,GAMEPLAY_CORE_MODE_CLASSES:'active',GAMEPLAY_CORE_CLIENT_PERKS_MODE:'active',GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40',...extraPerk?{GAMEPLAY_CORE_MODE_SWEEP_EXTRA_TEST:'active'}:{},...enabled?{GAMEPLAY_CORE_DEV_CLASS_SWEEP:'true'}:{},...env}});
  if(extraPerk)core.register({id:'sweep-extra-test',requiresDatabase:false,start(ctx){
    ctx.composition.register({id:'sweep-extra-test',async read(tx,key){
      const cls=(await tx.query('SELECT class_id FROM gc_character_class WHERE character_key=$1',[key])).rows[0]?.class_id;
      if(packets.filter(p=>p.type==='perks').length!==1||cls!==data.classes[0].id)return {grants:[],revision:0};
      const p=data.classes[0].stages.at(-1).perks[0];
      return {grants:[{kind:'perk',rank:p.rank,source:{kind:'CLASS',key:cls},revision:0,
        definition:{recordType:'PERK',stableFormKey:p.stableFormKey,catalogSignature:data.records.find(r=>r.stableFormKey===p.stableFormKey).signature}}],revision:0};
    }});
  }});
  runtimes.push(core);await core.initialize();const binding=core.identity.lookup({actorId:91}).value;
  f={mp,log,c,packets,acks,callsAtAck,core,binding,official,set automatic(v){automatic=v;},get automatic(){return automatic;},
    pump,holdFrameUntil:predicate=>{canPump=predicate;},ready:()=>{for(const task of ['spells','appearance','equipment','placement'])barrier.complete(task);},
    finish:async()=>{try{await until(()=>{pump();return log.messages.some(l=>l.includes('DEV sweep done:'));});}catch(e){throw Error(e.message+'\n'+log.messages.join('\n')+'\nPackets: '+JSON.stringify(packets.filter(p=>p.type==='perks').map(p=>({id:p.id,revision:p.revision,keys:p.items.filter(i=>i.action==='ensure').map(i=>i.key)}))));}},
    currentClass:async()=>(await pool.query('SELECT class_id FROM gc_character_class WHERE character_key=$1',[binding.characterKey])).rows[0]?.class_id};
  if(original)assert.equal((await core.setCharacterClass({binding,classId:original,requestId:randomBytes(8).toString('hex')})).status,'SUPPORTED');
  if(seedProgress){
    const adapter=api.createDurableLeveling(pool,(await new utils.ConfigLoader(root+'/modules/leveling-system').load()).configs);
    await adapter.award({characterKey:binding.characterKey,epoch:binding.epoch,...xpInput('sweep-seed')});
  }
  return f;
}
for(const nodeEnv of [undefined,'local','production','staging'])for(const access of [undefined,'true'])for(const optin of [undefined,'true']){
  const allowed=nodeEnv==='local'&&access!=='true'&&optin==='true';
  test('sweep development gate '+nodeEnv+'/'+access+'/'+optin,async()=>{
    const f=await fixture({original:null,env:{NODE_ENV:nodeEnv,GAME_ACCESS_CONTROL:access,GAMEPLAY_CORE_ALLOW_DEV_OPTIONS:optin}});
    assert.equal(f.log.messages.some(m=>m.includes('ERROR')&&m.includes('GAMEPLAY_CORE_DEV_CLASS_SWEEP')),!allowed);
    assert.equal(f.log.messages.some(m=>m.includes('DEV class sweep enabled')),allowed);
    await f.core.shutdown();
  });
}
for(const env of [{GAMEPLAY_CORE_DEV_CLASS_LEVEL:undefined},{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'41'},
  {GAMEPLAY_CORE_CLIENT_PERKS_MODE:'canary'},{GAMEPLAY_CORE_CLIENT_PERKS_MODE:'off'},
  {GAMEPLAY_CORE_DEV_CLASS_SWEEP:''},{GAMEPLAY_CORE_DEV_CLASS_SWEEP:'yes'}]){
  test('sweep prerequisite '+JSON.stringify(env),async()=>{
    const f=await fixture({env,original:null});assert(f.log.messages.some(m=>m.includes('ERROR')&&/sweep|SWEEP/.test(m)));
    f.ready();await delay(20);f.pump();assert(!f.log.messages.some(m=>m.includes('DEV sweep 1/')));await f.core.shutdown();
  });
}
test('sweep flag false/empty outside development is explicitly refused, other systems retain behavior',async()=>{
  for(const raw of ['false','']){
    const f=await fixture({env:{NODE_ENV:'production',GAMEPLAY_CORE_DEV_CLASS_SWEEP:raw,GAMEPLAY_CORE_DEV_CLASS_LEVEL:undefined}});
    assert(f.log.messages.some(m=>m.includes('ERROR')&&m.includes('GAMEPLAY_CORE_DEV_CLASS_SWEEP')));await f.core.shutdown();
  }
});
test('all catalog classes and milestones confirmed; original level restored; second session never repeats',async()=>{
  let staff;const f=await fixture({env:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'17'},intercept(p,n,f){if(n===2)staff=f.core.setCharacterClass({binding:f.binding,classId:'guardiao',requestId:'staff-during-sweep'});}});f.ready();await f.finish();
  assert.equal((await staff).reason,'DEV_SWEEP_IN_PROGRESS');
  console.log(f.log.messages.filter(l=>l.includes('DEV sweep ')).join('\n'));
  const steps=stepLines(f);assert.equal(steps.length,total);assert(steps.every(l=>l.endsWith('result=OK')));
  steps.forEach((line,i)=>{const m=milestones[i],n=expected(m.classId,m.level).size;
    assert(line.includes((i+1)+'/'+total+' '+m.classId+'@'+m.level+': expected='+n+'; new='+new Set(m.stage.perks.map(p=>p.stableFormKey)).size+';'));});
  assert.equal(await f.currentClass(),'viper');assert(f.log.messages.some(l=>l.includes('done: ok='+total+' fail=0; classes='+data.classes.length+'; milestones='+total+'; restored=viper; delivery=CONFIRMED')));
  assert.equal(f.packets.filter(p=>p.type==='perks').length,total+2);
  assert.deepEqual(new Set(f.packets.filter(p=>p.type==='perks').at(-1).items.filter(i=>i.action==='ensure').map(i=>i.key)),expected('viper',17));
  for(let n=1;n<f.acks.length;n++){
    const previous=new Set(f.acks[n-1].items.filter(i=>i.action==='ensure'&&!['FAILED','UNRESOLVED'].includes(i.status)).map(i=>i.key));
    const current=f.acks[n];
    for(const i of current.items.filter(i=>i.action==='ensure'&&previous.has(i.key)))assert.equal(i.status,'APPLIED');
    for(const i of current.items.filter(i=>i.action==='remove'))assert(!current.items.some(j=>j.key===i.key&&j.action==='ensure')); 
    for(const i of current.items.filter(i=>i.action==='remove'))assert(previous.has(i.key));
  }
  assert(!f.log.messages.some(l=>/REVISION_CONTENT_CONFLICT|STALE_OR_INCOMPARABLE/.test(l)));
  const progress=await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[f.binding.characterKey]);assert.equal(progress.rows.length,0);
  const commands=await pool.query('SELECT command_type FROM gc_commands WHERE character_key=$1',[f.binding.characterKey]);assert(commands.rows.every(r=>r.command_type==='classes.set'));assert.equal(commands.rows.length,data.classes.length+2,'one set per class plus seed and restoration');
  f.mp.online=[];f.mp.emitter.emit('disconnect',0);f.mp.online=[91];f.official.authenticate(91);f.core.identity.poll();
  const next=f.c.spawn();for(const task of ['spells','appearance','equipment','placement'])next.complete(task);
  await until(()=>{f.pump();return f.acks.length>=total+3;});await delay(30);f.pump();assert.equal(stepLines(f).length,total);
  await f.core.shutdown();
});
test('initial same class still obtains a fresh ACK',async()=>{
  const f=await fixture({original:'anti_mago',env:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'1'}});f.ready();await f.finish();
  const initial=f.acks[0],step=f.acks[1];assert(step.revision.grants>initial.revision.grants);assert.notEqual(step.id,initial.id);
  assert(step.items.every(i=>i.status==='APPLIED'));assert.equal(f.callsAtAck[1],f.callsAtAck[0],'same class keeps present perks without readding');assert.equal(await f.currentClass(),'anti_mago');await f.core.shutdown();
});
test('actual client UNRESOLVED/FAILED ACKs become FAIL and continue to the last class',async()=>{
  let missing;
  const f=await fixture({intercept(p,n,f){
    if(n===3){missing=[p.items[0].key,f.c.forms.get(p.items[0].key)];f.c.forms.delete(missing[0]);}
    if(n===4){f.c.forms.set(...missing);const player=f.c.sp.Game.getPlayer(),add=player.addPerk,blocked=p.items.find(i=>i.action==='ensure'&&!f.c.perks.has(f.c.forms.get(i.key).id));
      assert(blocked);player.addPerk=perk=>{if(perk.key!==blocked.key)add(perk);};}
    if(n===5){const player=f.c.sp.Game.getPlayer();player.addPerk=perk=>{f.c.calls.push(['add',perk.key]);f.c.perks.add(perk.id);};}
  }});
  f.ready();await f.finish();assert(f.acks.some(p=>p.items.some(i=>i.status==='UNRESOLVED')));assert(f.acks.some(p=>p.items.some(i=>i.status==='FAILED')));
  assert(f.log.messages.some(l=>l.includes('FAIL(UNRESOLVED)')));assert(f.log.messages.some(l=>l.includes('FAIL(FAILED_ITEMS)')));
  assert.equal(stepLines(f).length,total);assert.equal(await f.currentClass(),'viper');await f.core.shutdown();
});
test('ACK timeout aborts and restores the durable class and its delivery',async()=>{
  const f=await fixture({env:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'17'},intercept(p,n,f){if(n===2)f.automatic=false;if(n===3)f.automatic=true;}});
  f.ready();await f.finish();assert(f.log.messages.some(l=>l.includes('ABORTED step=1/'+total+'; reason=ACK_TIMEOUT')));
  assert.equal(await f.currentClass(),'viper');assert(f.log.messages.some(l=>l.includes('restored=viper; delivery=CONFIRMED')));
  assert.deepEqual(new Set((await f.core.inspectActor(f.binding)).grants.filter(g=>g.source.kind==='CLASS').map(g=>g.definition.stableFormKey)),expected('viper',17));await f.core.shutdown();
});
for(const action of ['leave','death','respawn','loading','shutdown'])test(action+' aborts with original class restored even with stale binding',async()=>{
  const f=await fixture({env:{GAMEPLAY_CORE_DEV_CLASS_LEVEL:'17'},intercept(p,n,f){if(n!==2)return;
    f.automatic=false;
    if(action==='leave'){f.mp.online=[];f.mp.emitter.emit('disconnect',0);}
    if(action==='death')f.mp.onDeath(91,0);
    if(action==='respawn')f.mp.onRespawn(91);
    if(action==='loading')f.core.actorEvents.clientLoading(f.binding);
  }});
  f.ready();
  if(action==='shutdown'){await until(()=>{f.pump();return f.packets.filter(p=>p.type==='perks').length>=2;});await f.core.shutdown();}
  else await f.finish();
  assert(f.log.messages.some(l=>l.includes('DEV sweep ABORTED')));assert.equal(await f.currentClass(),'viper');
  assert.equal(stepLines(f).length,0);
  if(!['leave','loading','shutdown'].includes(action))assert.deepEqual(new Set((await f.core.inspectActor(f.binding)).grants.filter(g=>g.source.kind==='CLASS').map(g=>g.definition.stableFormKey)),expected('viper',17));await f.core.shutdown();
});
test('ready during an aborted spawn waits for restoration before class composition',async()=>{
  let barrier;
  const f=await fixture({intercept(p,n,f){if(n===2){
    // Deliberately complete the new ready owners before its first client frame.
    // This ordering exposed the race; it must never replace an unacknowledged id.
    const readyLogs=f.log.messages.filter(l=>l.startsWith('[classes] active:')).length;
    f.holdFrameUntil(()=>f.log.messages.filter(l=>l.startsWith('[classes] active:')).length>readyLogs);
    f.mp.onRespawn(91);barrier=f.c.spawn();for(const task of ['spells','appearance','equipment','placement'])barrier.complete(task);}}});
  f.ready();await f.finish();await until(()=>{f.pump();const last=f.packets.filter(p=>p.type==='perks').at(-1);return last&&f.acks.some(a=>a.id===last.id)&&last.items.filter(i=>i.action==='ensure').length===expected('viper',40).size&&last.items.filter(i=>i.action==='ensure').every(i=>expected('viper',40).has(i.key));}).catch(e=>{throw Error(e.message+'\n'+f.log.messages.join('\n')+'\n'+JSON.stringify(f.packets.map(p=>({type:p.type,revision:p.revision,challenge:p.challenge}))));});
  assert.equal(await f.currentClass(),'viper');const last=f.packets.filter(p=>p.type==='perks').at(-1);
  const keys=new Set(data.classes.find(c=>c.id==='viper').stages.flatMap(s=>s.perks.map(p=>p.stableFormKey)));
  assert.deepEqual(new Set(last.items.filter(i=>i.action==='ensure').map(i=>i.key)),keys);await f.core.shutdown();
});
test('absent original class is refused before mutation',async()=>{
  const f=await fixture({original:null});f.ready();await f.finish();assert(f.log.messages.some(l=>l.includes('ORIGINAL_CLASS_REQUIRED')));
  assert.equal(await f.currentClass(),undefined);await f.core.shutdown();
});
for(const flag of [undefined,'false'])test('disabled sweep '+flag+' keeps the B5b path unchanged',async()=>{
  const f=await fixture({enabled:false,env:{GAMEPLAY_CORE_DEV_CLASS_SWEEP:flag}});f.ready();
  await until(()=>{f.pump();return f.log.messages.some(l=>l.includes('perks ')&&l.includes('CONFIRMED'));});
  await delay(30);const deliveries=f.packets.filter(p=>p.type==='perks');assert(deliveries.length>=1);assert(deliveries.every(p=>p.revision.facts===1&&p.revision.grants===1));assert.equal(f.c.calls.filter(c=>c[0]==='add').length,19);assert.equal(f.c.calls.filter(c=>c[0]==='remove').length,0);assert.equal((await pool.query('SELECT count(*)::int AS n FROM gc_commands WHERE character_key=$1',[f.binding.characterKey])).rows[0].n,1);assert(!f.log.messages.some(l=>l.includes('DEV sweep ')));assert.equal(await f.currentClass(),'viper');await f.core.shutdown();
});
test('generated table exactly matches current signed 18-class/350-entry catalog (order says 351) and ungranted prerequisites',async()=>{
  const text=perksPerClass(data);assert.equal(text,await readFile(root+'/docs/classes/PERKS_POR_CLASSE.md','utf8'));
  assert.equal((text.match(/^## /gm)??[]).length,18);assert.equal((text.match(/^\| [0-9]+ \|/gm)??[]).length,350);
  const row=text.split('\n').find(l=>l.includes('| Mystic Binding |'));assert(row.includes('Skyrim.esm \\| 0F2CA7'));
  assert.equal(perksPerClass({...data,classes:[...data.classes].reverse()}),text);assert(!/\| [0-9A-F]{8}\b/.test(text));
});

test('Core reload on the same native host never repeats the sweep',async()=>{
  const f=await fixture();f.ready();await f.finish();await f.core.shutdown();
  const log=logger(),barrier=f.c.spawn();
  const next=api.createGameplayCore({mp:f.mp,pg:{init:()=>pool},log,env:{...developmentEnv,GAMEPLAY_CORE_DATABASE_SCHEMA:schema,
    GAMEPLAY_CORE_MODE_CLASSES:'active',GAMEPLAY_CORE_CLIENT_PERKS_MODE:'active',GAMEPLAY_CORE_DEV_CLASS_LEVEL:'40',GAMEPLAY_CORE_DEV_CLASS_SWEEP:'true'}});
  runtimes.push(next);await next.initialize();for(const task of ['spells','appearance','equipment','placement'])barrier.complete(task);
  await until(()=>{f.pump();return log.messages.some(l=>l.includes('perks ')&&l.includes('CONFIRMED'));});
  await delay(30);assert(!log.messages.some(l=>l.includes('DEV sweep ')));assert.equal(await f.currentClass(),'viper');await next.shutdown();
});

test('future class milestone perk confirmed by the real simulated client is FAIL and sweep continues',async()=>{
  const f=await fixture({extraPerk:true});f.ready();await f.finish();
  assert(f.log.messages.some(l=>l.includes('1/'+total+' '+milestones[0].classId+'@'+milestones[0].level)&&l.endsWith('FAIL(UNEXPECTED_CLASS_PERK)')));
  assert.equal(stepLines(f).length,total);assert.equal(await f.currentClass(),'viper');await f.core.shutdown();
});
test('C3d: sweep refuses stored XP before any mutation, one error line, class/progress retained',async()=>{
  const f=await fixture({seedProgress:true});
  const before=(await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[f.binding.characterKey])).rows;
  const receipts=(await pool.query('SELECT count(*)::int AS n FROM gc_commands WHERE character_key=$1',[f.binding.characterKey])).rows[0].n;
  f.ready();await until(()=>{f.pump();return f.log.messages.some(l=>l.includes('SWEEP_WOULD_RESET_PROGRESS'));});
  assert.equal(f.log.messages.filter(l=>l.includes('SWEEP_WOULD_RESET_PROGRESS')).length,1);
  assert.equal(stepLines(f).length,0);assert.equal(await f.currentClass(),'viper');
  assert.deepEqual((await pool.query('SELECT * FROM gc_leveling_progress WHERE character_key=$1',[f.binding.characterKey])).rows,before);
  assert.equal((await pool.query('SELECT count(*)::int AS n FROM gc_commands WHERE character_key=$1',[f.binding.characterKey])).rows[0].n,receipts);await f.core.shutdown();
});
test('C3d: sweep refuses saved allocation before any class command',async()=>{
  const f=await fixture();await f.core.allocateAttributes({binding:f.binding,requestId:'sweep-allocation',health:5,magicka:0,stamina:0});
  const before=(await pool.query('SELECT * FROM gc_attribute_allocation WHERE character_key=$1',[f.binding.characterKey])).rows;
  f.ready();await until(()=>{f.pump();return f.log.messages.some(l=>l.includes('SWEEP_WOULD_RESET_PROGRESS'));});
  assert.equal(stepLines(f).length,0);assert.equal(await f.currentClass(),'viper');
  assert.deepEqual((await pool.query('SELECT * FROM gc_attribute_allocation WHERE character_key=$1',[f.binding.characterKey])).rows,before);await f.core.shutdown();
});
