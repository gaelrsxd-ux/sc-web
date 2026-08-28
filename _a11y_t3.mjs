import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:390,height:740}});
await p.goto('http://127.0.0.1:8099/servicio.html');
const cdp=await p.context().newCDPSession(p);
await cdp.send('Accessibility.enable');
async function tree(tag){
  const {nodes}=await cdp.send('Accessibility.getFullAXTree');
  const out=[];
  for(const n of nodes){
    if(n.ignored)continue;
    const role=n.role?.value; if(!role||role==='none'||role==='generic'||role==='InlineTextBox')continue;
    const name=(n.name?.value||'').replace(/\s+/g,' ').trim();
    const props=(n.properties||[]).filter(x=>['disabled','checked','required','invalid','hidden','focusable','live','expanded'].includes(x.name))
      .map(x=>x.name+'='+x.value.value).join(',');
    out.push(`${role} | "${name.slice(0,80)}" | ${props}`);
  }
  console.log('### '+tag);
  console.log(out.join('\n'));
}
await tree('ficha_tiene=no, sin paquete elegido');
await p.check('input[value=si]');
await tree('ficha_tiene=si');
await b.close();
