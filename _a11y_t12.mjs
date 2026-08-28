import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:390,height:900}});
await p.route('**pagos.sycsolutions.company/**',r=>r.fulfill({status:200,body:'OK'}));
let post=null; p.on('request',r=>{if(r.method()==='POST')post=r.postData();});
const st=()=>p.evaluate(()=>({
  datos:document.querySelector('[data-sv-datos]').hidden?'OCULTO':'visible',
  boton:document.querySelector('.ped-btn').offsetParent?'visible':'NO EXISTE en pantalla',
  tot:document.querySelector('[data-sv-tot]').textContent||'(vacio)',
  que:document.querySelector('[data-sv-que]').textContent,
  ficha_tiene:(document.querySelector('input[name=ficha_tiene]:checked')||{}).value,
  paquete:(document.querySelector('input[name=paquete]:checked')||{}).value,
  anticipoApagado:document.querySelector('input[value="gp-ta"]').disabled,
  tarjetaMarcada:!!document.querySelector('label.ped-op:has(input[name=paquete]:checked)'),
  como:document.querySelectorAll('.sv-como')[1].textContent.trim().slice(0,70)
}));

console.log('=== CAMINO REAL: leer los terminos desde el formulario y volver ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
await p.locator('label.ped-op:has(input[value=si])').click();       // "Ya aparece en Google"
await p.locator('label.ped-op:has(input[value="gp-t"])').click();   // "Todo hecho de contado"
await p.fill('[name=negocio]','Kabuki'); await p.fill('[name=nombre]','Gael');
console.log('1. antes de irme:',JSON.stringify(await st(),null,0));
await p.locator('a[href="terminos.html#servicios"]').first().click();
await p.waitForLoadState();
console.log('2. estoy en:',p.url());
await p.goBack(); await p.waitForTimeout(600);
console.log('3. AL VOLVER  :',JSON.stringify(await st(),null,0));
console.log('   negocio escrito antes:',await p.evaluate(()=>document.querySelector('[name=negocio]').value));

console.log('\n-- ¿puedo recuperar el boton pulsando el paquete que YA está marcado? --');
await p.locator('label.ped-op:has(input[value="gp-t"])').click();
console.log('   tras pulsarlo:',JSON.stringify(await st(),null,0));

console.log('\n-- ¿puedo ahora elegir ANTICIPO teniendo ficha propia (regla 2)? --');
await p.locator('label.ped-op:has(input[value="gp-ta"])').click();
console.log('   ',JSON.stringify(await st(),null,0));
await p.fill('[name=negocio]','Kabuki'); await p.fill('[name=negocio_ciudad]','SLP');
await p.fill('[name=nombre]','Gael'); await p.fill('[name=tel]','4441234567'); await p.fill('[name=correo]','a@b.com');
await p.click('button[type=submit]'); await p.waitForTimeout(900);
console.log('   POST:',post);

console.log('\n=== lo mismo, SOLO CON TECLADO (Alt+Flecha izquierda) ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
await p.locator('label.ped-op:has(input[value="gp-e"])').click();
await p.goto('http://127.0.0.1:8099/gracias.html');
await p.goBack(); await p.waitForTimeout(600);
const tabs=[];
for(let i=0;i<9;i++){await p.keyboard.press('Tab');tabs.push(await p.evaluate(()=>{const a=document.activeElement;return a.tagName+(a.name?'['+a.name+'='+a.value+']':'')+(a.type==='submit'?':PAGAR':'');}));}
console.log('recorrido con Tab al volver:',tabs.join(' -> '));
await b.close();
