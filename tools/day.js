/* One person, one day, in sequence — for reading a run rather than sampling it. */
const fs=require('fs'),path=require('path');
const [,,dir,handle,day,lo,hi]=process.argv;
const HEAD=/^### \[([^\]]+)\] (.+?) (@\S+) · msg `(\d+)`/;
const f=path.join(dir,'working',day+'.md');
let n=0;
for(const b of fs.readFileSync(f,'utf8').split(/\n---\n/)){
 const L=b.trim().split('\n'); const m=HEAD.exec(L[0]||''); if(!m)continue;
 if(!m[3].toLowerCase().includes(handle.toLowerCase()))continue;
 const body=L.slice(1).filter(l=>{const t=l.trim();
   return t&&!t.startsWith('↩')&&!t.startsWith('⭐')&&!t.startsWith('🖼')&&!t.startsWith('📎')&&!t.startsWith('🔗');}).join(' ').replace(/\s+/g,' ').trim();
 n++;
 if(n<(+lo||0)||n>(+hi||1e9))continue;
 if(!body||body.length<(process.env.MINL||14))continue;
 if(/^https?:\/\/\S+$/.test(body))continue;
 const r=(/^⭐ \*\*Reactions:\*\* (.*)$/m.exec(b)||[,''])[1];
 console.log((r?'⭐ ':'  ')+body.slice(0,240));
}
