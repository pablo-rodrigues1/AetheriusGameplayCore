import type { DefinitionRef, RuntimeFormId, SessionBinding } from '../../../shared/contracts/src/identity.js';
import type { RecordCatalogPort } from '../../../shared/contracts/src/ports.js';
import type { RuntimeMp } from '../host.js';

export class ProjectionError extends Error {
  constructor(readonly code: string) { super(code); }
}

/** Native, synchronous API only. Never query client HasSpell (not registered).
 * Sources: PapyrusActor.cpp:559-753, PapyrusUtils.h, MpActor.cpp:845-882.
 * Enumeration excludes base NPC/RACE spells; AddSpell=false also covers those.
 */
export class SpellHost {
  constructor(private mp: RuntimeMp, private catalogs: readonly RecordCatalogPort[]) {}
  resolve(definition: DefinitionRef): RuntimeFormId {
    for (const catalog of this.catalogs) {
      if (catalog.lookup(definition).status !== 'SUPPORTED') continue;
      const resolved = catalog.resolve(definition.stableFormKey, definition.catalogSignature);
      if (resolved.status === 'SUPPORTED') return resolved.value;
    }
    throw new ProjectionError('CATALOG_UNSUPPORTED');
  }
  private call(binding: SessionBinding, method: string, args: unknown[]): unknown {
    return this.mp.callPapyrusFunction('method', 'Actor', method,
      { type: 'form', desc: this.mp.getDescFromId(binding.actorRef.actorId) }, args);
  }
  learned(binding: SessionBinding, check: () => void): Set<number> {
    check();
    const count = this.call(binding, 'GetSpellCount', []);
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) throw new ProjectionError('SPELL_READ_UNSUPPORTED');
    const ids = new Set<number>();
    for (let n = 0; n < count; n++) {
      check();
      const form = this.call(binding, 'GetNthSpell', [n]) as { type?: unknown; desc?: unknown } | null;
      if (!form || form.type !== 'espm' || typeof form.desc !== 'string') throw new ProjectionError('SPELL_READ_UNSUPPORTED');
      const id = this.mp.getIdFromDesc(form.desc);
      if (!Number.isSafeInteger(id) || id <= 0 || ids.has(id)) throw new ProjectionError('SPELL_READ_UNSUPPORTED');
      ids.add(id);
    }
    return ids;
  }
  mutate(binding: SessionBinding, method: 'AddSpell' | 'RemoveSpell', id: RuntimeFormId): boolean {
    const spell = { type: 'espm', desc: this.mp.getDescFromId(id) };
    const result = this.call(binding, method, method === 'AddSpell' ? [spell, false] : [spell]);
    if (typeof result !== 'boolean') throw new ProjectionError('SPELL_MUTATION_UNSUPPORTED');
    return result;
  }
}
