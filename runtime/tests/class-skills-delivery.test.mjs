import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EventEmitter } from 'node:events';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const root = fileURLToPath(new URL('../../', import.meta.url));
const workspace = fileURLToPath(new URL('../../../', import.meta.url));
const compiled = await build({ absWorkingDir: root, stdin: { loader: 'ts', resolveDir: root, contents: `
  export { classSkillValues, ClassSkillsProjection } from './runtime/src/class-skills.ts';
  export { CLASS_SKILL_NAMES } from './modules/class-progression-system/src/skills.ts';
  export { GameplayGrantService } from ${JSON.stringify(resolve(workspace, 'aetherius-client/client/src/services/services/gameplayGrantService.ts'))};
` }, bundle: true, platform: 'node', format: 'esm', write: false });
const { classSkillValues, ClassSkillsProjection, CLASS_SKILL_NAMES, GameplayGrantService } = await import(
  'data:text/javascript;base64,' + Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const data = JSON.parse(readFileSync(resolve(root, 'catalog/classes.json'), 'utf8'));
const config = JSON.parse(readFileSync(resolve(root, 'modules/class-system/config/classes-config.json'), 'utf8'));
const labels = { 'Uma-Mão':'OneHanded','Duas-Mãos':'TwoHanded','Arquearia':'Marksman','Bloqueio':'Block',
  'Armadura Pesada':'HeavyArmor','Armadura Leve':'LightArmor','Furtividade':'Sneak','Alteração':'Alteration',
  'Conjuração':'Conjuration','Destruição':'Destruction','Ilusão':'Illusion','Restauração':'Restoration' };
const all = value => Object.fromEntries(CLASS_SKILL_NAMES.map(name => [name, value]));
const revision = facts => ({ facts, grants: facts, equipment: 0, effects: 0, catalog: 1 });
const channel = 'aetherius.gameplay.grants';

function fixture() {
  const emitter = new EventEmitter(), updates = [], calls = [], packets = [], warnings = [];
  const base = all(15), modifiers = all(5);
  let present = true, fail = false, allowed = true, sendWorks = true, cycleNumber = 0;
  const player = { getBaseActorValue: name => base[name], setActorValue(name, value) {
    if (fail) throw Error('engine unavailable'); calls.push([name, value]); base[name] = value;
  } };
  const controller = { emitter, once: (_event, fn) => updates.push(fn), on: () => {} };
  const sp = { Game: { getPlayer: () => present ? player : null }, encodeUtf8: text => Buffer.from(text), printConsole: message => warnings.push(message) };
  new GameplayGrantService(sp, controller);
  const binding = { characterKey:'profile:1', profileKey:'profile:1', actorRef:{actorId:91}, epoch:'epoch-1' };
  let state;
  const receive = packet => emitter.emit('customPacketMessage', { message: { contentJsonDump: JSON.stringify(packet) } });
  const outgoing = [];
  emitter.on('sendMessage', event => outgoing.push(JSON.parse(event.message.contentJsonDump)));
  const transport = {
    current: candidate => allowed && candidate.epoch === binding.epoch ? state : undefined,
    send: (cycle, packet) => {
      if (!sendWorks) return false;
      const wire = { channel, v:1, session:cycle.session, ...packet };
      packets.push(wire); receive(wire); return true;
    }
  };
  const projection = new ClassSkillsProjection(transport, data, () => allowed, message => warnings.push(message));
  const facts = (classId, level) => ({kind:'classes',classId,level});
  const send = (classId, level, rev) => projection.publish(binding, { revision:revision(rev) }, facts(classId,level));
  function spawn({ newSession = false, complete = true } = {}) {
    let barrier;
    if (newSession || !state) {
      state = { binding, session:`session-${++cycleNumber}`, ready:false };
      receive({ channel,v:1,session:state.session,type:'hello' });
    }
    state.ready = false;
    emitter.emit('gameplaySpawnBegin', {tasks:['placement'],capture:value => {barrier = value;}});
    state.cycle = outgoing.at(-1).cycle; state.challenge = `challenge-${++cycleNumber}`;
    receive({channel,v:1,session:state.session,type:'challenge',cycle:state.cycle,challenge:state.challenge});
    if (complete) { barrier.complete('placement'); state.ready = true; }
    return barrier;
  }
  const update = () => { for (const fn of updates.splice(0)) fn(); };
  return { emitter,base,modifiers,calls,packets,warnings,receive,projection,binding,send,spawn,update,
    state: () => state, present: value => {present=value;}, fail: value => {fail=value;},
    allow: value => {allowed=value;}, sendWorks: value => {sendWorks=value;} };
}

test('all 18 classes at levels 1..40 deliver the cumulative skills declared by the official configuration', () => {
  for (const definition of Object.values(config)) for (let level=1;level<=40;level++) {
    const expected = all(0);
    for (const stage of definition.stages.filter(stage => stage.level<=level)) {
      const text = stage.skills.trim();
      if (!text) continue;
      const every = /^Todas (\d+)$/.exec(text);
      if (every) { for (const name of CLASS_SKILL_NAMES) expected[name]=Number(every[1]); }
      else for (const item of text.split(',')) {
        const [, label, value] = /^(.+?)\s+(\d+)$/.exec(item.trim());
        const name = Object.entries(labels).find(([key]) => key.toLowerCase()===label.toLowerCase())?.[1];
        assert(name, label); expected[name]=Number(value);
      }
    }
    assert.deepEqual(classSkillValues(data,definition.id,level),expected,definition.id+'@'+level);
  }
});

test('gradual leveling and a direct jump to 40 converge in the actual client receiver, preserving skill modifiers', () => {
  for (const definition of data.classes) {
    const gradual=fixture(),jump=fixture(); gradual.spawn(); jump.spawn();
    for (let level=1;level<=40;level++) { gradual.send(definition.id,level,level); gradual.update(); }
    jump.send(definition.id,40,1); jump.update();
    const expected=classSkillValues(data,definition.id,40);
    assert.deepEqual(gradual.base,expected,definition.id); assert.deepEqual(jump.base,expected,definition.id);
    assert.deepEqual(gradual.modifiers,all(5)); assert.deepEqual(jump.modifiers,all(5));
  }
});

test('blank stages retain earlier skills; decreasing levels and changing class replace all old base skills', () => {
  const f=fixture(); f.spawn();
  const cls=data.classes.find(entry=>entry.id==='piromante'); assert(cls);
  f.send(cls.id,40,1); f.update(); assert.equal(f.base.Destruction,60); assert.equal(f.base.Alteration,40);
  f.send(cls.id,5,2); f.update(); assert.deepEqual(f.base,all(20));
  f.send(data.classes.find(entry=>entry.id!==cls.id).id,1,3); f.update(); assert.deepEqual(f.base,all(0));
});

test('same composition is idempotent; pending old levels and stale revisions cannot undo a newer level', () => {
  const f=fixture(); f.spawn(); const id=data.classes[0].id;
  f.send(id,5,1); f.send(id,40,2); f.update(); assert.deepEqual(f.base,classSkillValues(data,id,40));
  const calls=f.calls.length, packet=f.packets.at(-1);
  f.send(id,40,2); f.receive(packet); f.update(); assert.equal(f.calls.length,calls);
  f.send(id,5,1); f.update(); assert.equal(f.calls.length,calls);
  f.receive({...packet,skills:all(1)}); f.update(); assert.equal(f.calls.length,calls);
});

test('delivery waits for spawn readiness; respawn and reconnect reapply the unchanged saved class', () => {
  const f=fixture(), id=data.classes[0].id; const barrier=f.spawn({complete:false});
  f.send(id,40,1); f.update(); assert.equal(f.packets.length,0);
  barrier.complete('placement'); f.state().ready=true; f.send(id,40,1); f.update();
  const first=f.packets.at(-1); assert.deepEqual(f.base,classSkillValues(data,id,40));
  for (const options of [{},{newSession:true}]) {
    f.spawn(options); Object.assign(f.base,all(15)); f.receive(first); f.update(); assert.deepEqual(f.base,all(15));
    f.send(id,40,1); f.update(); assert.deepEqual(f.base,classSkillValues(data,id,40));
  }
});

test('a packet queued before disconnect or a new spawn never mutates the next character', () => {
  const f=fixture(), id=data.classes[0].id; f.spawn(); f.send(id,40,1);
  f.emitter.emit('connectionDisconnect'); f.update(); assert.equal(f.calls.length,0);
  f.spawn({newSession:true}); f.send(id,40,1); f.spawn(); f.update(); assert.equal(f.calls.length,0);
});

test('missing player and native failures are bounded and retry without awarding skill experience', () => {
  const f=fixture(), id=data.classes[0].id; f.spawn(); f.present(false); f.send(id,40,1); f.update();
  f.present(true); f.update(); assert.deepEqual(f.base,classSkillValues(data,id,40));
  f.fail(true); f.send(id,1,2); for(let i=0;i<5;i++)f.update(); assert.equal(f.warnings.length,1);
  f.fail(false); f.spawn(); f.send(id,1,2); f.update(); assert.deepEqual(f.base,all(0));
});

test('wrong session/challenge, incomplete or invalid skills, and arbitrary actor values are refused', () => {
  const f=fixture(); f.spawn(); f.send(data.classes[0].id,5,1); f.update(); const original=f.packets.at(-1), calls=f.calls.length;
  const malformed=[{session:'other'},{challenge:'wrong'},{cycle:'old'},{skills:{...all(0),Health:999}},
    {skills:{OneHanded:100}},{skills:{...all(0),OneHanded:-1}},{skills:{...all(0),OneHanded:1.5}},
    {skills:{...all(0),OneHanded:null}},{revision:{...revision(2),facts:-1}}];
  for (const changes of malformed) f.receive({...original,revision:revision(2),...changes});
  f.update(); assert.equal(f.calls.length,calls); assert.deepEqual(f.base,all(20));
});

test('inactive/stale bindings, absent class, invalid catalog and failed sends do not cache successful delivery', () => {
  const f=fixture(), id=data.classes[0].id; f.spawn(); f.allow(false); f.send(id,40,1); assert.equal(f.packets.length,0);
  f.allow(true); f.send(null,40,1); f.send('missing-class',40,1); assert.equal(f.packets.length,0);
  assert.throws(()=>classSkillValues(data,id,41));
  f.sendWorks(false); f.send(id,40,1); assert.equal(f.packets.length,0);
  f.sendWorks(true); f.send(id,40,1); f.update(); assert.deepEqual(f.base,classSkillValues(data,id,40));
});
