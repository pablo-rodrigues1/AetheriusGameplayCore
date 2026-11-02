// DS-5c: skills de NPC com AutoCalcStats, só de records vencedores (CLAS, RACE, GMST) lidos do servidor.
// Mesmo algoritmo e mesmas chaves do host (aetherius_combat/NpcObservation.h Distribute/AutoSkills e
// GetBaseActorValues.cpp), que já usa o resultado para a vida dos NPCs. Fonte do algoritmo:
// reconstrução de DistributeAutoCalcPoints (modules/damage-system/docs/FONTES_E_DONOS.md).
// Enquanto os casos dourados medidos no jogo não provarem a fórmula, `certified` fica false e o perfil
// continua UNSUPPORTED; os valores só são calculados para conferência (tools/npc-autocalc-golden.mjs).
import type { StableFormKey } from '../../shared/contracts/src/index.ts';
import type { RuntimeMp } from './host.ts';

/** CLAS/DNAM skill order (0..17); RACE.DATA stores ActorValue 6..23 for the same skills. */
export const AUTOCALC_SKILL_INDEX = { OneHanded: 0, TwoHanded: 1, Marksman: 2, Block: 3, HeavyArmor: 5, LightArmor: 6 } as const;
const SKILL_COUNT = 18;
const SKILL_CAP = 100;

export const AUTOCALC_GMSTS = {
  skillStart: { stableFormKey: 'aetherius.esp|000803' as StableFormKey, editorId: 'iAVDSkillStart' },
  skillsPerLevel: { stableFormKey: 'skyrim.esm|0C790F' as StableFormKey, editorId: 'iAVDSkillsLevelUp' },
} as const;

export interface NpcAutoCalcSource {
  /** true só depois dos casos dourados medidos no jogo (GAMEPLAY_CORE_NPC_AUTOCALC_SKILLS=certified). */
  readonly certified: boolean;
  classSkillWeights(classKey: StableFormKey): readonly number[] | null;
  raceSkillBoosts(raceKey: StableFormKey): readonly (readonly [number, number])[] | null;
  settings(): { readonly skillStart: number; readonly skillsPerLevel: number } | null;
}

/** Integer weighted allocation, port of NpcObservation.h Distribute (same order and rounding). */
export function distributeAutoCalc(values: number[], weightsIn: readonly number[], points: number, cap: number): void {
  const weights = [...weightsIn];
  const n = values.length;
  const total = weights.reduce((sum, w) => sum + w, 0);
  if (!points || !total) return;
  const order = [...values.keys()].sort((a, b) => (weights[a] !== weights[b] ? weights[b]! - weights[a]! : b - a));
  let remaining = points % total, excess = 0, capped = 0;
  const award = (i: number, amount: number) => {
    if (n === SKILL_COUNT && amount > 255) throw Error('NPC_SKILL_BYTE_OVERFLOW');
    const next = values[i]! + amount;
    values[i] = Math.min(next, cap);
    return next > cap ? Math.trunc(next - cap) : 0;
  };
  for (const i of order) {
    const over = award(i, weights[i]! * Math.floor(points / total));
    excess += over; if (over) ++capped;
  }
  while (excess && capped < n) {
    const amount = Math.floor(excess / (n - capped));
    if (!amount) break;
    let progress = false;
    for (const i of order) if (weights[i] && values[i]! < cap) {
      const over = award(i, amount); excess = excess - amount + over;
      if (over) ++capped; progress = true;
    }
    if (!progress) break;
  }
  remaining += excess;
  while (remaining) {
    let attempted = false;
    for (const i of order) if (weights[i] && remaining) {
      remaining = remaining - 1 + award(i, 1); --weights[i]; attempted = true;
    }
    if (!attempted) break;
  }
}

