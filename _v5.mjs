import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await B.newContext();
const p = await ctx.newPage();
let posts=[];
await ctx.route('https://pagos.sycsolutions.company/**', async r=>{
  posts.push(r.request().postData()); r.fulfill({status:200,contentType:'text/html',body:'cobro'});});
await p.goto('http://127.0.0.1:8099/servicio.html');

// El visitante dice que SÍ aparece, pega su enlace, y luego se corrige.
await p.locator('.ped-op:has(input[value="si"])').click();
await p.locator('.ped-op:has(input[value="gp-e"])').click();
console.log('campo enlace visible con ficha_tiene=si:', await p.locator('[data-sv-ficha]').isVisible());
await p.fill('input[name=ficha]','https://maps.app.goo.gl/MiNegocio123');
await p.fill('input[name=negocio]','Kabuki'); await p.fill('input[name=negocio_ciudad]','SLP');
await p.fill('input[name=nombre]','Gael'); await p.fill('input[name=tel]','4441234567');
await p.fill('input[name=correo]','g@e.com');

// Se corrige: en realidad todavía no aparece.
await p.locator('.ped-op:has(input[value="no"])').click();
console.log('campo enlace visible con ficha_tiene=no:', await p.locator('[data-sv-ficha]').isVisible());
console.log('valor que queda dentro (invisible)    :', await p.inputValue('input[name=ficha]'));

await p.locator('button[type=submit]').click();
await p.waitForTimeout(600);
console.log('\nPOST al Worker:\n  '+posts[0]);

await p.goto('http://127.0.0.1:8099/gracias.html');
await p.waitForTimeout(400);
console.log('\nResumen en gracias.html:');
for(const f of await p.evaluate(()=>[...document.querySelectorAll('dt')].map(dt=>
  '  '+dt.textContent+' = '+dt.nextElementSibling.textContent))) console.log(f);
await B.close();
