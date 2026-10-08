import type { CharacterKey, DefinitionRef, Grant, GrantSet, GrantSource, RevisionVector } from '../../../shared/contracts/src/index.ts';
import type { EffectiveGrant, EffectiveGrantChange, EffectiveGrantSet, GrantDiff, RevisionComparison } from './types.ts';
import { compareText, copyDefinition, copyGrant, copyRevision, copySource, fail, grantIdentity,
  itemIdentity, object, revisionFields, sourceIdentity, text } from './validation.ts';
export type { EffectiveGrant, EffectiveGrantChange, EffectiveGrantSet, GrantDiff, GrantProvider, RevisionComparison } from './types.ts';

/** No provider is invoked here; the caller supplies already-read facts' outputs. */
export function compose(characterKey: CharacterKey, providers: readonly (readonly Grant[])[], revision: RevisionVector): GrantSet {
  text(characterKey, 'characterKey');
  const vector = copyRevision(revision);
  if (!Array.isArray(providers)) fail('INVALID_PROVIDERS', 'providers');
  const union = new Map<string, Grant>();
  Array.from(providers).forEach((output, providerIndex) => {
    if (!Array.isArray(output)) fail('INVALID_PROVIDER_OUTPUT', `providers[${providerIndex}]`);
    const seen = new Set<string>();
    Array.from(output).forEach((input, index) => {
      const path = `providers[${providerIndex}][${index}]`;
      const grant = copyGrant(input, path);
      const identity = grantIdentity(grant);
      if (seen.has(identity)) fail('DUPLICATE_PROVIDER_GRANT', path);
      seen.add(identity);
      const prior = union.get(identity);
      if (prior && JSON.stringify(prior) !== JSON.stringify(grant)) fail('CONFLICTING_GRANT', identity);
      union.set(identity, grant);
    });
  });
  const grants = Object.freeze([...union.values()].sort((a, b) => compareText(grantIdentity(a), grantIdentity(b))));
  const set = Object.freeze({ characterKey, revision: vector, grants });
  // Different origins must agree on a definition's version and modifier owner.
  collectEffective(set);
  return set;
}

function checkedSet(set: GrantSet): GrantSet {
  object(set, ['characterKey', 'revision', 'grants'], 'set');
  return compose(set.characterKey, [set.grants], set.revision);
}
function collectEffective(set: GrantSet): readonly EffectiveGrant[] {
  const groups = new Map<string, Grant[]>();
  // A stable record may be referenced by several kinds, but never two signatures/types.
  const definitions = new Map<string, DefinitionRef>();
  for (const grant of set.grants) {
    const prior = definitions.get(grant.definition.stableFormKey);
    if (prior && (prior.recordType !== grant.definition.recordType
      || prior.catalogSignature !== grant.definition.catalogSignature)) fail('CONFLICTING_DEFINITION', grant.definition.stableFormKey);
    definitions.set(grant.definition.stableFormKey, grant.definition);
    const key = itemIdentity(grant);
    const group = groups.get(key) ?? [];
    group.push(grant);
    groups.set(key, group);
  }
  return Object.freeze([...groups.entries()].sort(([a], [b]) => compareText(a, b)).map(([, group]) => {
    const first = group[0]!;
    const sources = Object.freeze(group.map(g => g.source).sort((a, b) => compareText(sourceIdentity(a), sourceIdentity(b))));
    const base = { definition: first.definition, sources };
    switch (first.kind) {
      case 'perk': return Object.freeze({ ...base, kind: first.kind, definition: first.definition,
        rank: group.reduce((rank, g) => Math.max(rank, g.kind === 'perk' ? g.rank : 0), 0) });
      case 'modifier':
        if (group.some(g => g.kind !== 'modifier' || g.owner !== first.owner)) fail('CONFLICTING_OWNER', itemIdentity(first));
        return Object.freeze({ ...base, kind: first.kind, owner: first.owner });
      default: return Object.freeze({ ...base, kind: first.kind, definition: first.definition });
    }
  }));
}
export function effectiveSet(input: GrantSet): EffectiveGrantSet {
  const set = checkedSet(input);
  return Object.freeze({ characterKey: set.characterKey, revision: set.revision, grants: collectEffective(set) });
}

