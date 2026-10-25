import { compilePerk, type FlatField } from '../../modules/damage-system/compiler/dist/compiler.js';
import type {
  CharacterKey, CombatProfileEffectValue, CombatProfilePerk, CombatProfilePerkSet,
  CombatProfileProjection, CombatProfileSourceRevisions, CombatProfileTemplateCategory,
  CombatProfileTemplateChain, CombatProfileValue, CombatSkill, Grant, GrantSet,
  NpcCombatProfileProjection, PlayerCombatProfileProjection, RevisionVector, SessionBinding,
  StableFormKey
} from '../../shared/contracts/src/index.ts';
import type { JsonObject, JsonValue } from '../../shared/contracts/src/messages.ts';
import type { DomainCatalog, DomainData } from '../../shared/record-catalog/src/types.ts';
import type { CatalogEntry } from '../../shared/contracts/src/ports.ts';
import { NPC_FIELDS, NPC_TEMPLATE_CATEGORIES, npcField, npcTemplateProvider } from '../../shared/record-catalog/src/npcs.ts';
import type { RuntimeMp } from './host.ts';

export const COMBAT_PROFILE_PROPERTY = 'aetheriusCombatProfile';
export const NPC_OBSERVATION_PROPERTY = 'aetheriusNpcObservation';
const SKILLS: readonly CombatSkill[] = ['OneHanded', 'TwoHanded', 'Marksman', 'Block', 'HeavyArmor', 'LightArmor'];
const EFFECT_SOURCE_UNAVAILABLE = 'ACTIVE_EFFECT_INSTANCE_MAGNITUDE_UNAVAILABLE';

export interface ClassCombatProfileFacts {
  readonly kind: 'classes';
  readonly classId: string | null;
  readonly level: number;
  readonly classRevision: number;
  readonly levelRevision: number;
  readonly attributeAllocationRevision: number;
  readonly attributeMaximum: CombatProfileValue<Readonly<{health:number;magicka:number;stamina:number}>>;
}

export interface RaceCombatProfileFacts {
  readonly kind: 'races';
  readonly race: CombatProfileValue<StableFormKey>;
  readonly revision: number;
}

export interface CombatProfileCompositionFacts {
  readonly classes?: ClassCombatProfileFacts;
  readonly races?: RaceCombatProfileFacts;
}

export interface NpcObservation {
  readonly status: 'CONFIRMED' | 'UNSUPPORTED';
  readonly generation: string | null;
  readonly stableFormKey: StableFormKey | null;
  /** Present only when the host has confirmed the selected runtime level. */
  readonly level?: number;
  readonly reason?: string;
}

export interface PerkCatalogLookup {
  (key: StableFormKey): CatalogEntry | undefined;
}

export interface PlayerCombatProfileInput {
  readonly binding: SessionBinding;
  readonly set: GrantSet;
  readonly facts: CombatProfileCompositionFacts;
  readonly classData: DomainData | undefined;
  readonly lookupPerk: PerkCatalogLookup;
}

