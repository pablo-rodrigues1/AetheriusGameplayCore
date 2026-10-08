import {readFileSync,writeFileSync} from 'node:fs';
import {fileURLToPath} from 'node:url';
import path from 'node:path';

/** Classification A3 is an input, never a hand-maintained racial spell map. */
export function buildOwnership(data, classifications) {
  const records=new Map(data.records.map(r=>[r.stableFormKey,r]));
  const keys=new Map(data.records.map(r=>{const [plugin,id]=r.stableFormKey.split('|');return [`${id}:${plugin}`.toLowerCase(),r.stableFormKey];}));
  const classification=new Map(classifications.map(row=>[keys.get(row.formid?.toLowerCase()),row]));
  const result=[];
  const damage=/^Mod(?:IncomingDamage|AttackDamage|SneakAttackMult|SpellMagnitude|IncomingSpellMagnitude|FallingDamage)$/;
  for(const raceKey of data.roots) {
    const race=records.get(raceKey),perks=new Map();
    for(const spellKey of race.data.actorEffects) {
      const spell=records.get(spellKey),c=classification.get(spellKey);
      if(!spell||!c)throw Error(`Required racial classification absent: ${spellKey}`);
      const details=spell.data.effects.map(key=>{
        const effect=records.get(key);if(!effect)throw Error(`Effect absent: ${key}`);
        const fields=effect.data.fields;
        const scripts=Object.entries(fields).filter(([k])=>/^VirtualMachineAdapter\.Scripts\[\d+\]\.Name$/.test(k)).map(([,v])=>v);
        const type=fields['Archetype.Type']??'UNSUPPORTED';
        if(fields.PerkToApply){const links=perks.get(fields.PerkToApply)??new Set();links.add(key);perks.set(fields.PerkToApply,links);}
        const mechanism=scripts.length?'CLIENT_SCRIPT_REQUIRED':type==='Script'?'MARKER_SEMANTICS_UNVERIFIED':'NATIVE_ENGINE';
        return {key,family:`${type}/${fields['Archetype.ActorValue']??'None'}`,mechanism,
          ...(scripts.length?{scripts}:{}),...(fields.PerkToApply?{perkToApply:fields.PerkToApply}:{})};
      });
      result.push({raceKey,raceEditorId:race.data.editorId,stableFormKey:spellKey,editorId:spell.data.editorId,recordType:'SPEL',
        grantOwner:'NATIVE_CLIENT',resultOwner:'NATIVE_CLIENT',family:c.family,
        resultStatus:details.some(d=>d.mechanism==='CLIENT_SCRIPT_REQUIRED')?'CLIENT_SCRIPT_REQUIRED_UNVERIFIED':
          details.some(d=>d.mechanism==='MARKER_SEMANTICS_UNVERIFIED')?'MARKER_OR_EXTERNAL_SEMANTICS_UNVERIFIED':
          c.class==='NATIVE_ENGINE'?'NATIVE_ENGINE_NOT_MULTIPLAYER_CERTIFIED':`${c.class}_UNVERIFIED`,
        classification:{class:c.class,family:c.family,reason:c.reason,confidence:c.confidence},appliedBy:[],details});
    }
    for(const [perkKey,links] of perks) {
      const perk=records.get(perkKey);if(!perk)throw Error(`Perk absent: ${perkKey}`);
      const fields=perk.data.fields,notes=perk.data.exportNotes??{};
      const indices=[...new Set(Object.keys({...fields,...notes}).flatMap(k=>/^Effects\[(\d+)\]/.exec(k)?.[1]??[]))].sort((a,b)=>Number(a)-Number(b));
      const details=indices.map(i=>{
        const prefix=`Effects[${i}]`,entryPoint=fields[`${prefix}.EntryPoint`];
        return {family:entryPoint??notes[prefix]??'UNSUPPORTED',mechanism:entryPoint?'PERK_ENTRY_POINT':'CLIENT_QUEST_OR_SCRIPT_REQUIRED',
          ...(entryPoint?{entryPoint}:{}),...Object.fromEntries(['Modification','Value','Rank','Priority'].filter(k=>fields[`${prefix}.${k}`]!==undefined)
            .map(k=>[k.toLowerCase(),fields[`${prefix}.${k}`]])),
          conditionEvidence:JSON.stringify(Object.fromEntries(Object.entries({...notes,...fields}).filter(([k])=>k.startsWith(`${prefix}.Conditions`))))};
      });
      const damageDependent=details.some(d=>damage.test(d.entryPoint??''));
      result.push({raceKey,raceEditorId:race.data.editorId,stableFormKey:perkKey,editorId:perk.data.editorId,recordType:'PERK',
        grantOwner:'NATIVE_CLIENT',resultOwner:'NATIVE_CLIENT',family:details.map(d=>d.family).join(';'),
        resultStatus:damageDependent?'NOT_VERIFIED_MULTIPLAYER_SERVER_HIT_DAMAGE':
          details.some(d=>d.mechanism==='CLIENT_QUEST_OR_SCRIPT_REQUIRED')?'CLIENT_QUEST_OR_SCRIPT_REQUIRED_UNVERIFIED':'PERK_ENTRY_POINTS_UNVERIFIED',
        classification:null,appliedBy:[...links].sort(),details});
    }
  }
  return result.sort((a,b)=>`${a.raceKey}/${a.stableFormKey}`.localeCompare(`${b.raceKey}/${b.stableFormKey}`,'en'));
}
export function ownershipMarkdown(rows) {
  const label=value=>String(value).replaceAll('|','\\|');
  return ['| Raça | Habilidade / perk | Família | Resultado |','|---|---|---|---|',
    ...rows.map(r=>`| ${r.raceEditorId} (${label(r.raceKey)}) | ${r.editorId} (${label(r.stableFormKey)}) | ${r.family.replaceAll('|','/')} | ${r.resultStatus} |`)].join('\n');
}
if(process.argv[1] && path.resolve(process.argv[1])===fileURLToPath(import.meta.url)) {
  const [catalogPath,classificationPath,outputPath]=process.argv.slice(2);
  if(!catalogPath||!classificationPath||!outputPath)throw Error('Usage: ownership.mjs <races.json> <classification/spells.jsonl> <output.json>');
  const classifications=readFileSync(classificationPath,'utf8').replace(/^\uFEFF/,'').split(/\r?\n/).filter(Boolean).map(JSON.parse);
  const rows=buildOwnership(JSON.parse(readFileSync(catalogPath,'utf8')),classifications);
  writeFileSync(outputPath,JSON.stringify(rows,null,2)+'\n');
  console.log(`Race ownership: ${rows.filter(r=>r.recordType==='SPEL').length} spell associations, ${rows.filter(r=>r.recordType==='PERK').length} perks; grant/result owner NATIVE_CLIENT`);
}
