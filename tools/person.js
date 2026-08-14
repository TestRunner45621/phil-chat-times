/* Dump one person's (or a whole tier's) messages, filtered for quotability. */
const fs=require('fs'),path=require('path');
const work=path.join(process.argv[2],'working');
const who=(process.argv[3]||'').toLowerCase();      // handle substring, or "TAIL"
const min=+(process.argv[4]||18), max=+(process.argv[5]||400);
const HEAD=/^### \[([^\]]+)\] (.+?) (@\S+) · msg `(\d+)`/;
const counts=new Map(), all=[];
for(const f of fs.readdirSync(work).filter(f=>/^\d\d-\d\d\.md$/.test(f)).sort()){
 for(const b of fs.readFileSync(path.join(work,f),'utf8').split(/\n---\n/)){
  const L=b.trim().split('\n'); const m=HEAD.exec(L[0]||''); if(!m)continue;
  const body=L.slice(1).filter(l=>{const t=l.trim();
    return t&&!t.startsWith('↩')&&!t.startsWith('⭐')&&!t.startsWith('🖼')&&!t.startsWith('📎')&&!t.startsWith('🔗');}).join(' ').replace(/\s+/g,' ').trim();
  counts.set(m[3],(counts.get(m[3])||0)+1);
  const rq=/^↩ \*replying to (.+?): "(.{0,60})/m.exec(b);
  all.push({h:m[3],name:m[2],when:m[1].replace(/,.*ET/,''),body,f,
    react:(/^⭐ \*\*Reactions:\*\* (.*)$/m.exec(b)||[,''])[1],
    to:rq?rq[1]+': "'+rq[2]+'…"':'', img:/^🖼/m.test(b)});
 }}
const tail=[...counts].filter(([,c])=>c<60).map(([h])=>h);
const sel=who==='tail'?all.filter(x=>tail.includes(x.h)):all.filter(x=>x.h.toLowerCase().includes(who));
let last='';
for(const x of sel){
  if(!x.body||x.body.length<min||x.body.length>max) continue;
  if(/^https?:\/\/\S+$/.test(x.body)) continue;
  if(/^(:[\w]+:\s*)+$/.test(x.body)) continue;
  if(x.h!==last){console.log('\n=========== '+x.name+' '+x.h+'  ('+counts.get(x.h)+' msgs) ===========');last=x.h;}
  console.log(`  [${x.when}]${x.react?' ⭐'+x.react:''}${x.to?'\n   ↳ re '+x.to:''}\n   ${x.body}`);
}