const supported = <T>(value:T):CombatProfileValue<T> => Object.freeze({status:'SUPPORTED',value});
const unsupported = <T=never>(reason:string):CombatProfileValue<T> => Object.freeze({status:'UNSUPPORTED',value:null,reason});
const validCounter = (n:number|null|undefined): n is number => Number.isSafeInteger(n) && n! >= 0;
const validNpcLevel = (n:unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1;
const validClassLevel = (n:unknown): n is number => typeof n === 'number' && Number.isSafeInteger(n) && n >= 1 && n <= 40;
const stableKeyPattern = /^[^|]+\|[0-9A-F]{6}$/;

function freezeDeep<T>(input:T):T {
  if (input && typeof input === 'object' && !Object.isFrozen(input)) {
    for (const value of Object.values(input as Record<string,unknown>)) freezeDeep(value);
    Object.freeze(input);
  }
  return input;
}

function effectUnsupported(activeWhen:string, reason=EFFECT_SOURCE_UNAVAILABLE):CombatProfileEffectValue {
  return Object.freeze({status:'UNSUPPORTED',value:null,activeWhen,reason});
}
function effectInactive(activeWhen:string, reason:string):CombatProfileEffectValue {
  return Object.freeze({status:'INACTIVE',value:null,activeWhen,reason});
}
function emptyEffects() {
  return Object.freeze({
    fortifyOneHandedDamage:effectUnsupported('ALL_PHYSICAL_HITS'),
    fortifyTwoHandedDamage:effectUnsupported('ALL_PHYSICAL_HITS'),
    fortifyArcheryDamage:effectUnsupported('ALL_PHYSICAL_HITS'),
    fortifyUnarmedDamage:effectUnsupported('ALL_PHYSICAL_HITS'),
    fortifyPowerAttacks:effectUnsupported('CONFIRMED_POWER_ATTACK'),
    fortifyBashDamage:effectUnsupported('CONFIRMED_BASH'),
    fortifyArmorRating:effectUnsupported('DEFENSE'),
    fortifyBlock:effectUnsupported('CONFIRMED_BLOCK'),
    resistArrowDamage:effectUnsupported('CONFIRMED_BLOCK_VS_ARROW'),
    resistPowerAttackDamage:effectUnsupported('CONFIRMED_BLOCK_VS_POWER_ATTACK'),
    fortifySneakAttacks:effectInactive('SNEAK_ATTACK', 'SNEAK_ATTACK_DISABLED_UNTIL_Q9')
  });
}

function classSkills(classData:DomainData|undefined,classId:string|null,level:number|undefined):Readonly<Record<CombatSkill,CombatProfileValue<number>>> {
  const values = {} as Record<CombatSkill,CombatProfileValue<number>>;
  if (!classId) {
    for (const skill of SKILLS) values[skill] = unsupported('CLASS_NOT_SELECTED');
    return Object.freeze(values);
  }
  if (classData?.domain !== 'classes' || !Array.isArray(classData.classes)) {
    for (const skill of SKILLS) values[skill] = unsupported('CLASS_CATALOG_UNAVAILABLE');
    return Object.freeze(values);
  }
  if (!validClassLevel(level)) {
    for (const skill of SKILLS) values[skill] = unsupported('CLASS_LEVEL_UNAVAILABLE');
    return Object.freeze(values);
  }
  const definition = classData.classes.find(item=>item.id===classId);
  if (!definition) {
    for (const skill of SKILLS) values[skill] = unsupported('CLASS_DEFINITION_UNAVAILABLE');
    return Object.freeze(values);
  }
  const stages = (definition.stages as readonly ({readonly level:number;readonly skills?:Readonly<Record<string,unknown>>})[])
    .filter(stage=>Number.isSafeInteger(stage.level)&&stage.level<=level)
    .sort((a,b)=>a.level-b.level);
  const stage = stages.at(-1);
  if (!stage?.skills || typeof stage.skills !== 'object') {
    for (const skill of SKILLS) values[skill] = unsupported('CLASS_STAGE_SKILLS_UNAVAILABLE');
    return Object.freeze(values);
  }
  for (const skill of SKILLS) {
    const value = stage.skills[skill];
    values[skill] = typeof value==='number' && Number.isFinite(value) && value>=0
      ? supported(value) : unsupported('CLASS_STAGE_SKILL_UNAVAILABLE');
  }
  return Object.freeze(values);
}

function jsonValue(value:unknown):JsonValue {
  const encoded=JSON.stringify(value);
  if (encoded===undefined) throw new TypeError('NOT_JSON_SERIALIZABLE');
  return JSON.parse(encoded) as JsonValue;
}

function keyToPerkFormId(key:StableFormKey):string {
  const i=key.lastIndexOf('|');
  return key.slice(i+1)+':'+key.slice(0,i);
}

function unsupportedPerk(grant:Extract<Grant,{kind:'perk'}>,reason:string):CombatProfilePerk {
  return Object.freeze({sourceKind:grant.source.kind,sourceKey:grant.source.key,stableFormKey:grant.definition.stableFormKey,
    rank:grant.rank,status:'UNSUPPORTED',reason,compiled:null});
}

function compilePlayerPerks(grants:readonly Grant[],classFacts:ClassCombatProfileFacts|undefined,lookup:PerkCatalogLookup):CombatProfilePerkSet {
  const items:CombatProfilePerk[]=[];
  for (const grant of grants) {
    if (grant.kind!=='perk') continue;
    if (grant.source.kind!=='CLASS') {
      items.push(unsupportedPerk(grant,'DS3_COMPILER_SOURCE_KIND_UNSUPPORTED'));
      continue;
    }
    if (!classFacts?.classId || grant.source.key!==classFacts.classId || !validClassLevel(classFacts.level)) {
      items.push(unsupportedPerk(grant,'CLASS_GRANT_ORIGIN_UNAVAILABLE'));
      continue;
    }
    let record:CatalogEntry|undefined;
    try { record=lookup(grant.definition.stableFormKey); } catch { /* missing catalog is explicit below */ }
    if (!record || record.definition.recordType!=='PERK'
      || record.definition.stableFormKey!==grant.definition.stableFormKey
      || record.definition.catalogSignature!==grant.definition.catalogSignature) {
      items.push(unsupportedPerk(grant,'PERK_WINNER_OR_SIGNATURE_UNAVAILABLE'));
      continue;
    }
    const rawFields=(record.data.fields??{}) as Record<string,unknown>;
    if (!rawFields || typeof rawFields!=='object' || Array.isArray(rawFields)
      || Object.values(rawFields).some(value=>typeof value!=='string')) {
      items.push(unsupportedPerk(grant,'PERK_FLAT_FIELDS_UNSUPPORTED'));
      continue;
    }
    const fields:FlatField[]=Object.entries(rawFields).map(([path,value])=>({path,value:value as string}));
    try {
      const compiled=compilePerk({formid:keyToPerkFormId(grant.definition.stableFormKey),
        winner:record.winnerPlugin,fields},{
        sourceKind:'CLASS',sourceKey:grant.source.key,classId:classFacts.classId,level:classFacts.level
      });
      const bad=compiled.rules.filter(rule=>rule.status!=='SUPPORTED');
      const reason=bad.length?bad.map(rule=>rule.reason??'DS3_RULE_UNSUPPORTED').filter((x,i,a)=>a.indexOf(x)===i).join('; '):null;
      items.push(Object.freeze({sourceKind:grant.source.kind,sourceKey:grant.source.key,
        stableFormKey:grant.definition.stableFormKey,rank:grant.rank,
        status:compiled.rules.length>0&&!bad.length?'SUPPORTED':'UNSUPPORTED',
        reason:compiled.rules.length===0?'PERK_HAS_NO_COMBAT_RULE':reason??'DS3_RULE_UNSUPPORTED',
        compiled:jsonValue(compiled)}));
    } catch {
      items.push(unsupportedPerk(grant,'DS3_COMPILER_REJECTED_RECORD'));
    }
  }
  items.sort((a,b)=>a.sourceKind.localeCompare(b.sourceKind)||a.sourceKey.localeCompare(b.sourceKey)
    ||a.stableFormKey.localeCompare(b.stableFormKey));
  const unsupportedCount=items.filter(item=>item.status!=='SUPPORTED').length;
  const status=unsupportedCount===0?'SUPPORTED':unsupportedCount===items.length?'UNSUPPORTED':'PARTIAL';
  return Object.freeze({status,value:Object.freeze(items),reason:unsupportedCount?'ONE_OR_MORE_GRANTED_PERKS_UNSUPPORTED':null});
}

function profileStatus(statuses:readonly ('SUPPORTED'|'UNSUPPORTED'|'INACTIVE'|'PARTIAL')[]):'SUPPORTED'|'PARTIAL'|'UNSUPPORTED' {
  const supportedCount=statuses.filter(status=>status==='SUPPORTED').length;
  if (supportedCount===0) return 'UNSUPPORTED';
  return statuses.every(status=>status==='SUPPORTED')?'SUPPORTED':'PARTIAL';
}

function playerStatusValues(input:Omit<PlayerCombatProfileProjection,'revision'|'status'|'reason'>):('SUPPORTED'|'UNSUPPORTED'|'INACTIVE'|'PARTIAL')[] {
  return [
    input.level.status,input.race.status,...Object.values(input.skills).map(value=>value.status),
    ...Object.values(input.attributes).map(value=>value.status),input.perks.status,
    ...Object.values(input.effects).map(value=>value.status)
  ];
}

export function composePlayerCombatProfile(input:PlayerCombatProfileInput,revision=1):PlayerCombatProfileProjection {
  const facts=input.facts;
  const classFacts=facts.classes;
  const level=classFacts&&validClassLevel(classFacts.level)?supported(classFacts.level):unsupported('CLASS_LEVEL_UNAVAILABLE');
  const race=facts.races?.race??unsupported<StableFormKey>('RACE_FACT_UNAVAILABLE');
  const skills=classSkills(input.classData,classFacts?.classId??null,classFacts?.level);
  const max=classFacts?.attributeMaximum??unsupported<Readonly<{health:number;magicka:number;stamina:number}>>('ATTRIBUTE_MAXIMUM_UNAVAILABLE');
  const attributes=Object.freeze({
    health:max.status==='SUPPORTED'&&Number.isFinite(max.value.health)&&max.value.health>0?supported(max.value.health):unsupported('ATTRIBUTE_MAXIMUM_UNAVAILABLE'),
    magicka:max.status==='SUPPORTED'&&Number.isFinite(max.value.magicka)&&max.value.magicka>0?supported(max.value.magicka):unsupported('ATTRIBUTE_MAXIMUM_UNAVAILABLE'),
    stamina:max.status==='SUPPORTED'&&Number.isFinite(max.value.stamina)&&max.value.stamina>0?supported(max.value.stamina):unsupported('ATTRIBUTE_MAXIMUM_UNAVAILABLE')
  });
  const perks=compilePlayerPerks(input.set.grants,classFacts,input.lookupPerk);
  const sourceRevisions:CombatProfileSourceRevisions=Object.freeze({
    classFact:validCounter(classFacts?.classRevision)?classFacts.classRevision:null,
    level:validCounter(classFacts?.levelRevision)?classFacts.levelRevision:null,
    attributeAllocation:validCounter(classFacts?.attributeAllocationRevision)?classFacts.attributeAllocationRevision:null,
    race:validCounter(facts.races?.revision)?facts.races!.revision:null
  });
  const partial={
    version:1 as const,revision,subject:Object.freeze({kind:'PLAYER' as const,characterKey:input.binding.characterKey}),
    sourceRevision:input.set.revision,sourceRevisions,level,race,skills,attributes,perks,effects:emptyEffects(),templateChain:null
  };
  const status=profileStatus(playerStatusValues(partial));
  return freezeDeep({...partial,status,reason:status==='UNSUPPORTED'?'COMBAT_PROFILE_SOURCES_UNAVAILABLE':null}) as PlayerCombatProfileProjection;
}

function isStableKey(value:unknown):value is StableFormKey {
  return typeof value==='string'&&stableKeyPattern.test(value);
}
function parseProvider(data:JsonObject,category:typeof NPC_TEMPLATE_CATEGORIES[number]):CombatProfileTemplateCategory {
  try {
    const result=npcTemplateProvider(data,category) as JsonObject;
    const status=result.status;
    const rawProvider=result.provider;
    const rawChain=result.chain;
    const chain=Array.isArray(rawChain)&&rawChain.every(isStableKey)?rawChain as StableFormKey[]:[];
    const validChain=Array.isArray(rawChain)&&rawChain.every(isStableKey);
    if (status==='SUPPORTED'&&isStableKey(rawProvider)&&validChain) {
      return Object.freeze({category,status:'SUPPORTED',provider:rawProvider,chain:Object.freeze([...chain]),reason:null});
    }
    return Object.freeze({category,status:'UNSUPPORTED',provider:null,chain:Object.freeze([...chain]),
      reason:typeof result.reason==='string'?result.reason:'NPC_TEMPLATE_PROVIDER_INVALID'});
  } catch {
    return Object.freeze({category,status:'UNSUPPORTED',provider:null,chain:Object.freeze([]),reason:'NPC_TEMPLATE_CATEGORY_UNAVAILABLE'});
  }
}
function templateChain(data:JsonObject):CombatProfileTemplateChain {
  const value=NPC_TEMPLATE_CATEGORIES.map(category=>parseProvider(data,category));
  const available=value.filter(item=>item.status==='SUPPORTED').length;
  const status=available===value.length?'SUPPORTED':available===0?'UNSUPPORTED':'PARTIAL';
  return Object.freeze({status,value:Object.freeze(value),reason:status==='SUPPORTED'?null:'NPC_TEMPLATE_CHAIN_PARTIAL'});
}
function fieldValue(data:JsonObject,path:string):unknown {
  if (Array.isArray(data.unavailable)&&(data.unavailable as unknown[]).includes(path)) return undefined;
  try { return npcField(data,path as typeof NPC_FIELDS[number]); }
  catch { return undefined; }
}
function npcSkills(record:CatalogEntry|undefined):Readonly<Record<CombatSkill,CombatProfileValue<number>>> {
  const values={} as Record<CombatSkill,CombatProfileValue<number>>;
  if (!record || record.definition.recordType!=='NPC_') {
    for(const skill of SKILLS) values[skill]=unsupported('NPC_STATS_TEMPLATE_UNSUPPORTED');
    return Object.freeze(values);
  }
  if ((record.data as Record<string,unknown>).autoCalcStats===true) {
    for(const skill of SKILLS) values[skill]=unsupported('NPC_AUTOCALC_GMST_CATALOG_UNAVAILABLE');
    return Object.freeze(values);
  }
  for(const skill of SKILLS) {
    const raw=fieldValue(record.data,'PlayerSkills.SkillValues['+skill+']');
    values[skill]=typeof raw==='number'&&Number.isFinite(raw)&&raw>=0?supported(raw):unsupported('NPC_SKILL_VALUE_UNAVAILABLE');
  }
  return Object.freeze(values);
}
function npcLevel(record:CatalogEntry|undefined,observedLevel:unknown):CombatProfileValue<number> {
  if (validNpcLevel(observedLevel)) return supported(observedLevel);
  const level=record?.data.level as Record<string,unknown>|undefined;
  if (level?.kind==='FIXED'&&validNpcLevel(level.value)) return supported(level.value);
  return unsupported(level?.kind==='PC_LEVEL_MULT'?'NPC_PC_LEVEL_REQUIRES_OBSERVED_LEVEL':'NPC_LEVEL_UNAVAILABLE');
}
function npcRace(record:CatalogEntry|undefined,races:DomainCatalog|undefined):CombatProfileValue<StableFormKey> {
  if(!record||record.definition.recordType!=='NPC_')return unsupported('NPC_TRAITS_TEMPLATE_UNSUPPORTED');
  const raw=fieldValue(record.data,'Race');
  if(!isStableKey(raw))return unsupported('NPC_RACE_LINK_UNAVAILABLE');
  const race=races?.status==='SUPPORTED'?races.byKey(raw):undefined;
  if(!race||race.definition.recordType!=='RACE')return unsupported('NPC_RACE_WINNER_UNAVAILABLE');
  return supported(race.definition.stableFormKey);
}
function npcPerks(record:CatalogEntry|undefined,lookup:PerkCatalogLookup,sourceKey:StableFormKey):CombatProfilePerkSet {
  if(!record||record.definition.recordType!=='NPC_')return Object.freeze({status:'UNSUPPORTED',value:Object.freeze([]),reason:'NPC_BASEDATA_TEMPLATE_UNSUPPORTED'});
  const data=record.data as Record<string,unknown>;
  if(Array.isArray(data.unavailable)&&data.unavailable.includes('Perks'))return Object.freeze({
    status:'UNSUPPORTED',value:Object.freeze([]),reason:'NPC_PERKS_NOT_EXPORTED'
  });
  if(data.perks===null)return Object.freeze({status:'SUPPORTED',value:Object.freeze([]),reason:null});
  if(!Array.isArray(data.perks))return Object.freeze({status:'UNSUPPORTED',value:Object.freeze([]),reason:'NPC_PERKS_UNAVAILABLE'});
  const items:CombatProfilePerk[]=[];
  for(const item of data.perks) {
    if(!Array.isArray(item)||!isStableKey(item[0])||typeof item[1]!=='number'||!Number.isSafeInteger(item[1])||item[1]<1) continue;
    const key=item[0],entry=lookup(key);
    if(!entry||entry.definition.recordType!=='PERK') continue;
    items.push(Object.freeze({sourceKind:'NPC_RECORD',sourceKey,stableFormKey:key,rank:item[1],status:'UNSUPPORTED',
      reason:'DS3_COMPILER_SOURCE_KIND_UNSUPPORTED',compiled:null}));
  }
  return Object.freeze({status:items.length?'UNSUPPORTED':'PARTIAL',value:Object.freeze(items),
    reason:items.length?'NPC_PERKS_NOT_COMPILED':'NPC_PERK_ROW_UNSUPPORTED'});
}

function npcUnsupportedFields(reason:string) {
  const skills={} as Record<CombatSkill,CombatProfileValue<number>>;
  for(const skill of SKILLS)skills[skill]=unsupported(reason);
  return {
    level:unsupported<number>(reason),race:unsupported<StableFormKey>(reason),skills:Object.freeze(skills),
    attributes:Object.freeze({health:unsupported<number>(reason),magicka:unsupported<number>(reason),stamina:unsupported<number>(reason)}),
    perks:Object.freeze({status:'UNSUPPORTED' as const,value:Object.freeze([]),reason}),
    effects:emptyEffects(),
    templateChain:Object.freeze({status:'UNSUPPORTED' as const,value:Object.freeze([]),reason})
  };
}

export function composeNpcCombatProfile(
  observation:unknown,npcs:DomainCatalog|undefined,races:DomainCatalog|undefined,lookupPerk:PerkCatalogLookup,revision=1
):NpcCombatProfileProjection {
  const raw=observation as Record<string,unknown>|null;
  const generation=typeof raw?.generation==='string'&&raw.generation.length>0?raw.generation:null;
  const confirmed=raw?.status==='CONFIRMED'&&isStableKey(raw.stableFormKey);
  if(!confirmed||npcs?.status!=='SUPPORTED') {
    const reason=raw?.status==='CONFIRMED'&&npcs?.status!=='SUPPORTED'?'NPC_CATALOG_UNAVAILABLE':
      typeof raw?.reason==='string'?raw.reason:'NPC_OBSERVATION_UNCONFIRMED';
    const fields=npcUnsupportedFields(reason);
    const base={version:1 as const,revision,subject:Object.freeze({kind:'NPC' as const,characterKey:null,
      stableFormKey:null,generation}),sourceRevision:null,sourceRevisions:Object.freeze({
        classFact:null,level:null,attributeAllocation:null,race:null
      }),...fields};
    return freezeDeep({...base,status:'UNSUPPORTED' as const,reason}) as NpcCombatProfileProjection;
  }
  const stableFormKey=raw.stableFormKey as StableFormKey;
  const record=npcs.byKey(stableFormKey);
  if(!record||record.definition.recordType!=='NPC_') {
    const reason='OBSERVED_NPC_RECORD_UNAVAILABLE';
    const fields=npcUnsupportedFields(reason);
    const base={version:1 as const,revision,subject:Object.freeze({kind:'NPC' as const,characterKey:null,
      stableFormKey:null,generation}),sourceRevision:null,sourceRevisions:Object.freeze({
        classFact:null,level:null,attributeAllocation:null,race:null
      }),...fields};
    return freezeDeep({...base,status:'UNSUPPORTED' as const,reason}) as NpcCombatProfileProjection;
  }
  const categories=templateChain(record.data);
  const statsCategory=categories.value.find(item=>item.category==='Stats');
  const baseDataCategory=categories.value.find(item=>item.category==='BaseData');
  const traitsCategory=categories.value.find(item=>item.category==='Traits');
  const statsRecord=statsCategory?.status==='SUPPORTED'&&statsCategory.provider?npcs.byKey(statsCategory.provider):undefined;
  const baseDataRecord=baseDataCategory?.status==='SUPPORTED'&&baseDataCategory.provider?npcs.byKey(baseDataCategory.provider):undefined;
  const traitsRecord=traitsCategory?.status==='SUPPORTED'&&traitsCategory.provider?npcs.byKey(traitsCategory.provider):undefined;
  const level=npcLevel(statsRecord,raw.level);
  const race=npcRace(traitsRecord,races);
  const skills=npcSkills(statsRecord);
  const perks=npcPerks(baseDataRecord,lookupPerk,baseDataCategory?.provider??stableFormKey);
  const attributeUnsupported='NPC_ATTRIBUTE_MAXIMA_NOT_RESOLVED';
  const attributes=Object.freeze({health:unsupported<number>(attributeUnsupported),magicka:unsupported<number>(attributeUnsupported),stamina:unsupported<number>(attributeUnsupported)});
  const statuses=[
    level.status,race.status,...Object.values(skills).map(value=>value.status),...Object.values(attributes).map(value=>value.status),
    perks.status,categories.status,...Object.values(emptyEffects()).map(value=>value.status)
  ];
  const status=profileStatus(statuses);
  const base={
    version:1 as const,revision,subject:Object.freeze({kind:'NPC' as const,characterKey:null,stableFormKey,generation}),
    sourceRevision:null,sourceRevisions:Object.freeze({classFact:null,level:null,attributeAllocation:null,race:null}),
    level,race,skills,attributes,perks,effects:emptyEffects(),templateChain:categories
  };
  return freezeDeep({...base,status,reason:status==='UNSUPPORTED'?'NPC_COMBAT_PROFILE_SOURCES_UNAVAILABLE':null}) as NpcCombatProfileProjection;
}

function contentWithoutRevision(profile:CombatProfileProjection):string {
  const {revision:_revision,...content}=profile;
  return JSON.stringify(content);
}

export class CombatProfileProjectionPort {
  private registered=false;
  private playerProfiles=new Map<CharacterKey,PlayerCombatProfileProjection>();
  private playerBindings=new Map<number,SessionBinding>();
  private npcProfiles=new Map<number,NpcCombatProfileProjection>();
  constructor(private options:{readonly mp:RuntimeMp|undefined;readonly current:(binding:SessionBinding)=>boolean;readonly warn:(message:string)=>void}) {
    this.register();
  }
  private register():void {
    const mp=this.options.mp;
    if(!mp?.makeProperty||!mp.set)return;
    try {
      mp.makeProperty(COMBAT_PROFILE_PROPERTY,{isVisibleByOwner:false,isVisibleByNeighbors:false,updateOwner:'',updateNeighbor:''});
      this.registered=true;
    } catch(error) {
      const reason=error instanceof Error?error.message:String(error);
      this.registered=reason.includes("'propertyName' must be unique");
      if(!this.registered)this.options.warn('combat profile property UNSUPPORTED: PROPERTY_REGISTRATION_FAILED');
    }
  }
  publishPlayer(input:PlayerCombatProfileInput):PlayerCombatProfileProjection|undefined {
    const mp=this.options.mp,binding=input.binding;
    if(!this.registered||!mp?.set||!this.options.current(binding))return undefined;
    try {
      const previous=this.playerProfiles.get(binding.characterKey);
      const candidate=composePlayerCombatProfile(input,previous?.revision??1);
      const unchanged=previous&&contentWithoutRevision(previous)===contentWithoutRevision(candidate);
      const revision=unchanged?previous.revision:(previous?previous.revision+1:1);
      if(!Number.isSafeInteger(revision))throw Error('COMBAT_PROFILE_REVISION_EXHAUSTED');
      const profile=unchanged?previous:freezeDeep({...candidate,revision}) as PlayerCombatProfileProjection;
      if(!this.options.current(binding))return undefined;
      mp.set(binding.actorRef.actorId,COMBAT_PROFILE_PROPERTY,profile);
      this.playerProfiles.set(binding.characterKey,profile);
      this.playerBindings.set(binding.actorRef.actorId,binding);
      return profile;
    } catch {
      this.options.warn('combat profile publish UNSUPPORTED: PLAYER_PROFILE_PUBLICATION_FAILED');
      return undefined;
    }
  }
  readPlayer(binding:SessionBinding):CombatProfileValue<PlayerCombatProfileProjection> {
    const mp=this.options.mp;
    if(!this.registered||!mp||!this.options.current(binding))return unsupported('COMBAT_PROFILE_PORT_UNAVAILABLE');
    try {
      const value=mp.get(binding.actorRef.actorId,COMBAT_PROFILE_PROPERTY) as PlayerCombatProfileProjection|undefined;
      if(!value||value.version!==1||value.subject?.kind!=='PLAYER'||value.subject.characterKey!==binding.characterKey)
        return unsupported('COMBAT_PROFILE_NOT_PUBLISHED');
      return supported(value);
    } catch {
      return unsupported('COMBAT_PROFILE_READ_FAILED');
    }
  }
  inspectNpc(actorId:number,npcs:DomainCatalog|undefined,races:DomainCatalog|undefined,lookupPerk:PerkCatalogLookup):NpcCombatProfileProjection {
    if(!Number.isSafeInteger(actorId)||actorId<=0)return composeNpcCombatProfile({status:'UNSUPPORTED',reason:'NPC_ACTOR_REF_INVALID'},npcs,races,lookupPerk);
    let observation:unknown;
    try { observation=this.options.mp?.get(actorId,NPC_OBSERVATION_PROPERTY); } catch { observation=undefined; }
    const previous=this.npcProfiles.get(actorId);
    const candidate=composeNpcCombatProfile(observation,npcs,races,lookupPerk,previous?.revision??1);
    const unchanged=previous&&contentWithoutRevision(previous)===contentWithoutRevision(candidate);
    const revision=unchanged?previous.revision:(previous?previous.revision+1:1);
    const profile=unchanged?previous:freezeDeep({...candidate,revision}) as NpcCombatProfileProjection;
    if(this.registered&&this.options.mp?.set&&Number.isSafeInteger(actorId)&&actorId>0) {
      try { this.options.mp.set(actorId,COMBAT_PROFILE_PROPERTY,profile); }
      catch { this.options.warn('combat profile publish UNSUPPORTED: NPC_PROFILE_PUBLICATION_FAILED'); }
    }
    if(Number.isSafeInteger(actorId)&&actorId>0)this.npcProfiles.set(actorId,profile);
    return profile;
  }
  clear(binding:SessionBinding):void {
    const actorId=binding.actorRef.actorId;
    if(this.playerBindings.get(actorId)?.epoch!==binding.epoch)return;
    this.playerBindings.delete(actorId);
    try { this.options.mp?.set?.(actorId,COMBAT_PROFILE_PROPERTY,null); } catch { /* actor already destroyed */ }
  }
  read(binding:SessionBinding):CombatProfileValue<PlayerCombatProfileProjection> {
    return this.readPlayer(binding);
  }
  shutdown():void {
    for(const binding of this.playerBindings.values())this.clear(binding);
    for(const actorId of this.npcProfiles.keys()) {
      try { this.options.mp?.set?.(actorId,COMBAT_PROFILE_PROPERTY,null); } catch { /* actor already destroyed */ }
    }
    this.playerProfiles.clear();this.playerBindings.clear();this.npcProfiles.clear();this.registered=false;
  }
}

export function findCatalogEntry(catalogs:readonly DomainCatalog[],key:StableFormKey):CatalogEntry|undefined {
  for(const catalog of catalogs) {
    const record=catalog.byKey(key);
    if(record)return record;
  }
  return undefined;
}
