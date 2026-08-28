import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await B.newContext();
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error'&&!/CONNECTION_RESET|ABORTED|googleapis|favicon/.test(m.text()))errs.push(m.text());});
let posts=[];
await ctx.route('https://pagos.sycsolutions.company/**', async r=>{
  posts.push(r.request().postData()); r.fulfill({status:200,contentType:'text/html',body:'cobro'});});

console.log('=== PLACAS: pedido.html de punta a punta ===');
await p.goto('http://127.0.0.1:8099/pedido.html');
await p.selectOption('#ped-cant','7');
console.log('  cifra grande :', await p.locator('.ped-tot').first().textContent());
for(const [n,v] of [['negocio','Kabuki'],['negocio_ciudad','SLP'],['nombre','Gael'],
                    ['tel','4441234567'],['cp','78000'],['correo','g@e.com'],
                    ['calle','Reforma 10'],['colonia','Centro'],['ciudad','SLP'],['estado','San Luis Potosí']]){
  const l=p.locator(`[name=${n}]`); if(await l.count()) await l.first().fill(v);
}
await p.waitForTimeout(300);
console.log('  cifra tras CP:', await p.locator('.ped-tot').first().textContent());
const btns = p.locator('button[type=submit], .ped-btn');
for(let i=0;i<await btns.count();i++){const b=btns.nth(i);
  if(await b.isVisible()){await b.click(); await p.waitForTimeout(350);}}
await p.waitForTimeout(500);
console.log('  POST:', posts[0]);
await p.goto('http://127.0.0.1:8099/gracias.html'); await p.waitForTimeout(400);
for(const f of await p.evaluate(()=>[...document.querySelectorAll('dt')].map(dt=>
  '  '+dt.textContent+' = '+dt.nextElementSibling.textContent))) console.log(f);

console.log('\n=== PORTADA ===');
await p.goto('http://127.0.0.1:8099/index.html');
await p.waitForTimeout(900);
console.log('  desde del servicio:', await p.locator('[data-svc-desde]').textContent());
console.log('  enlaces a servicio.html:', await p.locator('a[href*="servicio.html"]').count());
console.log('  enlaces a pedido.html  :', await p.locator('a[href*="pedido.html"]').count());
console.log('  pestañas de SOLUCIONES :', await p.locator('[role=tab]').count());
console.log('\nerrores:', errs);
await B.close();
