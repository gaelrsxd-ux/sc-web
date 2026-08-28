import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:390,height:900}});
const st=()=>p.evaluate(()=>({
  datos:document.querySelector('[data-sv-datos]').hidden?'OCULTO':'visible',
  boton:document.querySelector('.ped-btn').offsetParent?'visible':'NO',
  tot:document.querySelector('[data-sv-tot]').textContent||'(vacio)',
  que:document.querySelector('[data-sv-que]').textContent,
  ft:(document.querySelector('input[name=ficha_tiene]:checked')||{}).value,
  paq:(document.querySelector('input[name=paquete]:checked')||{}).value,
  antiDis:document.querySelector('input[value="gp-ta"]').disabled}));

console.log('=== RECARGA (F5) con ficha propia + paquete ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
await p.locator('label.ped-op:has(input[value=si])').click();
await p.locator('label.ped-op:has(input[value="gp-t"])').click();
console.log('antes:',JSON.stringify(await st()));
await p.reload(); await p.waitForTimeout(500);
console.log('tras F5:',JSON.stringify(await st()));

console.log('\n=== VOLVER desde una pagina EXTERNA (como Mercado Pago) ===');
await p.route('**mp.example/**',r=>r.fulfill({status:200,headers:{'content-type':'text/html'},body:'<h1>MP</h1>'}));
await p.goto('http://127.0.0.1:8099/servicio.html');
await p.locator('label.ped-op:has(input[value=si])').click();
await p.locator('label.ped-op:has(input[value="gp-t"])').click();
await p.goto('https://mp.example/checkout');
await p.goBack(); await p.waitForTimeout(700);
console.log('tras volver:',JSON.stringify(await st()));

console.log('\n=== control: pedido.html sufre lo mismo al volver? ===');
await p.goto('http://127.0.0.1:8099/pedido.html');
console.log(await p.evaluate(()=>[...document.querySelectorAll('[data-paso]')].length+' pasos'));
await b.close();
