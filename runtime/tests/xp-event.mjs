// Evidence shape from durable.ts / classes.acceptance.mjs, no server death hook.
export function xpInput(id,category='dragon_priest') {
  return {eventName:'aetherius.enemy.killed.v1',recipientId:91,partySnapshot:{source:'SERVER',center:{cell:'test-cell',position:[0,0,0]},members:[{id:91,isOnline:true,cellOrWorldDesc:'test-cell',pos:[0,0,0]}],isRaid:false},
    event:{contractVersion:1,eventId:id,occurredAt:Date.UTC(2026,9,8,12),victimId:800,killerId:91,
      enemy:{contractVersion:1,managed:true,stableEnemyIdentity:'skyrim.esm|000001',enemyFamily:category.toUpperCase(),spawnRole:'BOSS_UNIQUE',combatLevel:20,xpEligible:true,xpCategory:category,sourcePlugin:'Skyrim.esm',winningOverridePlugin:'Skyrim.esm',sourceRecordIdentity:'skyrim.esm|000001'},
      progressionContext:{contractVersion:1,sourceType:'OTHER',sourceId:'c3c-test',recommendedClassMin:1,recommendedClassMax:40,status:'ASSIGNED',valid:true},contributors:[]}};
}
