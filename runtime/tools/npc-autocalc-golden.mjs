// DS-5c: valores esperados das skills de combate de NPCs com AutoCalcStats, para comparar com o jogo
// (console: prid <ref> ; getav OneHanded ...). Usa o mesmo cálculo do runtime (src/npc-autocalc.ts).
//
//   node runtime/tools/npc-autocalc-golden.mjs <export.jsonl> <casos.json> [skillStart] [skillsPerLevel]
//
// export.jsonl: houseCARL housecarl_records (format=json, to_file) das CLAS e RACE vencedoras, fields
//   SkillWeights, SkillBoost0..SkillBoost6 (depth 2).
// casos.json: [{ "npc": "skyrim.esm|013261", "name": "Beirand", "class": "013257:Skyrim.esm",
//   "race": "013746:Skyrim.esm", "level": 9 }, ...] (NPC vencedor: AutoCalcStats, nível fixo, sem template).
// skillStart/skillsPerLevel: GMSTs vencedores iAVDSkillStart (aetherius.esp|000803) e iAVDSkillsLevelUp
//   (skyrim.esm|0C790F); padrão 10 e 8, os vencedores da load order de 29/10/2026.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'esbuild';

const SKILLS = ['OneHanded', 'TwoHanded', 'Archery', 'Block', 'Smithing', 'HeavyArmor', 'LightArmor', 'Pickpocket', 'Lockpicking',
  'Sneak', 'Alchemy', 'Speech', 'Alteration', 'Conjuration', 'Destruction', 'Illusion', 'Restoration', 'Enchanting'];
const COMBAT = { OneHanded: 0, TwoHanded: 1, Archery: 2, Block: 3, HeavyArmor: 5, LightArmor: 6 };

const [exportFile, casesFile, start = '10', perLevel = '8'] = process.argv.slice(2);
if (!exportFile || !casesFile) { console.error('Uso: node npc-autocalc-golden.mjs <export.jsonl> <casos.json> [skillStart] [skillsPerLevel]'); process.exit(2); }

const root = fileURLToPath(new URL('../../', import.meta.url));
const bundled = await build({ absWorkingDir: root, stdin: { loader: 'ts', resolveDir: root,
  contents: "export {computeAutoCalcSkills} from './runtime/src/npc-autocalc.ts';" }, bundle: true, platform: 'node', format: 'esm', write: false });
const { computeAutoCalcSkills } = await import('data:text/javascript;base64,' + Buffer.from(bundled.outputFiles[0].text).toString('base64'));

const rows = readFileSync(resolve(exportFile), 'utf8').split('\n').filter(Boolean).slice(1).map(line => JSON.parse(line));
const value = (row, path) => row.fields.find(f => f.path === path)?.value;
const byId = new Map(rows.map(row => [row.formid.toLowerCase(), row]));
const record = (formid, type) => {
  const row = byId.get(formid.toLowerCase());
  if (row?.type !== type) throw Error(`${formid}: ${type} ausente do export`);
  return row;
};
const weightsOf = formid => { const row = record(formid, 'Class'); return SKILLS.map(skill => Number(value(row, `SkillWeights[${skill}]`))); };
const boostsOf = formid => {
  const row = record(formid, 'Race');
  return Array.from({ length: 7 }, (_, i) => {
    const skill = value(row, `SkillBoost${i}.Skill`), boost = Number(value(row, `SkillBoost${i}.Boost`));
    return [skill === '255' ? 255 : SKILLS.indexOf(skill) + 6, boost];
  });
};

console.log(`iAVDSkillStart=${start} iAVDSkillsLevelUp=${perLevel}`);
console.log(['NPC', 'nível', ...Object.keys(COMBAT)].join('\t'));
for (const c of JSON.parse(readFileSync(resolve(casesFile), 'utf8'))) {
  const skills = computeAutoCalcSkills(weightsOf(c.class), boostsOf(c.race), c.level, Number(start), Number(perLevel));
  console.log([`${c.name} (${c.npc})`, c.level, ...Object.values(COMBAT).map(i => skills[i])].join('\t'));
}