/** Componentwise partial order; returns the relation of left to right. */
export function compareRevisions(left: RevisionVector, right: RevisionVector): RevisionComparison {
  copyRevision(left); copyRevision(right);
  const lower = revisionFields.some(key => left[key] < right[key]);
  const higher = revisionFields.some(key => left[key] > right[key]);
  return lower && higher ? 'incomparable' : lower ? 'before' : higher ? 'after' : 'equal';
}
function forward(previous: RevisionVector, next: RevisionVector): RevisionComparison {
  const relation = compareRevisions(previous, next);
  if (relation === 'after') fail('STALE_REVISION', 'next.revision');
  if (relation === 'incomparable') fail('INCOMPARABLE_REVISION', 'next.revision');
  return relation;
}
export function diff(previousInput: GrantSet, nextInput: GrantSet): GrantDiff {
  const previous = checkedSet(previousInput);
  const next = checkedSet(nextInput);
  if (previous.characterKey !== next.characterKey) fail('CHARACTER_MISMATCH', 'next.characterKey');
  if (forward(previous.revision, next.revision) === 'equal'
    && JSON.stringify(previous.grants) !== JSON.stringify(next.grants)) fail('REVISION_CONTENT_CONFLICT', 'next.grants');
  return effectiveDiff(effectiveSet(previous), effectiveSet(next));
}
function effectiveDiff(previous: EffectiveGrantSet, next: EffectiveGrantSet): GrantDiff {
  const oldItems = new Map(previous.grants.map(g => [itemIdentity(g), g]));
  const newItems = new Map(next.grants.map(g => [itemIdentity(g), g]));
  const changed: EffectiveGrantChange[] = [];
  const added: EffectiveGrant[] = [];
  for (const item of next.grants) {
    const prior = oldItems.get(itemIdentity(item));
    if (!prior) added.push(item);
    else if (JSON.stringify(prior) !== JSON.stringify(item)) changed.push(Object.freeze({ previous: prior, next: item,
      rankChanged: prior.kind === 'perk' && item.kind === 'perk' && prior.rank !== item.rank }));
  }
  return Object.freeze({ characterKey: next.characterKey, previousRevision: previous.revision, revision: next.revision,
    added: Object.freeze(added), removed: Object.freeze(previous.grants.filter(g => !newItems.has(itemIdentity(g)))),
    changed: Object.freeze(changed) });
}

function checkedEffective(input: EffectiveGrantSet): EffectiveGrantSet {
  object(input, ['characterKey', 'revision', 'grants'], 'effectiveSet');
  if (!Array.isArray(input.grants)) fail('INVALID_EFFECTIVE_GRANTS', 'effectiveSet.grants');
  const seen = new Set<string>();
  const grants: Grant[] = [];
  Array.from(input.grants).forEach((item, index) => {
    const path = `effectiveSet.grants[${index}]`;
    const fields = ['kind', 'definition', 'sources'];
    if (item?.kind === 'perk') fields.push('rank');
    if (item?.kind === 'modifier') fields.push('owner');
    object(item, fields, path);
    if (!Array.isArray(item.sources) || !item.sources.length) fail('INVALID_SOURCES', path);
    const { sources, ...body } = item;
    const expanded = Array.from(sources).map(source => copyGrant({ ...body, source, revision: 0 } as Grant, path));
    grants.push(...expanded);
    const key = itemIdentity(expanded[0]!);
    if (seen.has(key)) fail('DUPLICATE_EFFECTIVE_GRANT', path);
    seen.add(key);
  });
  return effectiveSet(compose(input.characterKey, [grants], input.revision));
}

