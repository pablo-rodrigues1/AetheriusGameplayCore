import type { CharacterKey, DefinitionRef, Grant, GrantSet, StableFormKey } from '../../../shared/contracts/src/index.ts';
import { compose, effectiveSet } from '../src/index.ts';
import type { GrantProvider } from '../src/index.ts';

declare const key: CharacterKey;
declare const record: DefinitionRef<'SPEL'>;
declare const set: GrantSet;
const provider: GrantProvider<{ readonly spell: DefinitionRef<'SPEL'> }> = facts => [
  { kind: 'spell', definition: facts.spell, source: { kind: 'STANDING_STONE', key: 'choice' }, revision: 0 }
];
const output: readonly Grant[] = provider({ spell: record });
const composed: GrantSet = compose(key, [output], { facts: 0, grants: 0, equipment: 0, effects: 0, catalog: 0 });
// @ts-expect-error raw strings are not CharacterKey
compose('profile:104', [], composed.revision);
declare const stable: StableFormKey;
// @ts-expect-error a record key is not a character key
compose(stable, [], composed.revision);
// @ts-expect-error contract grants stay readonly
composed.grants.push(output[0]!);
// @ts-expect-error effective provenance stays readonly
effectiveSet(set).grants[0]!.sources.push(output[0]!.source);
// @ts-expect-error output reuses contract StableFormKey
const invalid: StableFormKey = 'fixture.esp|000001';
void invalid;
