import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createRequire } from 'node:module';
import { fakeHost, unavailablePg, logger } from './host.mjs';
import { developmentEnv } from './development-env.mjs';
import { officialHost } from './official-host.mjs';
const require = createRequire(import.meta.url);
const bundlePath = require.resolve('../../dist/aetherius-gameplay-core.cjs');
const factory = () => { delete require.cache[bundlePath]; return require(bundlePath).createGameplayCore; };
const context = (env = {}, mp = fakeHost()) => ({ mp, pg: unavailablePg, env, log: logger() });
const actor = { actorId: 91 };

test('reload from two independently loaded bundles: one instance, hooks and timers; reinitialize', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const ctx = context({ GAMEPLAY_CORE_MODE_PROBE: 'active' });
  let firstHits = 0, secondHits = 0, firstReady = 0;
  const baseline = process.listenerCount('aetherius:gameplay-core:health-check');
  const old = () => true; ctx.mp.onActivate = old;
  const first = factory()(ctx);
  first.register({ id: 'probe', requiresDatabase: false, start(c) {
    c.hooks.register('onActivate', () => { firstHits++; return false; });
    c.actors.onReady(() => firstReady++);
  } });
  await Promise.all([first.initialize(), first.initialize()]);
  assert.equal(ctx.mp.onActivate(1, 91), false); assert.equal(firstHits, 1);
  const second = factory()(ctx);
  second.register({ id: 'probe', requiresDatabase: false, start(c) { c.hooks.register('onActivate', () => { secondHits++; return false; }); } });
  await second.initialize();
  try {
    assert.equal(first.healthCheck(), false); assert.equal(first.info().resources, 0);
    assert.equal(second.healthCheck(), true);
    assert.equal(process.listenerCount('aetherius:gameplay-core:health-check'), baseline + 1);
    assert.equal(ctx.mp.emitter.listenerCount('disconnect'), 1);
    assert.equal(ctx.mp.onActivate(1, 91), false); assert.equal(firstHits, 1); assert.equal(secondHits, 1);
    t.mock.timers.tick(4000); assert.equal(firstReady, 0);
    await second.shutdown(); assert.equal(ctx.mp.onActivate, old); assert.equal(second.info().resources, 0);
    await second.initialize(); assert.equal(second.healthCheck(), true);
    assert.equal(ctx.mp.onActivate(1, 91), false); assert.equal(secondHits, 2);
  } finally { await first.shutdown(); await second.shutdown(); }
  assert.equal(process.listenerCount('aetherius:gameplay-core:health-check'), baseline);
});

test('identity uses live online actors, profile 108549, invalid profiles and new epochs on fast reconnect', async () => {
  const ctx = context(); const core = factory()(ctx); await core.initialize();
  try {
    const first = core.identity.lookup(actor); assert.equal(first.status, 'SUPPORTED');
    assert.equal(first.value.characterKey, 'profile:108549');
    for (const profile of [undefined, 0, -1]) { ctx.mp.profiles.set(91, profile); core.identity.poll(); assert.equal(core.identity.lookup(actor).status, 'UNSUPPORTED'); }
    ctx.mp.profiles.set(91, 108549); core.identity.poll();
    const rebound = core.identity.lookup(actor).value;
    assert.notEqual(rebound.epoch, first.value.epoch);
    ctx.mp.emitter.emit('disconnect', 0); // No poll gap is necessary.
    assert.equal(core.identity.isCurrent(rebound), false);
    core.identity.poll(); assert.notEqual(core.identity.lookup(actor).value.epoch, rebound.epoch);
    ctx.mp.online = []; assert.equal(core.identity.isCurrent(core.identity.lookup(actor).value ?? rebound), false);
  } finally { await core.shutdown(); }
});

test('offline/unverifiable identity is unsupported unless development explicitly opts in', async () => {
  const ctx = context({}, fakeHost({ offlineMode: true })); const core = factory()(ctx);
  await core.initialize(); assert.equal(core.identity.lookup(actor).status, 'UNSUPPORTED'); await core.shutdown();
  const dev = factory()({ ...ctx, env: { ...developmentEnv, GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY: 'true' } });
  await dev.initialize(); assert.equal(dev.identity.lookup(actor).status, 'SUPPORTED'); await dev.shutdown();
});

