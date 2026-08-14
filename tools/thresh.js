const fs=require('fs'),path=require('path');
const work=path.join(process.argv[2],'working');
const HEAD=/^### \[[^\]]+\] (.+?) (@\S+) · msg `(\d+)`/;
const P=new Map(),R=new Map();
for(const f of fs.readdirSync(work).filter(f=>/^\d\d-\d\d\.md$/.test(f))){
 for(const b of fs.readFileSync(path.join(work,f),'utf8').split(/\n---\n/)){
  const L=b.trim().split('\n'); const m=HEAD.exec(L[0]||''); if(!m)continue;
  const n=m[1];
  if(!P.has(n))P.set(n,{msgs:0,chars:0,landed:0});
  const p=P.get(n); p.msgs++;
  p.chars+=L.slice(1).filter(l=>{const t=l.trim();return t&&!t.startsWith('↩')&&!t.startsWith('⭐')&&!t.startsWith('🖼')&&!t.startsWith('📎')&&!t.startsWith('🔗');}).join('\n').length;
  if(/^⭐/m.test(b))p.landed++;
  const rq=/^↩ \*replying to (.+?): "/m.exec(b); if(rq)R.set(rq[1],(R.get(rq[1])||0)+1);
 }}
for(const min of [100,150,200]){
  const rows=[...P].filter(([,v])=>v.msgs>=min);
  console.log(`\n===== MIN ${min} MESSAGES — ${rows.length} qualify =====`);
  const t=rows.map(([n,v])=>({n,msgs:v.msgs,avg:v.chars/v.msgs,hit:100*v.landed/v.msgs,rr:100*(R.get(n)||0)/v.msgs}));
  console.log('-- by reply rate --');
  for(const r of [...t].sort((a,b)=>b.rr-a.rr)) console.log('  '+r.n.slice(0,30).padEnd(31)+r.rr.toFixed(1).padStart(5)+'%  avg '+r.avg.toFixed(0).padStart(4)+'ch  react '+r.hit.toFixed(1)+'%  ('+r.msgs+')');
}
