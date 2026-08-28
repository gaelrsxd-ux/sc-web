import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await B.newContext();
const p = await ctx.newPage();
const msgs=[]; p.on('console',m=>{if(m.type()==='error')msgs.push(m.text());});
p.on('pageerror',e=>msgs.push('pageerror: '+e.message));
let posts=[];
await ctx.route('https://pagos.sycsolutions.company/**', async r=>{
  posts.push(r.request().postData()); r.fulfill({status:200,contentType:'text/html',body:'cobro'});});

await p.goto('http://127.0.0.1:8099/servicio.html');

console.log('=== A) al cargar (con JS) ===');
console.log('  botón Pagar visible :', await p.locator('button[type=submit]').isVisible());
console.log('  enlace Términos vis.:', await p.locator('.ped-pie a').first().isVisible());
console.log('  nota Mercado Pago   :', await p.locator('.ped-pie').isVisible());

console.log('\n=== B) requestSubmit() sin paquete (equivale a Enter) ===');
const r1 = await p.evaluate(()=>{const f=document.getElementById('sv-form');
  f.requestSubmit(); return {valido:f.checkValidity()};});
await p.waitForTimeout(500);
console.log('  ¿POST al cobro?', posts.length>0, r1);
console.log('  primer control inválido:', await p.evaluate(()=>{
  const f=document.getElementById('sv-form');
  const e=[...f.elements].find(x=>x.willValidate&&!x.checkValidity());
  return e?{name:e.name, msg:e.validationMessage, display:getComputedStyle(e).display,
    padreOculto: !!e.closest('[hidden]')}:null;}));

console.log('\n=== C) elijo ANTICIPO, lleno todo, y luego digo "ya aparece en Google" ===');
await p.locator('.ped-op:has(input[value="gp-ea"])').click();
await p.fill('input[name=negocio]','Kabuki'); await p.fill('input[name=negocio_ciudad]','SLP');
await p.fill('input[name=nombre]','Gael'); await p.fill('input[name=tel]','4441234567');
await p.fill('input[name=correo]','g@e.com');
console.log('  antes -> cifra:', JSON.stringify(await p.locator('[data-sv-tot]').textContent()),
            '| botón visible:', await p.locator('button[type=submit]').isVisible());
await p.locator('.ped-op:has(input[value="si"])').click();
console.log('  después -> cifra:', JSON.stringify(await p.locator('[data-sv-tot]').textContent()),
            '| qué:', JSON.stringify(await p.locator('[data-sv-que]').textContent()));
console.log('  botón Pagar visible:', await p.locator('button[type=submit]').isVisible());
console.log('  datos visibles     :', await p.locator('[data-sv-datos]').isVisible());
console.log('  anticipos disabled :', await p.evaluate(()=>[...document.querySelectorAll('input[data-anticipo]')].map(o=>o.disabled)));
console.log('  frases:');
for(const t of await p.locator('.sv-como').allTextContents()) console.log('    · '+t);

console.log('\n=== D) ahora elijo de contado: ¿siguen mis datos escritos? ===');
await p.locator('.ped-op:has(input[value="gp-e"])').click();
console.log('  datos visibles:', await p.locator('[data-sv-datos]').isVisible());
console.log('  campos:', await p.evaluate(()=>['negocio','negocio_ciudad','nombre','tel','correo']
  .map(n=>n+'='+document.querySelector(`[name=${n}]`).value).join(' | ')));
console.log('  campo "enlace de tu ficha" visible:', await p.locator('[data-sv-ficha]').isVisible());

posts=[];
await p.locator('button[type=submit]').click();
await p.waitForTimeout(600);
console.log('\n  POST enviado:', posts[0]);
console.log('\nerrores de consola:', msgs);
await B.close();