test('official offline identity: missing session refuses even DEV opt-in; exact session changes epoch and readiness', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const mp = fakeHost({ offlineMode: true }), official = officialHost(mp), events = [], unbound = [];
  const core = factory()(context({ ...developmentEnv, GAMEPLAY_CORE_ALLOW_OFFLINE_IDENTITY: 'true', GAMEPLAY_CORE_MODE_PROBE: 'active' }, mp));
  core.register({ id: 'probe', requiresDatabase: false, start(c) { c.actors.onReady(e => events.push(e)); c.actors.onUnbound(b => unbound.push(b)); } });
  await core.initialize();
  try {
    assert.equal(core.identity.lookup(actor).status, 'UNSUPPORTED');
    official.authenticate(91); core.identity.poll();
    const first = core.identity.lookup(actor).value; assert.equal(first.characterKey, 'profile:108549');
    t.mock.timers.tick(3000); assert.equal(events.length, 1);
    official.authenticate(91); // Same actor/user/profile, new official object, no disconnect event.
    assert.equal(core.identity.isCurrent(first), false); assert.equal(core.identity.lookup(actor).status, 'UNSUPPORTED');
    core.identity.poll(); const next = core.identity.lookup(actor).value;
    assert.notEqual(next.epoch, first.epoch); assert.equal(unbound.length, 1);
    t.mock.timers.tick(3000); assert.equal(events.length, 2);
    official.clear(91); assert.equal(core.identity.isCurrent(next), false); core.identity.poll();
    assert.equal(core.identity.lookup(actor).status, 'UNSUPPORTED');
    official.authenticate(91); core.identity.poll(); const guidBinding = core.identity.lookup(actor).value;
    official.changeGuid(91); assert.equal(core.identity.isCurrent(guidBinding), false);
    assert.equal(core.identity.lookup(actor).status, 'UNSUPPORTED');
  } finally { await core.shutdown(); }
});

test('official profile divergence refuses with log; no fallback on missing/throwing facade, even online', async () => {
  const mp = fakeHost(), official = officialHost(mp), ctx = context({}, mp); official.authenticate(91);
  const core = factory()(ctx); await core.initialize();
  try {
    const binding = core.identity.lookup(actor).value; official.mismatch(91);
    assert.equal(core.identity.isCurrent(binding), false); core.identity.poll();
    assert.equal(core.identity.lookup(actor).status, 'UNSUPPORTED');
    assert(ctx.log.messages.some(s => s.includes('profile_id differs')));
    mp.aetheriusOfficialIdentity = { session() { throw Error('private token must not be logged'); } };
    assert.equal(core.identity.lookup(actor).status, 'UNSUPPORTED'); core.identity.poll();
    assert(!ctx.log.messages.join('\n').includes('private token'));
  } finally { await core.shutdown(); }
  const empty = fakeHost(); officialHost(empty);
  const noSession = factory()(context({}, empty)); await noSession.initialize();
  try { assert.equal(noSession.identity.lookup(actor).status, 'UNSUPPORTED'); } finally { await noSession.shutdown(); }
});

test('actor ready fires once per binding; invalid and disconnected actors never fire', async t => {
  t.mock.timers.enable({ apis: ['setTimeout', 'setInterval'] });
  const ctx = context(); const events = [];
  const configured = factory()({ ...ctx, env: { GAMEPLAY_CORE_MODE_OBSERVER: 'active' } });
  configured.register({ id: 'observer', requiresDatabase: false, start(c) { c.actors.onReady(e => events.push(e)); } });
  await configured.initialize();
  try {
    t.mock.timers.tick(2999); assert.equal(events.length, 0);
    t.mock.timers.tick(1); assert.equal(events.length, 1); assert.equal(events[0].certified, false);
    t.mock.timers.tick(10000); assert.equal(events.length, 1);
    ctx.mp.emitter.emit('disconnect', 0); configured.identity.poll();
    ctx.mp.profiles.set(91, 0); t.mock.timers.tick(4000); assert.equal(events.length, 1);
    ctx.mp.profiles.set(91, 108549); configured.identity.poll(); t.mock.timers.tick(3000); assert.equal(events.length, 2);
  } finally { await configured.shutdown(); }
});

