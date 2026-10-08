import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { EventEmitter } from 'node:events';
// Host shapes: OnlinePlayersBinding.cpp (actor IDs), ProfileIdBinding.cpp,
// ScampServer.cpp GetServerSettings/GetUserByActor/On (no off),
// ScampServerListener.cpp OnDisconnect, tools/catalog/host.ts (record wrapper).
export function fakeHost({ catalogAvailable = false, offlineMode = false } = {}) {
  const emitter = new EventEmitter();
  const profiles = new Map([[91, 108549]]);
  const users = new Map([[91, 0]]); // Real host supports connection slot zero.
  const domains = ['standing-stones', 'races'].map(name => JSON.parse(readFileSync(new URL(`../../catalog/${name}.json`, import.meta.url))));
  const plugins = [...new Map(domains.flatMap(d => d.dependencies).map(p => [p.filename.toLowerCase(), p])).values()];
  const definitions = new Map(domains.flatMap(d => d.records).map(r => [r.stableFormKey, r]));
  const ids = new Map();
  const types = new Map();
  let full = 1000, light = 254 * 2 ** 24 + 1000;
  const mp = {
    emitter, profiles, users, online: [91],
    onActivate: undefined,
    on: (...args) => { emitter.on(...args); },
    get(id, property) { if (property === 'onlinePlayers') return [...mp.online]; if (property === 'profileId') return profiles.get(id); },
    getUserByActor: id => users.get(id),
    getServerSettings: () => ({ offlineMode, ...(catalogAvailable ? { dataDir: fileURLToPath(new URL('../../../aetherius-server/build/dist/server/data/', import.meta.url)) } : {}) }),
    getEspmLoadOrder: () => plugins.map(p => p.filename),
    getIdFromDesc(desc) {
      const [hex, plugin] = desc.split(':');
      const key = `${plugin.toLowerCase()}|${hex.padStart(6, '0').toUpperCase()}`;
      const record = definitions.get(key);
      if (!record) throw Error('record absent');
      if (!ids.has(key)) { const id = record.pluginKind === 'LIGHT' ? ++light : ++full; ids.set(key, id); types.set(id, record.recordType); }
      return ids.get(key);
    },
    lookupEspmRecordById: id => ({ record: { type: types.get(id) } }),
    getDescFromId: id => String(id),
    callPapyrusFunction: () => true
  };
  return mp;
}
export const unavailablePg = { init: () => ({ connect: async () => { throw Object.assign(Error('private details must not appear'), { code: 'ECONNREFUSED' }); } }) };
export const logger = () => { const messages = []; return { messages, info: message => messages.push(message) }; };
