import assert from 'node:assert/strict';
import {readFile,realpath} from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
const workspace=fileURLToPath(new URL('../../../',import.meta.url));
const patchPath=fileURLToPath(new URL('../../integrations/client/suspenso/B5b-mais-veneno-fix3-aa864cb.patch',import.meta.url));
// Suspended client source comes from the preserved cumulative patch, never from
// the installable B5b-only tree. Check every old hunk against the base inventory.
export async function suspendedClientPlugin(){
  const patch=(await readFile(patchPath,'utf8')).replace(/\r\n/g,'\n'),sources=new Map();
  for(const chunk of patch.split(/(?=^diff --git )/m)){
    const match=/^diff --git a\/(.+) b\/(.+)$/m.exec(chunk);if(!match)continue;
    const relative=match[2];
    if(!['client/src/sync/inventory.ts','client/src/services/services/gameplayGrantService.ts','client/src/services/services/gameplayWeaponPoison.ts'].includes(relative))continue;
    const logical=path.resolve(workspace,'aetherius-client',relative);
    // esbuild follows the client junction in isolated root checks. Key by its
    // real parent even for the absent suspended gameplayWeaponPoison.ts.
    const target=path.join(await realpath(path.dirname(logical)),path.basename(logical));
    const added=/^new file mode /m.test(chunk);
    const base=added?[]:(await readFile(target,'utf8')).replace(/\r\n/g,'\n').split('\n');
    const output=[];let cursor=0;
    const lines=chunk.split('\n');
    for(let n=0;n<lines.length;n++){
      const h=/^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(lines[n]);if(!h)continue;
      const start=Math.max(0,Number(h[1])-1);assert(start>=cursor);output.push(...base.slice(cursor,start));cursor=start;
      for(n++;n<lines.length&&!lines[n].startsWith('@@ ');n++){
        const row=lines[n];if(row.startsWith('\\')||row==='')continue;
        if(row[0]===' '||row[0]==='-'){assert.equal(base[cursor++],row.slice(1),relative+' hunk base mismatch');}
        if(row[0]===' '||row[0]==='+')output.push(row.slice(1));
      }
      n--;
    }
    output.push(...base.slice(cursor));sources.set(target,output.join('\n')+(added?'\n':''));
  }
  assert.equal(sources.size,3,'All suspended client modules required');
  return {name:'suspended-weapon-poison-client',setup(build){
    build.onResolve({filter:/gameplayWeaponPoison$/},args=>({path:path.resolve(args.resolveDir,args.path+'.ts')}));
    build.onLoad({filter:/(inventory|gameplayGrantService|gameplayWeaponPoison)\.ts$/},args=>{
      const contents=sources.get(path.resolve(args.path));
      return contents===undefined?undefined:{contents,loader:'ts',resolveDir:path.dirname(args.path)};
    });
  }};
}
