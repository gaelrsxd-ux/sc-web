import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:390,height:900}});
const st=()=>p.evaluate(()=>({
  datosHidden:document.querySelector('[data-sv-datos]').hidden,
  fichaHidden:document.querySelector('[data-sv-ficha]').hidden,
  tot:document.querySelector('[data-sv-tot]').textContent,
  que:document.querySelector('[data-sv-que]').textContent,
  ficha_tiene:(document.querySelector('input[name=ficha_tiene]:checked')||{}).value,
  paquete:(document.querySelector('input[name=paquete]:checked')||{}).value,
  radios:[...document.querySelectorAll('input[name=paquete]')].map(r=>r.value+(r.disabled?':dis':'')).join(' '),
  como:document.querySelector('.sv-como').textContent.trim().slice(0,60),
  botonVisible:!!document.querySelector('.ped-btn').offsetParent
}));

console.log('=== A) RECARGA (F5) con paquete elegido ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
await p.locator('label.ped-op:has(input[value="gp-e"])').click();
console.log('antes :',JSON.stringify(await st()));
await p.reload();
await p.waitForTimeout(400);
console.log('tras recargar:',JSON.stringify(await st()));

console.log('\n=== B) VOLVER ATRAS desde otra pagina (bfcache) ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
await p.locator('label.ped-op:has(input[value=si])').click();
await p.locator('label.ped-op:has(input[value="gp-t"])').click();
console.log('antes :',JSON.stringify(await st()));
await p.goto('http://127.0.0.1:8099/gracias.html');
await p.goBack();
await p.waitForTimeout(500);
console.log('tras volver:',JSON.stringify(await st()));
await b.close();
