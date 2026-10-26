const test = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const { createConfigStore, validateMaintenanceConfig } = require('../server/config');
const { AetheriusDurabilityService } = require('../server/maintenance-service');
const { InMemoryPersistence } = require('../server/persistence');
const { parseClientPacket } = require('../server/protocol');

const configPath = path.resolve(__dirname, '../config/maintenance-config.json');

function createService({ seed, nowRef } = {}) {
  const configStore = createConfigStore(configPath);
  const persistence = new InMemoryPersistence(seed);
  const clock = nowRef ? () => nowRef.value : undefined;
  const service = new AetheriusDurabilityService({
    configStore,
    persistence,
    clock,
    authorize: ({ characterId }) => typeof characterId === 'string' || Number.isInteger(characterId)
  });
  return { service, persistence, configStore };
}

test('configuração contempla kits MISC, catálogo de materiais e ícones verificados', async () => {
  const { configStore } = createService();
  const config = configStore.get();
  assert.equal(config.maintenance.debuffs.weapons.efficiencyPenalty, 0.3);
  assert.equal(config.maintenance.debuffs.armor.efficiencyPenalty, 0.3);
  assert.equal(Object.keys(config.maintenance.kits.weapons).length, 12);
  assert.equal(Object.keys(config.maintenance.kits.armor).length, 18);
  for (const kit of Object.values(config.maintenance.kits.weapons)) {
    assert.equal(kit.charges, 50);
    assert.equal(kit.recordType, 'MISC');
    assert.equal(kit.iconSource.formId, '05CAE1:Skyrim.esm');
  }
  for (const kit of Object.values(config.maintenance.kits.armor)) {
    assert.equal(kit.charges, 50);
    assert.equal(kit.recordType, 'MISC');
    assert.equal(kit.iconSource.formId, '0E49F7:Skyrim.esm');
  }
});

test('equipar ou permanecer conectado sem combate não consome cargas', async () => {
  const { service, persistence } = createService();
  await persistence.setInventory('char-1', 1001, 1);
  await service.initializeCharacter('char-1');
  const activation = await service.activateKit({ characterId: 'char-1', actorId: 20, kitKey: 'weapon.iron', baseId: 1001, requestId: 'request-0001' });
  assert.equal(activation.ok, true);
  const status = await service.getStatus('char-1');
  assert.equal(status.reserves.find(row => row.material === 'iron').weapons, 50);
  assert.equal(status.cycle, null);
});

test('vários ataques no ciclo consomem uma carga por combinação e dual wield separa materiais', async () => {
  const { service, persistence } = createService();
  await persistence.setInventory('char-2', 1001, 1);
  await persistence.setInventory('char-2', 1002, 1);
  await service.initializeCharacter('char-2');
  await service.activateKit({ characterId: 'char-2', actorId: 20, kitKey: 'weapon.iron', baseId: 1001, requestId: 'request-0002-a' });
  await service.activateKit({ characterId: 'char-2', actorId: 20, kitKey: 'weapon.ebony', baseId: 1002, requestId: 'request-0002-b' });

  const first = await service.handleEffectiveEvent({ authority: 'server', characterId: 'char-2', eventId: 'hit-1', type: 'weapon_hit', physicalWeapon: true, weaponMaterials: ['iron', 'ebony'], at: 1000 });
  const second = await service.handleEffectiveEvent({ authority: 'server', characterId: 'char-2', eventId: 'hit-2', type: 'weapon_hit', physicalWeapon: true, weaponMaterials: ['iron'], at: 1100 });
  assert.equal(first.consumed.filter(item => item.charged).length, 2);
  assert.equal(second.consumed[0].alreadyCovered, true);
  const status = await service.getStatus('char-2', [], 1200);
  const byMaterial = Object.fromEntries(status.reserves.map(row => [row.material, row.weapons]));
  assert.equal(byMaterial.iron, 49);
  assert.equal(byMaterial.ebony, 49);
});

