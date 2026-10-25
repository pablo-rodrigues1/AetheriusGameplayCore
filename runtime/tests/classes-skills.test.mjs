import assert from 'node:assert/strict';
import {test} from 'node:test';
import {readFileSync} from 'node:fs';
import {resolve} from 'node:path';
import {fileURLToPath} from 'node:url';
import {build} from 'esbuild';

const root=fileURLToPath(new URL('../../',import.meta.url));
const compiled=await build({
  absWorkingDir:root,
  stdin:{loader:'ts',resolveDir:root,contents:"export {CLASS_SKILL_NAMES,CLASS_SKILL_LABEL_TO_ACTOR_VALUE,parseClassSkillText,accumulateClassSkillStages,buildClasses} from './tools/catalog/classes.ts';"},
  bundle:true,platform:'node',format:'esm',write:false
});
const api=await import('data:text/javascript;base64,'+Buffer.from(compiled.outputFiles[0].text).toString('base64'));
const catalog=JSON.parse(readFileSync(resolve(root,'catalog/classes.json'),'utf8'));
const config=JSON.parse(readFileSync(resolve(root,'modules/class-system/config/classes-config.json'),'utf8'));
const expectedSkillNames=[
  'OneHanded','TwoHanded','Marksman','Block','Smithing','HeavyArmor','LightArmor','Pickpocket','Lockpicking',
  'Sneak','Alchemy','Speechcraft','Alteration','Conjuration','Destruction','Illusion','Restoration','Enchanting'
];
const expectedLabels={
  'Alteração':'Alteration',
  'Armadura Leve':'LightArmor',
  'Ilusão':'Illusion',
  'Furtividade':'Sneak',
  'Restauração':'Restoration',
  'Uma-Mão':'OneHanded',
  'Arquearia':'Marksman',
  'Duas-Mãos':'TwoHanded',
  'Armadura Pesada':'HeavyArmor',
  'Bloqueio':'Block',
  'Conjuração':'Conjuration',
  'Destruição':'Destruction'
};
const allAt=value=>Object.fromEntries(expectedSkillNames.map(name=>[name,value]));

test('tabela explícita de nomes portugueses mapeia para ActorValues estáveis',()=>{
  assert.deepEqual(api.CLASS_SKILL_NAMES,expectedSkillNames);
  assert.deepEqual(api.CLASS_SKILL_LABEL_TO_ACTOR_VALUE,expectedLabels);
  for(const [label,actorValue] of Object.entries(expectedLabels))
    assert.deepEqual(api.parseClassSkillText(label+' 17'),{[actorValue]:17});
  assert.deepEqual(api.parseClassSkillText('Uma-mão 12'),{OneHanded:12});
});

test('parser cobre Todas 0, Todas 20, listas, valor único e texto vazio',()=>{
  assert.deepEqual(api.parseClassSkillText('Todas 0'),allAt(0));
  assert.deepEqual(api.parseClassSkillText('Todas 20'),allAt(20));
  assert.deepEqual(api.parseClassSkillText('Destruição 30, Alteração 30, Restauração 30'),
    {Destruction:30,Alteration:30,Restoration:30});
  assert.deepEqual(api.parseClassSkillText('Bloqueio 30, Armadura Pesada 30'),{Block:30,HeavyArmor:30});
  assert.deepEqual(api.parseClassSkillText('Destruição 50'),{Destruction:50});
  assert.deepEqual(api.parseClassSkillText(''),{});
});

test('nome desconhecido falha e preserva o texto exato no erro',()=>{
  const text='Arcana 30, Alteração 20';
  assert.throws(()=>api.parseClassSkillText(text),error=>
    error.message.includes('CLASS_SKILL_NAME_UNKNOWN')&&error.message.includes(text));
});

test('acúmulo Q14 mantém skills omitidas e etapas vazias; Piromante nível 20',()=>{
  const piromante=config.piromante;
  const accumulated=api.accumulateClassSkillStages(piromante.stages);
  const level20Index=piromante.stages.findIndex(stage=>stage.level===20);
  const expected=allAt(20);
  expected.Destruction=50;
  expected.Alteration=40;
  expected.Restoration=40;
  assert.deepEqual(accumulated[level20Index],expected);
  const blankStages=api.accumulateClassSkillStages([{skills:'Todas 20'},{skills:''}]);
  assert.deepEqual(blankStages[1],blankStages[0]);
  for(const cls of Object.values(config)){
    const skills=api.accumulateClassSkillStages(cls.stages);
    assert.equal(skills.length,cls.stages.length,cls.id);
    for(const stage of skills)assert.equal(Object.keys(stage).length,expectedSkillNames.length,cls.id);
  }
});

test('catálogo gerado é reprodutível e contém skills finais numéricas em todos os marcos',()=>{
  const exportsDir=process.env.GAMEPLAY_CORE_TEST_EXPORTS??resolve(root,'../_work/exports');
  const configPath=resolve(root,'modules/class-system/config/classes-config.json');
  const first=api.buildClasses(exportsDir,configPath,catalog.dependencies);
  const second=api.buildClasses(exportsDir,configPath,catalog.dependencies);
  assert.deepEqual(first,second);
  assert.deepEqual(first,catalog);
  for(const cls of catalog.classes)for(const stage of cls.stages){
    assert.deepEqual(Object.keys(stage.skills).sort(),[...expectedSkillNames].sort(),cls.id+'@'+stage.level);
    assert(Object.values(stage.skills).every(value=>Number.isSafeInteger(value)&&value>=0),cls.id+'@'+stage.level);
  }
});
