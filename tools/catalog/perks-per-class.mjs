// Read the fixed signed catalog; never resolve names or consult live records.
import {readFile,writeFile,mkdir} from 'node:fs/promises';
import {fileURLToPath} from 'node:url';
const root=new URL('../../',import.meta.url);
export function perksPerClass(data) {
  const classes=[...data.classes].sort((a,b)=>a.id.localeCompare(b.id,'en'));
  const records=new Map(data.records.map(r=>[r.stableFormKey,r]));
  const plugins=new Map(data.dependencies.map(p=>[p.filename.toLowerCase(),p.filename]));
  const names=new Map(classes.flatMap(c=>c.stages.flatMap(s=>s.perks)).map(p=>[p.stableFormKey,p.label]));
  const cell=s=>String(s).replaceAll('|','\\|').replaceAll('\n',' '),tick=String.fromCharCode(96);
  const identity=key=>{
    const [plugin,hex]=key.split('|');
    if(!plugin||!/^[0-9A-F]{6}$/.test(hex))throw Error('INVALID_STABLE_FORM_KEY');
    return (records.get(key)?.definingPlugin??plugins.get(plugin)??plugin)+' | '+hex;
  };
  const total=classes.reduce((n,c)=>n+c.stages.reduce((m,s)=>m+s.perks.length,0),0);
  const lines=['# Perks por classe','',
    'Gerado exclusivamente de '+tick+'catalog/classes.json'+tick+'. '+classes.length+' classes; '+total+' entradas de perk; marcos cumulativos.', '',
    'Regenerar na raiz do Core: '+tick+'node tools/catalog/perks-per-class.mjs'+tick+'.', '',
    'A identidade usa plugin de definição e FormID local com seis dígitos. O winner e as assinaturas permanecem no catálogo. Rank é o record distinto auditado; nenhum rank ou pré-requisito adicional é concedido automaticamente.', '',
    'As colunas de pré-requisitos reproduzem somente os links HasPerk do catálogo, com operador, valor e flags nativos. Não avaliam OR, skill, equipamento, scripts nem condições de efeito. A ausência desses links não certifica resultado de gameplay. Nomes são os rótulos auditados da classe; quando um pré-requisito não tem rótulo no catálogo de classes, mostramos sua identidade.', '',
    '“Não concedidos pela classe” compara todos os marcos da classe. “Ainda não concedidos no marco” também inclui links concedidos apenas num marco posterior. Essas informações documentam o record; não ampliam os grants.', ''];
  for(const cls of classes){
    const all=new Set(cls.stages.flatMap(s=>s.perks).map(p=>p.stableFormKey));
    const reached=new Set();
    lines.push('## '+cls.id,'','| Nível | Nome do perk | Rank | Plugin de definição + FormID local | Pré-requisitos nativos não concedidos pela classe | Ainda não concedidos no marco |','|---|---|---|---|---|---|');
    for(const stage of [...cls.stages].sort((a,b)=>a.level-b.level)){
      for(const perk of stage.perks)reached.add(perk.stableFormKey);
      for(const perk of stage.perks){
        const describe=p=>(names.get(p.key)?names.get(p.key)+' — ':'')+identity(p.key)+' ('+p.comparison+' '+p.value+'; flags='+p.flags+')';
        const missing=perk.prerequisites.filter(p=>!all.has(p.key)).map(describe).join('; ')||'Nenhum link HasPerk ausente';
        const later=perk.prerequisites.filter(p=>all.has(p.key)&&!reached.has(p.key)).map(describe).join('; ')||'Nenhum adicional';
        lines.push('| '+[stage.level,perk.label,perk.rank,identity(perk.stableFormKey),missing,later].map(cell).join(' | ')+' |');
      }
    }
    lines.push('');
  }
  return lines.join('\n');
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const data=JSON.parse(await readFile(new URL('catalog/classes.json',root),'utf8'));
  const text=perksPerClass(data),output=new URL('docs/classes/PERKS_POR_CLASSE.md',root);
  await mkdir(new URL('docs/classes/',root),{recursive:true});await writeFile(output,text);
  console.log('PERKS_POR_CLASSE.md: '+data.classes.length+' classes; '+data.classes.reduce((n,c)=>n+c.stages.reduce((m,s)=>m+s.perks.length,0),0)+' entradas');
}