test('magia exclusiva não consome arma; dano físico e bloqueio consomem apenas a defesa usada', async () => {
  const { service, persistence } = createService();
  await persistence.setInventory('char-3', 1001, 1);
  await persistence.setInventory('char-3', 1002, 1);
  await service.initializeCharacter('char-3');
  await service.activateKit({ characterId: 'char-3', actorId: 20, kitKey: 'weapon.steel', baseId: 1001, requestId: 'request-0003-a' });
  await service.activateKit({ characterId: 'char-3', actorId: 20, kitKey: 'armor.steel', baseId: 1002, requestId: 'request-0003-b' });
  const magic = await service.handleEffectiveEvent({ authority: 'server', characterId: 'char-3', eventId: 'spell-1', type: 'weapon_hit', physicalWeapon: false, weaponMaterials: ['steel'], at: 1000 });
  assert.equal(magic.skipped, true);
  await service.handleEffectiveEvent({ authority: 'server', characterId: 'char-3', eventId: 'damage-1', type: 'physical_damage_received', physical: true, affectedArmorMaterials: ['steel'], at: 1100 });
  await service.handleEffectiveEvent({ authority: 'server', characterId: 'char-3', eventId: 'block-1', type: 'shield_block', physical: true, effective: true, shieldMaterial: 'steel', at: 1200 });
  const snapshot = persistence.snapshot('char-3');
  assert.equal(snapshot.balances.weapons.steel, 50);
  assert.equal(snapshot.balances.armor.steel, 49);
});

test('última carga preserva cobertura até o encerramento do ciclo, sem saldo negativo', async () => {
  const now = { value: 1000 };
  const { service, persistence } = createService({ nowRef: now, seed: { 'char-4': { balances: { weapons: { iron: 1 }, armor: {} } } } });
  await service.initializeCharacter('char-4');
  await service.handleEffectiveEvent({ authority: 'server', characterId: 'char-4', eventId: 'last-1', type: 'weapon_hit', physicalWeapon: true, weaponMaterials: ['iron'], at: now.value });
  assert.equal(persistence.snapshot('char-4').balances.weapons.iron, 0);
  assert.equal(service.applyWeaponDamage('char-4', 100, 'iron', now.value).effective, 100);
  now.value += 31000;
  assert.equal(service.applyWeaponDamage('char-4', 100, 'iron', now.value).effective, 70);
  assert.equal(persistence.snapshot('char-4').balances.weapons.iron, 0);
});

test('uso duplicado de kit é idempotente e não duplica cargas', async () => {
  const { service, persistence } = createService();
  await persistence.setInventory('char-5', 1001, 1);
  await service.initializeCharacter('char-5');
  const results = await Promise.all(Array.from({ length: 10 }, () => service.activateKit({ characterId: 'char-5', actorId: 20, kitKey: 'weapon.iron', baseId: 1001, requestId: 'same-request-0005' })));
  assert.ok(results.every(result => result.ok));
  assert.equal(persistence.snapshot('char-5').balances.weapons.iron, 50);
  assert.equal(persistence.snapshot('char-5').inventory['1001'], undefined);
});

test('duas solicitações diferentes concorrentes não removem mais kits do que existem', async () => {
  const { service, persistence } = createService();
  await persistence.setInventory('char-6', 1001, 1);
  await service.initializeCharacter('char-6');
  const results = await Promise.all([
    service.activateKit({ characterId: 'char-6', actorId: 20, kitKey: 'weapon.iron', baseId: 1001, requestId: 'request-0006-a' }),
    service.activateKit({ characterId: 'char-6', actorId: 20, kitKey: 'weapon.iron', baseId: 1001, requestId: 'request-0006-b' })
  ]);
  assert.equal(results.filter(result => result.ok).length, 1);
  assert.equal(results.filter(result => result.reason === 'KIT_NOT_IN_INVENTORY').length, 1);
  assert.equal(persistence.snapshot('char-6').balances.weapons.iron, 50);
});

test('duas ativações somam 100 cargas; a terceira é recusada sem consumir o kit', async () => {
  const { service, persistence } = createService();
  await persistence.setInventory('char-limit', 1001, 3);
  await service.initializeCharacter('char-limit');

  const first = await service.activateKit({ characterId: 'char-limit', actorId: 20, kitKey: 'weapon.iron', baseId: 1001, requestId: 'limit-request-1' });
  const second = await service.activateKit({ characterId: 'char-limit', actorId: 20, kitKey: 'weapon.iron', baseId: 1001, requestId: 'limit-request-2' });
  const third = await service.activateKit({ characterId: 'char-limit', actorId: 20, kitKey: 'weapon.iron', baseId: 1001, requestId: 'limit-request-3' });
  assert.equal(first.chargesAdded, 50);
  assert.equal(second.chargesAdded, 50);
  assert.equal(third.ok, false);
  assert.equal(third.reason, 'CHARGE_LIMIT');
  assert.equal(persistence.snapshot('char-limit').balances.weapons.iron, 100);
  assert.equal(persistence.snapshot('char-limit').inventory['1001'], 1);
});

