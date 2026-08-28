import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const ctx = await B.newContext();
const p = await ctx.newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
// interceptar el POST al cobro para no salir a internet
await ctx.route('https://pagos.sycsolutions.company/**', r =>
  r.fulfill({status:200, contentType:'text/html', body:'<html><body>cobro</body></html>'}));

await p.goto('http://127.0.0.1:8099/servicio.html');
const card = v => p.locator(`.ped-op:has(input[value="${v}"])`);

await card('gp-e').click();
await p.fill('input[name="negocio"]','Taquería El Buen Sabor');
await p.fill('input[name="negocio_ciudad"]','San Luis Potosí');
await p.fill('input[name="nombre"]','Gael Ruiz');
await p.fill('input[name="tel"]','4421234567');
await p.fill('input[name="correo"]','gael@ejemplo.com');
await p.click('button[type="submit"], .ped-enviar, [type=submit]');
await p.waitForTimeout(800);

const guardado = await p.evaluate(()=>sessionStorage.getItem('syc_pedido'));
console.log('sessionStorage syc_pedido:', guardado);

await p.goto('http://127.0.0.1:8099/gracias.html');
await p.waitForTimeout(400);
const filas = await p.evaluate(()=>[...document.querySelectorAll('dt')].map(dt=>
  dt.textContent+' = '+(dt.nextElementSibling?dt.nextElementSibling.textContent:'')));
console.log('\n=== resumen en gracias.html ===');
filas.forEach(f=>console.log('  '+f));
console.log('\nerrores JS:', errs);
await B.close();
