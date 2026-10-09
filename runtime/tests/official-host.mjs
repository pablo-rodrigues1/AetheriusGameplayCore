import { readFileSync } from 'node:fs';
import { transform } from 'esbuild';

// Execute the upstream implementation itself, not a guessed identity facade.
// official-identity.ts:6-14: attempt/guid; 16-23: live actor/profile checks;
// 25-32: immutable object per bind; 35: isCurrent uses object reference equality.
const source = readFileSync(new URL('../../../aetherius-server/server/ts/systems/official-identity.ts', import.meta.url), 'utf8');
const { code } = await transform(source, { loader: 'ts', format: 'esm' });
const { createOfficialIdentity } = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);

export function officialHost(mp) {
  const guids = new Map([...mp.users.values()].map(user => [user, `connection-${user}`]));
  const native = {
    getUserByActor: id => mp.users.get(id),
    getUserActor: user => [...mp.users].find(([id, linked]) => linked === user && mp.online.includes(id))?.[0],
    getActorsByProfileId: profile => [...mp.profiles].filter(([, value]) => value === profile).map(([id]) => id),
    getUserGuid: user => guids.get(user),
    isConnected: user => [...mp.users].some(([id, linked]) => linked === user && mp.online.includes(id))
  };
  const authority = createOfficialIdentity(native);
  mp.aetheriusOfficialIdentity = authority.view;
  return {
    authenticate(actorId) {
      const user = mp.users.get(actorId), attempt = authority.begin(user);
      // Fixture-only token, never a credential or persisted/projection property.
      if (!authority.bind(attempt, mp.profiles.get(actorId), 'fixture-token')) throw Error('FIXTURE_BIND_FAILED');
      return authority.view.session(actorId);
    },
    clear: actorId => authority.clear(mp.users.get(actorId)),
    changeGuid: actorId => guids.set(mp.users.get(actorId), 'new-connection'),
    mismatch: actorId => {
      // getActorsByProfileId is the native index; allow testing a divergent get(profileId).
      const profile = mp.profiles.get(actorId);
      native.getActorsByProfileId = value => value === profile ? [actorId] : [];
      mp.profiles.set(actorId, profile + 1);
    }
  };
}
