import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fakeHost } from './host.mjs';
// Simulated shape/behavior from ActivateEvent.cpp (reference,caster),
// BaseDescBinding.cpp (placed reference -> local:plugin), ScampServer::MakeProperty,
// CustomPropertyBinding.cpp, PapyrusActor.cpp:559-753 and PapyrusUtils.h.
// Native grant application only: this is never client-delivery evidence.
export function standingHost({catalogAvailable=true,shift=0}={}) {
  const mp=fakeHost({catalogAvailable});
  const data=JSON.parse(readFileSync(new URL('../../catalog/standing-stones.json',import.meta.url),'utf8'));
  const originalGet=mp.get, originalId=mp.getIdFromDesc;
  const ids=new Map(), descs=new Map(), references=new Map(), properties=new Map(), values=new Map(), learned=new Map();
  const calls=[], notices=[];let missingNoticePropertyReads=0;
  const desc=key=>{const [plugin,hex]=key.split('|');return `${hex.toLowerCase()}:${plugin}`;};
  mp.getIdFromDesc=d=>{const id=originalId(d)+shift;descs.set(id,d);return id;};
  for(const r of data.records) ids.set(r.stableFormKey,mp.getIdFromDesc(desc(r.stableFormKey)));
  // Both full and light namespaces remain valid if the plugin order changes.
  const lookup=mp.lookupEspmRecordById;mp.lookupEspmRecordById=id=>lookup(id-shift);
  const own=actor=>{if(!learned.has(actor))learned.set(actor,new Set());return learned.get(actor);};
  mp.getDescFromId=id=>descs.get(id)??`dynamic:${id}`;
  mp.get=(actor,name)=>{
    if(name==='baseDesc')return references.get(actor);
    if(name==='gcStandingStoneNotice'){if(!properties.has(name)){missingNoticePropertyReads++;throw Error("Property doesn't exist");}return values.get(actor)??null;}
    return originalGet(actor,name);
  };
  mp.makeProperty=(name,definition)=>{if(properties.has(name))throw Error("'propertyName' must be unique");properties.set(name,definition);};
  mp.set=(actor,name,value)=>{assert(properties.has(name));values.set(actor,structuredClone(value));notices.push({actor,name,value:structuredClone(value)});};
  mp.callPapyrusFunction=(type,cls,method,self,args)=>{
    assert.equal(type,'method');assert.equal(cls,'Actor');assert.equal(self.type,'form');
    const actor=Number(self.desc.slice(8)), spells=own(actor);calls.push({actor,method,args:structuredClone(args)});
    if(method==='GetSpellCount')return spells.size;
    if(method==='GetNthSpell'){const id=[...spells][args[0]];return id?{type:'espm',desc:descs.get(id)}:null;}
    assert.equal(args[0].type,'espm');const id=mp.getIdFromDesc(args[0].desc);
    if(method==='AddSpell'){assert.equal(args[1],false);if(spells.has(id))return false;spells.add(id);return true;}
    if(method==='RemoveSpell')return spells.delete(id);
    throw Error('unsupported native method');
  };
  const host=Object.assign(mp,{data,ids,calls,notices,properties,learned:own,
    reference(stoneKey){const id=90000+references.size;references.set(id,desc(stoneKey));return id;},
    mutations:()=>calls.filter(c=>['AddSpell','RemoveSpell'].includes(c.method)),
    clearNoticeProperty(){properties.clear();}
  });
  Object.defineProperty(host,'missingNoticePropertyReads',{get:()=>missingNoticePropertyReads});
  return host;
}
