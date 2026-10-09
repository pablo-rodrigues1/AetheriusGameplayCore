import {raceHost} from './race-host.mjs';
import {readFileSync} from 'node:fs';
// Shapes inherited from standing-host/race-host, with PERK lookup supplied
// from signed real exports. Does not emulate perk application or death authority.
export function classHost({offlineMode=false,...options}={}){
  const mp=raceHost(options),data=JSON.parse(readFileSync(new URL('../../catalog/classes.json',import.meta.url),'utf8'));
  const settings=mp.getServerSettings,id=mp.getIdFromDesc,lookup=mp.lookupEspmRecordById,plugins=mp.getEspmLoadOrder;
  let full=100000,light=254*2**24+200000;const records=new Map(data.records.map(r=>[r.stableFormKey,r])),types=new Map();
  mp.getServerSettings=()=>({...settings(),offlineMode});
  mp.getEspmLoadOrder=()=>[...new Set([...plugins(),...data.dependencies.map(p=>p.filename)])];
  mp.getIdFromDesc=d=>{try{return id(d);}catch{
    const [hex,plugin]=d.split(':'),key=`${plugin.toLowerCase()}|${hex.padStart(6,'0').toUpperCase()}`,record=records.get(key);
    if(!record)throw Error('record absent');
    if(!mp.ids.has(key)){const value=record.pluginKind==='LIGHT'?++light:++full;mp.ids.set(key,value);types.set(value,'PERK');}
    return mp.ids.get(key);
  }};
  mp.lookupEspmRecordById=value=>types.has(value)?{record:{type:types.get(value)}}:lookup(value);
  for(const record of data.records)mp.getIdFromDesc(`${record.stableFormKey.split('|')[1]}:${record.definingPlugin}`);
  return mp;
}