test('mode default/invalid values, capability isolation, database failure is contained without secrets', async () => {
  const ctx = context({ GAMEPLAY_CORE_MODE_RACES: 'banana' }); const core = factory()(ctx);
  await core.initialize();
  try {
    assert(core.info().features.every(feature => feature.mode === 'off'));
    assert(ctx.log.messages.some(s => s.includes('invalid mode for races')));
    const report = core.capabilityReport(); assert.equal(report.database.status, 'UNSUPPORTED');
    assert(report.systems.find(s => s.id === 'standing-stones').missing.some(s => s.includes('migrations:apply')));
    assert(report.systems.find(s => s.id === 'races').missing.some(s => s.includes('migrations:apply')), 'C2 observations now require persistence');
    assert(!ctx.log.messages.join('\n').includes('private details'));
    assert.equal(core.healthCheck(), true);
  } finally { await core.shutdown(); }
});

test('audit/shadow cannot mutate; canary explicitly selects character; active permits current binding', async () => {
  for (const mode of ['off', 'audit', 'shadow', 'canary', 'active']) {
    let received;
    const core = factory()(context({ GAMEPLAY_CORE_MODE_PROBE: mode, GAMEPLAY_CORE_CANARY_CHARACTERS: 'profile:108549' }));
    core.register({ id: 'probe', requiresDatabase: false, start(c) { received = c; } });
    await core.initialize();
    try {
      if (mode === 'off') assert.equal(received, undefined);
      else { const binding = core.identity.lookup(actor).value; assert.equal(received.canMutate(binding), ['canary','active'].includes(mode)); }
    } finally { await core.shutdown(); }
  }
});

test('shutdown while boot awaits database cancels all later hook and timer registration', async () => {
  let resolve; const blocked = new Promise(r => { resolve = r; });
  const core = factory()({ ...context(), pg: { init: () => ({ connect: () => blocked }) } });
  const initialize = core.initialize(); await Promise.resolve();
  const stop = core.shutdown(); resolve(Promise.reject(Error('offline')));
  await initialize; await stop;
  assert.equal(core.healthCheck(), false); assert.equal(core.info().resources, 0);
});

test('real file adapter loads approved B2 domains; missing domain disables only its dependents', async () => {
  const core = factory()(context({ GAMEPLAY_CORE_MODE_RACES: 'audit', GAMEPLAY_CORE_MODE_RACE_PROBE: 'audit' }, fakeHost({ catalogAvailable: true })));
  let started = false;
  core.register({ id: 'race-probe', domain: 'races', requiresDatabase: false, start(c) { started = true; assert.equal(c.catalog.status, 'SUPPORTED'); } });
  await core.initialize();
  try {
    const systems = core.capabilityReport().systems;
    assert.equal(systems.find(s => s.id === 'race-probe').status, 'SUPPORTED'); assert.equal(started, true);
    assert.equal(systems.find(s => s.id === 'classes').status, 'UNSUPPORTED');
    assert.equal(systems.find(s => s.id === 'standing-stones').catalog.status, 'SUPPORTED');
  } finally { await core.shutdown(); }
});

test('immediate initialize-shutdown-initialize serializes system disposal before the new start', async () => {
  const ctx = context({ GAMEPLAY_CORE_MODE_PROBE: 'active' }); const core = factory()(ctx);
  const events = [];
  core.register({ id: 'probe', requiresDatabase: false, start(c) {
    events.push('start'); c.hooks.register('onActivate', () => false);
    return async () => { await Promise.resolve(); events.push('stop'); };
  } });
  await core.initialize(); const stop = core.shutdown(); const next = core.initialize();
  await Promise.all([stop, next]);
  try { assert.deepEqual(events, ['start','stop','start']); assert.equal(core.healthCheck(), true); assert.equal(ctx.mp.onActivate(1,91), false); }
  finally { await core.shutdown(); }
});

test('failed system startup releases its own hooks and listeners; other systems continue', async () => {
  const ctx = context({ GAMEPLAY_CORE_MODE_BAD: 'active', GAMEPLAY_CORE_MODE_GOOD: 'active' });
  const core = factory()(ctx); let failedHits = 0, goodHits = 0;
  core.register({ id: 'bad', requiresDatabase: false, start(c) {
    c.hooks.register('onActivate', () => { failedHits++; return false; }); throw Error('start failure');
  } });
  core.register({ id: 'good', requiresDatabase: false, start(c) { c.hooks.register('onActivate', () => { goodHits++; return false; }); } });
  await core.initialize();
  try { assert.equal(ctx.mp.onActivate(1,91), false); assert.equal(failedHits,0); assert.equal(goodHits,1);
    assert.equal(core.capabilityReport().systems.find(s => s.id === 'bad').status, 'UNSUPPORTED'); }
  finally { await core.shutdown(); }
});
