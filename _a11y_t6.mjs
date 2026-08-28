import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:390,height:740}});
await p.goto('http://127.0.0.1:8099/servicio.html');
const m=()=>p.evaluate(()=>{const a=document.activeElement;const r=a.getBoundingClientRect();
  const card=a.closest?.('.ped-op')?.getBoundingClientRect();
  const cs=getComputedStyle(a);
  return {el:a.tagName+(a.name?'['+a.name+'='+a.value+']':''),scrollY:Math.round(scrollY),
    rect:[Math.round(r.top),Math.round(r.height),Math.round(r.width)],
    card:card?[Math.round(card.top),Math.round(card.height)]:null,
    pos:cs.position};});
for(let i=0;i<7;i++){await p.keyboard.press('Tab');console.log(i,JSON.stringify(await m()));}
console.log('--- ahora Space y despues Tab hacia los campos ---');
await p.keyboard.press('Space');
console.log('tras Space',JSON.stringify(await m()));
for(let i=0;i<4;i++){await p.keyboard.press('Tab');console.log('tab',i,JSON.stringify(await m()));}

console.log('\n=== control: pedido.html (mismo patron .ped-op) ===');
await p.goto('http://127.0.0.1:8099/pedido.html');
for(let i=0;i<6;i++){await p.keyboard.press('Tab');console.log(i,JSON.stringify(await m()));}
await b.close();
