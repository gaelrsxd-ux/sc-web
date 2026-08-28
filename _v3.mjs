import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await B.newContext();
const p = await ctx.newPage();
const msgs=[]; p.on('console',m=>msgs.push(m.type()+': '+m.text()));
p.on('pageerror',e=>msgs.push('pageerror: '+e.message));
let posts=0;
await ctx.route('https://pagos.sycsolutions.company/**', r=>{posts++;
  r.fulfill({status:200,contentType:'text/html',body:'cobro'});});

await p.goto('http://127.0.0.1:8099/servicio.html');
console.log('=== A) enviar SIN elegir paquete ===');
await p.locator('[type=submit]').click();
await p.waitForTimeout(600);
console.log('  ¿se envió al cobro?', posts>0);
console.log('  sigue en:', new URL(p.url()).pathname);
console.log('  validación del navegador:', await p.evaluate(()=>{
  const f=document.getElementById('sv-form');
  const inv=[...f.elements].filter(e=>e.willValidate&&!e.checkValidity());
  return inv.slice(0,3).map(e=>({name:e.name, msg:e.validationMessage,
    visible:e.getBoundingClientRect().width>0||getComputedStyle(e).display!=='none',
    display:getComputedStyle(e).display}));
}));
console.log('  consola:', msgs);

console.log('\n=== B) el bloque de datos con paquete elegido ===');
await p.locator('.ped-op:has(input[value="gp-ea"])').click();
console.log('  datos visibles:', await p.locator('[data-sv-datos]').isVisible());
console.log('  cifra arriba  :', await p.locator('[data-sv-tot]').textContent());
console.log('  qué           :', await p.locator('[data-sv-que]').textContent());

console.log('\n=== C) cambiar a "ya aparece en Google" con anticipo elegido ===');
await p.locator('.ped-op:has(input[value="si"])').click();
console.log('  datos visibles:', await p.locator('[data-sv-datos]').isVisible());
console.log('  cifra arriba  :', JSON.stringify(await p.locator('[data-sv-tot]').textContent()));
console.log('  frases sv-como:');
for(const t of await p.locator('.sv-como').allTextContents()) console.log('    · '+t);
console.log('  anticipos deshabilitados:', await p.evaluate(()=>
  [...document.querySelectorAll('input[data-anticipo]')].map(o=>o.disabled)));
console.log('  ¿alguno marcado?:', await p.evaluate(()=>
  !!document.querySelector('input[name=paquete]:checked')));

console.log('\n=== D) enviar ahora (sin paquete, datos ocultos con required dentro) ===');
posts=0; msgs.length=0;
await p.locator('[type=submit]').click();
await p.waitForTimeout(600);
console.log('  ¿se envió?', posts>0, '| consola:', msgs);
await B.close();
