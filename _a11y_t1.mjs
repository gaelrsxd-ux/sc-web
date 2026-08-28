import {chromium} from 'playwright';
const EXE='/opt/pw-browsers/chromium-1194/chrome-linux/chrome';
const b=await chromium.launch({executablePath:EXE});
const p=await b.newPage();
await p.goto('http://127.0.0.1:8099/servicio.html');

const desc=()=>p.evaluate(()=>{
  const a=document.activeElement;
  if(!a)return 'NULL';
  const t=a.tagName.toLowerCase();
  let s=t;
  if(a.name)s+=`[name=${a.name}]`;
  if(a.value!==undefined&&t==='input'&&a.type==='radio')s+=`[value=${a.value}]`;
  if(a.type)s+=`(${a.type})`;
  const txt=(a.innerText||a.closest('label')?.innerText||'').trim().replace(/\s+/g,' ').slice(0,55);
  return s+' :: '+txt+(a.disabled?' [DISABLED]':'')+(a.checked?' [CHECKED]':'');
});

console.log('--- TAB ORDER desde el inicio (ficha_tiene=no por defecto) ---');
for(let i=0;i<16;i++){
  await p.keyboard.press('Tab');
  console.log(i, await desc());
}

console.log('\n--- estado del bloque datos al cargar ---');
console.log(await p.evaluate(()=>{
  const d=document.querySelector('[data-sv-datos]');
  return JSON.stringify({hidden:d.hidden, ariaLive:d.getAttribute('aria-live'), role:d.getAttribute('role'),
    tot:document.querySelector('[data-sv-tot]').outerHTML,
    que:document.querySelector('[data-sv-que]').outerHTML,
    liveRegions:[...document.querySelectorAll('[aria-live],[role=status],[role=alert],output')].map(e=>e.outerHTML.slice(0,90))});
}));
await b.close();
