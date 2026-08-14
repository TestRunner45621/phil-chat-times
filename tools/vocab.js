const fs=require('fs'), path=require('path');
const dir=process.argv[2];
const words=['clanker','kady','qualia','kant','runescape','covenant','messiah','god machine','vibecod','tier list','newspaper','philchat times','phil chat times','pdf','retard','metric'];
const counts={}; words.forEach(w=>counts[w]=0);
for(const f of fs.readdirSync(dir).filter(f=>/^\d\d-\d\d\.md$/.test(f))){
  const txt=fs.readFileSync(path.join(dir,f),'utf8');
  const body=txt.split(/\r?\n/).filter(l=>!l.startsWith('### ')&&!l.startsWith('↩ ')&&!l.startsWith('⭐ ')).join('\n').toLowerCase();
  for(const w of words){
    const re=new RegExp(w.replace(/ /g,'\s+'),'g');
    counts[w]+=(body.match(re)||[]).length;
  }
}
for(const w of words) console.log(w.padEnd(18), counts[w]);