/** Pure replay helper; never sends host operations or mutates the old set. */
export function applyDiff(previousInput: EffectiveGrantSet, delta: GrantDiff): EffectiveGrantSet {
  const previous = checkedEffective(previousInput);
  object(delta, ['characterKey', 'previousRevision', 'revision', 'added', 'removed', 'changed'], 'diff');
  if (previous.characterKey !== delta.characterKey) fail('CHARACTER_MISMATCH', 'diff.characterKey');
  if (compareRevisions(previous.revision, delta.previousRevision) !== 'equal') fail('DIFF_BASE_REVISION_MISMATCH', 'diff.previousRevision');
  const relation = forward(previous.revision, delta.revision);
  for (const key of ['added', 'removed', 'changed'] as const) if (!Array.isArray(delta[key])) fail('INVALID_DIFF', key);
  const items = new Map(previous.grants.map(g => [itemIdentity(g), g]));
  const touched = new Set<string>();
  const touch = (item: EffectiveGrant) => {
    const key = itemIdentity(item);
    if (touched.has(key)) fail('DUPLICATE_DIFF_ITEM', key);
    touched.add(key);
    return key;
  };
  const requirePrevious = (item: EffectiveGrant, key: string) => {
    if (JSON.stringify(items.get(key)) !== JSON.stringify(item)) fail('DIFF_ITEM_MISMATCH', key);
  };
  for (const item of delta.removed) {
    const key = touch(item); requirePrevious(item, key); items.delete(key);
  }
  for (const change of delta.changed) {
    object(change, ['previous', 'next', 'rankChanged'], 'diff.changed');
    const key = touch(change.previous); requirePrevious(change.previous, key);
    if (key !== itemIdentity(change.next)) fail('DIFF_IDENTITY_CHANGE', key);
    const rankChanged = change.previous.kind === 'perk' && change.next.kind === 'perk' && change.previous.rank !== change.next.rank;
    if (change.rankChanged !== rankChanged) fail('DIFF_RANK_FLAG_MISMATCH', key);
    items.set(key, change.next);
  }
  for (const item of delta.added) {
    const key = touch(item);
    if (items.has(key)) fail('DIFF_ITEM_ALREADY_PRESENT', key);
    items.set(key, item);
  }
  const next = checkedEffective({ characterKey: delta.characterKey, revision: delta.revision, grants: [...items.values()] });
  if (relation === 'equal' && JSON.stringify(previous.grants) !== JSON.stringify(next.grants)) fail('REVISION_CONTENT_CONFLICT', 'diff');
  return next;
}

/** Revokes exactly one origin; the owner supplies the new coherent revision. */
export function revokeSource(input: GrantSet, sourceInput: GrantSource, revision: RevisionVector): GrantSet {
  const set = checkedSet(input);
  const source = copySource(sourceInput, 'source');
  const next = compose(set.characterKey, [set.grants.filter(g => sourceIdentity(g.source) !== sourceIdentity(source))], revision);
  diff(set, next);
  return next;
}

/** All active origins for this exact definition, unique across grant kinds. */
export function explain(input: GrantSet, characterKey: CharacterKey, definitionInput: DefinitionRef): readonly GrantSource[] {
  const set = checkedSet(input);
  if (set.characterKey !== characterKey) fail('CHARACTER_MISMATCH', 'characterKey');
  const definition = copyDefinition(definitionInput, 'definition');
  const matching = set.grants.filter(g => g.definition.stableFormKey === definition.stableFormKey);
  if (matching.some(g => g.definition.recordType !== definition.recordType
    || g.definition.catalogSignature !== definition.catalogSignature)) fail('DEFINITION_MISMATCH', definition.stableFormKey);
  const sources = new Map(matching.map(g => [sourceIdentity(g.source), g.source]));
  return Object.freeze([...sources.values()].sort((a, b) => compareText(sourceIdentity(a), sourceIdentity(b))));
}