/** Port of NpcObservation.h AutoSkills: start + RACE boosts, then (level-1)*pointsPerLevel by CLAS weights, cap 100. */
export function computeAutoCalcSkills(weights: readonly number[], boosts: readonly (readonly [number, number])[],
  level: number, skillStart: number, skillsPerLevel: number): number[] {
  if (weights.length !== SKILL_COUNT) throw Error('CLASS_SKILL_WEIGHTS_INVALID');
  const result = new Array<number>(SKILL_COUNT).fill(skillStart);
  for (const [actorValue, boost] of boosts) {
    if (actorValue === 255) continue;
    if (actorValue < 6 || actorValue >= 24) throw Error('RACE_SKILL_ACTOR_VALUE');
    result[actorValue - 6]! += boost;
  }
  distributeAutoCalc(result, weights, skillsPerLevel * (level - 1), SKILL_CAP);
  return result;
}

interface RawRecord { type: string; editorId?: string; fields?: readonly { type: string; data: Uint8Array }[] }
const descriptor = (key: string) => { const i = key.lastIndexOf('|'); return `${key.slice(i + 1)}:${key.slice(0, i)}`; };
const view = (bytes: Uint8Array) => new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);

/** Lê CLAS/RACE/GMST vencedores pelo servidor (fora do golpe), com cache por chave. */
export function createNpcAutoCalcSource(mp: RuntimeMp | undefined, certified: boolean): NpcAutoCalcSource | undefined {
  const native = mp as (RuntimeMp & { getIdFromDesc?(desc: string): number; lookupEspmRecordById?(id: number): { record?: unknown } }) | undefined;
  if (!native?.getIdFromDesc || !native.lookupEspmRecordById) return undefined;
  const read = (key: string, type: string): RawRecord | null => {
    try {
      const record = native.lookupEspmRecordById!(native.getIdFromDesc!(descriptor(key))).record as RawRecord | undefined;
      return record?.type === type ? record : null;
    } catch { return null; }
  };
  const data = (record: RawRecord | null) => {
    const fields = record?.fields?.filter(f => f.type === 'DATA');
    return fields?.length === 1 ? fields[0]!.data : null;
  };
  const classes = new Map<string, readonly number[] | null>(), races = new Map<string, readonly (readonly [number, number])[] | null>();
  let settings: { skillStart: number; skillsPerLevel: number } | null | undefined;
  return Object.freeze({
    certified,
    classSkillWeights(classKey: StableFormKey) {
      if (!classes.has(classKey)) {
        const bytes = data(read(classKey, 'CLAS'));
        classes.set(classKey, bytes && bytes.byteLength >= 36 ? Object.freeze([...bytes.subarray(6, 6 + SKILL_COUNT)]) : null);
      }
      return classes.get(classKey)!;
    },
    raceSkillBoosts(raceKey: StableFormKey) {
      if (!races.has(raceKey)) {
        const bytes = data(read(raceKey, 'RACE'));
        races.set(raceKey, bytes && bytes.byteLength >= 14
          ? Object.freeze(Array.from({ length: 7 }, (_, j) => Object.freeze([bytes[2 * j]!, view(bytes).getInt8(2 * j + 1)] as const)))
          : null);
      }
      return races.get(raceKey)!;
    },
    settings() {
      if (settings === undefined) {
        const int = ({ stableFormKey, editorId }: { stableFormKey: string; editorId: string }) => {
          const record = read(stableFormKey, 'GMST'), bytes = data(record);
          if (record?.editorId !== editorId || bytes?.byteLength !== 4) return null;
          const value = view(bytes).getInt32(0, true);
          return value >= 0 && value <= 255 ? value : null;
        };
        const skillStart = int(AUTOCALC_GMSTS.skillStart), skillsPerLevel = int(AUTOCALC_GMSTS.skillsPerLevel);
        settings = skillStart === null || skillsPerLevel === null || skillStart > SKILL_CAP ? null : { skillStart, skillsPerLevel };
      }
      return settings;
    },
  });
}
