import { createHash } from 'node:crypto';
import type { CharacterKey, SessionEpoch } from '../../../../shared/contracts/src/identity.ts';
import type { JsonObject } from '../../../../shared/contracts/src/messages.ts';
import { executeCommand } from '../../../../shared/persistence/src/index.ts';
import type { PoolPort } from '../../../../shared/persistence/src/index.ts';
import { readProgress, saveProgress } from '../persistence/durable.ts';
// The immutable leveling baseline is JavaScript. Its existing policies own all arithmetic.
// @ts-expect-error baseline module has no TypeScript declarations
import { validateConfigSet, validateEnemyKilledEvent, ProgressionRules, EnemyXpCatalog, EnemyLevelScalingPolicy, CombatXpCalculator, PartyEligibilityPolicy, PartyModifierPolicy, ContentRelevancePolicy, FatiguePolicy } from '../index.mjs';
export interface XpEventInput {
  readonly characterKey:CharacterKey; readonly epoch:SessionEpoch; readonly event:JsonObject;
  readonly eventName:'aetherius.enemy.killed.v1'; readonly recipientId:number; readonly partySnapshot:JsonObject;
}
/** Internal only. The future server death owner supplies event, authoritative
 * party snapshot and SessionBinding->CharacterKey mapping. No host listener exists. */
export function createDurableLeveling(pool:PoolPort,inputConfigs:Record<string,unknown>) {
  const configs=structuredClone(inputConfigs);if(validateConfigSet(configs).length)throw Error('LEVELING_CONFIG_INVALID');
  const progression=new ProgressionRules(configs.levelProgression),catalog=new EnemyXpCatalog(configs.enemyBaseXp),
    scaling=new EnemyLevelScalingPolicy(configs.enemyLevelScaling),combat=new CombatXpCalculator(),
    eligibility=new PartyEligibilityPolicy((configs.partyXp as {eligibility:unknown}).eligibility),party=new PartyModifierPolicy(configs.partyXp),
    relevance=new ContentRelevancePolicy(configs.contentRelevance),fatigue=new FatiguePolicy({config:configs.fatigue,progression});
  return Object.freeze({async award(input:XpEventInput) {
    // Freeze caller evidence before the first await. Reject calculated client values.
    const event=structuredClone(input.event),partySnapshot=structuredClone(input.partySnapshot),characterKey=input.characterKey,recipientId=input.recipientId;
    if(input.eventName!=='aetherius.enemy.killed.v1'||validateEnemyKilledEvent(event).length)throw Error('LEVELING_EVENT_INVALID');
    const enemy=event.enemy as JsonObject,context=event.progressionContext as JsonObject;
    if(enemy.xpEligible!==true||context.valid!==true||context.status!=='ASSIGNED')throw Error('LEVELING_EVENT_UNSUPPORTED');
    const profileResult=catalog.resolveExact(enemy.xpCategory);if(!profileResult.ok)throw Error(profileResult.reasonCode);
    const eligible=eligibility.resolve({partySnapshot});
    if(!eligible.ok||!eligible.eligibleMembers.some((m:{id:number})=>m.id===recipientId))throw Error('LEVELING_PARTY_UNSUPPORTED');
    const modifier=party.resolve(eligible.eligibleMembers.length,eligible.isRaid);if(!modifier.ok)throw Error(modifier.reasonCode);
    const profile=profileResult.profile,fixed=profile.awardMode==='FIXED',scale=fixed?{ok:true,value:1}:scaling.resolve(enemy.combatLevel);
    if(!scale.ok)throw Error(scale.reasonCode);
    // Event identity is durable per character, independent of session epoch or caller request id.
    const requestId='leveling:'+createHash('sha256').update(JSON.stringify([characterKey,event.eventId])).digest('hex');
    return executeCommand(pool,{requestId,characterKey,epoch:input.epoch,type:'leveling.enemy-killed',payload:{eventName:input.eventName,event,recipientId,partySnapshot}},async(tx)=>{
      const prior=await readProgress(tx,characterKey),state=progression.normalizeState(prior?.state??progression.createInitialState({playerId:characterKey}));
      const oldLevel=state.classLevel;
      const content=fixed?{ok:true,multiplier:1}:relevance.resolve(oldLevel,context);if(!content.ok)throw Error(content.reasonCode);
      const calculation=combat.calculate({profile,enemyLevelFactor:scale.value,contentMultiplier:content.multiplier,partyModifier:modifier.value});
      if(!calculation.ok)throw Error('LEVELING_CALCULATION_INVALID');
      const result=fatigue.apply(state,calculation.value,event.occurredAt,{bypass:fixed});
      if(progression.validateState(state).length)throw Error('LEVELING_STATE_INVALID');
      // The repository persists only XP, level and fatigue; temporary attribute
      // outputs of the unchanged baseline math never become Class facts here.
      const revision=(prior?.revision??0)+1;await saveProgress(tx,characterKey,state,revision);
      return {eventId:event.eventId,xpAwarded:result.xpAwarded,totalXp:state.totalXpAccumulated,level:state.classLevel,oldLevel,revision,
        calculation:calculation.breakdown,fatigueCapReached:result.fatigueCapReached};
    });
  }});
}