test('saldo preexistente de 60 cargas rejeita novo kit de 50 sem consumo', async () => {
  const { service, persistence } = createService({ seed: { 'char-existing': { balances: { weapons: { steel: 60 }, armor: {} } } } });
  await persistence.setInventory('char-existing', 1002, 1);
  await service.initializeCharacter('char-existing');
  const result = await service.activateKit({ characterId: 'char-existing', actorId: 20, kitKey: 'weapon.steel', baseId: 1002, requestId: 'limit-request-4' });
  assert.equal(result.ok, false);
  assert.equal(result.reason, 'CHARGE_LIMIT');
  assert.equal(persistence.snapshot('char-existing').balances.weapons.steel, 60);
  assert.equal(persistence.snapshot('char-existing').inventory['1002'], 1);
});

test('eventos enviados pelo cliente não são autoridade de consumo', async () => {
  const { service, persistence } = createService({ seed: { 'char-7': { balances: { weapons: { iron: 10 }, armor: {} } } } });
  await service.initializeCharacter('char-7');
  const result = await service.handleEffectiveEvent({ characterId: 'char-7', eventId: 'forged-1', type: 'weapon_hit', physicalWeapon: true, weaponMaterials: ['iron'] });
  assert.equal(result.ok, false);
  assert.equal(persistence.snapshot('char-7').balances.weapons.iron, 10);
});

test('saldo persiste após desconexão/reconexão sem restaurar carga nem cobertura grátis', async () => {
  const now = { value: 1000 };
  const first = createService({ nowRef: now, seed: { 'char-8': { balances: { weapons: { iron: 1 }, armor: {} } } } });
  await first.service.initializeCharacter('char-8');
  await first.service.handleEffectiveEvent({ authority: 'server', characterId: 'char-8', eventId: 'reconnect-1', type: 'weapon_hit', physicalWeapon: true, weaponMaterials: ['iron'], at: now.value });
  await first.service.onDisconnect('char-8');
  const second = createService({ nowRef: now, seed: { 'char-8': first.persistence.snapshot('char-8') } });
  await second.service.initializeCharacter('char-8');
  assert.equal(second.persistence.snapshot('char-8').balances.weapons.iron, 0);
  assert.equal(second.service.applyWeaponDamage('char-8', 100, 'iron', now.value).effective, 100);
  now.value += 31000;
  assert.equal(second.service.applyWeaponDamage('char-8', 100, 'iron', now.value).effective, 70);
});

test('configuração inválida rejeita penalidade fora dos limites e cargas negativas', async () => {
  const { configStore } = createService();
  const invalidPenalty = JSON.parse(JSON.stringify(configStore.get()));
  invalidPenalty.maintenance.debuffs.weapons.efficiencyPenalty = 1.1;
  assert.throws(() => validateMaintenanceConfig(invalidPenalty), /efficiencyPenalty/);
  const invalidCharges = JSON.parse(JSON.stringify(configStore.get()));
  invalidCharges.maintenance.kits.weapons.iron.charges = -1;
  assert.throws(() => validateMaintenanceConfig(invalidCharges), /charges/);
});

test('protocolo de cliente aceita apenas intenção de uso/consulta e ignora saldo enviado', async () => {
  assert.equal(parseClientPacket(JSON.stringify({ type: 'aetherius:maintenance:requestState', data: { balances: { weapons: { iron: 999 } } } })).ok, true);
  assert.equal(parseClientPacket(JSON.stringify({ type: 'aetherius:maintenance:useKit', data: { kitKey: 'weapon.iron', requestId: 'packet-0001' } })).ok, true);
  assert.equal(parseClientPacket(JSON.stringify({ type: 'aetherius:maintenance:useKit', data: { kitKey: 'weapon.iron', requestId: 'x' } })).ok, false);
  assert.equal(parseClientPacket(JSON.stringify({ type: 'aetherius:maintenance:applyMultiplier', data: { multiplier: 0 } })).ok, false);
});
