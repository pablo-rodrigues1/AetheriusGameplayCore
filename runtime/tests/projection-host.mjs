import assert from 'node:assert/strict';
// Native shapes/behavior, not delivery simulation:
// server/cpp/server_guest_lib/script_classes/PapyrusActor.cpp:559-753
// server/cpp/addon/PapyrusUtils.h (espm return), MpActor.cpp:845-882.
export function spellMp(definitions, shift = 1000) {
  const ids = new Map(definitions.map((d, i) => [d.stableFormKey, shift + i + 1]));
  const desc = key => { const [plugin, hex] = key.split('|'); return `${hex.toLowerCase()}:${plugin}`; };
  const byDesc = new Map([...ids].map(([key, id]) => [desc(key), id]));
  const byId = new Map([...byDesc].map(([d, id]) => [id, d]));
  const learned = new Map(), base = new Map(), calls = [];
  const spells = (map, actor) => { if (!map.has(actor)) map.set(actor, new Set()); return map.get(actor); };
  const actorDesc = actor => `dynamic:${actor}`;
  let failMethod;
  return {
    ids, calls, learned: actor => spells(learned, actor), base: actor => spells(base, actor),
    fail: method => { failMethod = method; },
    getDescFromId(id) { return byId.get(id) ?? actorDesc(id); },
    getIdFromDesc(d) { assert(byDesc.has(d), 'unexpected descriptor'); return byDesc.get(d); },
    callPapyrusFunction(type, cls, method, self, args) {
      assert.equal(type, 'method'); assert.equal(cls, 'Actor'); assert.equal(self.type, 'form');
      const actor = Number(self.desc.slice('dynamic:'.length)); assert(Number.isSafeInteger(actor));
      calls.push({ actor, method, args: structuredClone(args) });
      if (method === failMethod) { failMethod = undefined; throw Error('injected native failure'); }
      const own = spells(learned, actor), inherited = spells(base, actor);
      const list = [...own].filter(id => !inherited.has(id));
      if (method === 'GetSpellCount') { assert.deepEqual(args, []); return list.length; }
      if (method === 'GetNthSpell') { assert.equal(args.length, 1); return args[0] < list.length ? { type: 'espm', desc: byId.get(list[args[0]]) } : null; }
      assert.equal(args[0].type, 'espm'); const id = byDesc.get(args[0].desc); assert(id);
      if (method === 'AddSpell') {
        assert.equal(args.length, 2); assert.equal(args[1], false);
        if (own.has(id) || inherited.has(id)) return false;
        own.add(id); return true;
      }
      if (method === 'RemoveSpell') {
        assert.equal(args.length, 1);
        if (inherited.has(id)) return false;
        return own.delete(id);
      }
      throw Error('unimplemented native API');
    }
  };
}
export function sessionEvents() {
  const ready = new Set(), unbound = new Set();
  return {
    onReady(fn) { ready.add(fn); return () => ready.delete(fn); },
    onUnbound(fn) { unbound.add(fn); return () => unbound.delete(fn); },
    ready(binding) { for (const fn of ready) fn({ binding, signal: 'ONLINE_DELAY_APPROXIMATION', certified: false }); },
    unbound(binding) { for (const fn of unbound) fn(binding); }
  };
}
