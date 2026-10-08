import {standingHost} from './standing-host.mjs';
import {readFileSync} from 'node:fs';
// Real shapes from AppearanceBinding.cpp Get (object or null), Appearance.h
// raceId:uint32, ActionListener.cpp:219-227 (set then hook),
// UpdateAppearanceAttemptEvent.cpp (actor,appearance,isAllowed). The inherited
// race spells are intentionally absent from enumeration (PapyrusActor.cpp:682-751).
export function raceHost(options={}) {
  const mp=standingHost(options),get=mp.get;
  const appearances=new Map();
  const raceData=JSON.parse(readFileSync(new URL('../../catalog/races.json',import.meta.url),'utf8'));
  for(const record of raceData.records)mp.ids.set(record.stableFormKey,mp.getIdFromDesc(`${record.stableFormKey.split('|')[1].toLowerCase()}:${record.definingPlugin}`));
  mp.get=(actor,name)=>name==='appearance'?appearances.get(actor)??null:get(actor,name);
  mp.appearances=appearances;mp.raceData=raceData;
  mp.changeAppearance=(actor,key,{allowed=true,argumentKey=key}={})=>{
    if(allowed)appearances.set(actor,{raceId:mp.ids.get(key)});
    return mp.onUpdateAppearanceAttempt?.(actor,{raceId:mp.ids.get(argumentKey)},allowed);
  };
  return mp;
}
