import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:390,height:740}});
await p.goto('http://127.0.0.1:8099/servicio.html');
const cdp=await p.context().newCDPSession(p);
await cdp.send('Accessibility.enable');
async function tree(tag,filter){
  const {nodes}=await cdp.send('Accessibility.getFullAXTree');
  const out=[];
  for(const n of nodes){
    if(n.ignored)continue;
    const role=n.role?.value; if(!role||['none','generic','InlineTextBox','LabelText','paragraph','Legend'].includes(role))continue;
    const name=(n.name?.value||'').replace(/\s+/g,' ').trim();
    const props=(n.properties||[]).filter(x=>['disabled','checked','required','invalid','live','expanded','describedby'].includes(x.name))
      .map(x=>x.name+'='+JSON.stringify(x.value.value)).join(',');
    out.push(`${role} | "${name.slice(0,70)}" | ${props}`);
  }
  console.log('\n### '+tag);
  console.log(out.filter(l=>!filter||filter.test(l)).join('\n'));
}
const pick=(sel)=>p.evaluate(s=>{const e=document.querySelector(s);e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));},sel);

await pick('input[name=ficha_tiene][value=si]');
await tree('ficha_tiene=si','');
console.log('\n>>> ¿algo con live region?', await p.evaluate(()=>document.querySelectorAll('[aria-live],[role=status],[role=alert],output').length));
await pick('input[name=paquete][value=gp-e]');
await tree('ficha_tiene=si + paquete gp-e elegido','');
await b.close();
