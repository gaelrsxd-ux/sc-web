import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage();
const desc=()=>p.evaluate(()=>{
  const a=document.activeElement; if(!a)return 'NULL';
  const t=a.tagName.toLowerCase(); let s=t;
  if(a.name)s+=`[${a.name}=${a.value}]`;
  const txt=(a.innerText||a.closest('label')?.innerText||'').trim().replace(/\s+/g,' ').slice(0,48);
  return s+' :: '+txt+(a.disabled?' [DIS]':'')+(a.checked?' [CHK]':'');
});
const st=()=>p.evaluate(()=>({
  datosHidden:document.querySelector('[data-sv-datos]').hidden,
  fichaHidden:document.querySelector('[data-sv-ficha]').hidden,
  tot:document.querySelector('[data-sv-tot]').textContent,
  que:document.querySelector('[data-sv-que]').textContent,
  radios:[...document.querySelectorAll('input[name=paquete]')].map(r=>`${r.value}${r.disabled?':dis':''}${r.checked?':CHK':''}`).join(' ')
}));

await p.goto('http://127.0.0.1:8099/servicio.html');
console.log('=== A) COMPRA SOLO CON TECLADO (ficha_tiene=no) ===');
for(let i=0;i<4;i++) await p.keyboard.press('Tab');   // hasta gp-e
console.log('foco tras 4 Tab:', await desc());
console.log('  ArrowDown x1 ->'); await p.keyboard.press('ArrowDown');
console.log('  foco:', await desc(), JSON.stringify(await st()));
console.log('  ArrowDown x1 ->'); await p.keyboard.press('ArrowDown');
console.log('  foco:', await desc(), JSON.stringify(await st()));
console.log('  ArrowUp x2 -> volver a gp-e');
await p.keyboard.press('ArrowUp'); await p.keyboard.press('ArrowUp');
console.log('  foco:', await desc(), JSON.stringify(await st()));
console.log('  siguientes Tabs:');
for(let i=0;i<12;i++){ await p.keyboard.press('Tab'); console.log('   ',i, await desc()); }

console.log('\n=== B) ficha_tiene = si : ¿se saltan las apagadas? ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
for(let i=0;i<3;i++) await p.keyboard.press('Tab');   // ficha_tiene no
await p.keyboard.press('ArrowDown');                   // -> si
console.log('foco:', await desc(), JSON.stringify(await st()));
console.log('tabs:');
for(let i=0;i<10;i++){ await p.keyboard.press('Tab'); console.log('  ',i, await desc()); }

console.log('\n=== C) arrows dentro del grupo paquete con 2 deshabilitadas ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
for(let i=0;i<3;i++) await p.keyboard.press('Tab');
await p.keyboard.press('ArrowDown'); // ficha_tiene=si
await p.keyboard.press('Tab');       // entra al grupo paquete
console.log('entrada grupo:', await desc());
for(let i=0;i<5;i++){ await p.keyboard.press('ArrowDown'); console.log('  Down',i,await desc()); }

console.log('\n=== D) elijo anticipo, luego digo que YA tengo ficha: ¿dónde queda el foco? ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
for(let i=0;i<4;i++) await p.keyboard.press('Tab');
await p.keyboard.press('ArrowDown'); // gp-ea anticipo
console.log('elegido:', await desc(), JSON.stringify(await st()));
await p.keyboard.press('Shift+Tab');
console.log('shift-tab ->', await desc());
await p.keyboard.press('ArrowDown'); // ficha_tiene=si
console.log('tras cambiar a si -> foco:', await desc());
console.log('estado:', JSON.stringify(await st()));
await b.close();
