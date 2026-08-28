import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage();
await p.route('**pagos.sycsolutions.company/**',r=>r.fulfill({status:200,body:'OK'}));
let post=null;
p.on('request',r=>{if(r.method()==='POST')post=r.postData();});
await p.goto('http://127.0.0.1:8099/servicio.html');

console.log('=== COMPRA 100% TECLADO ===');
const seq=[];
async function tab(n=1){for(let i=0;i<n;i++){await p.keyboard.press('Tab');seq.push(await p.evaluate(()=>{const a=document.activeElement;return a.tagName+(a.name?'['+a.name+']':'')+(a.textContent&&a.tagName==='BUTTON'?':'+a.textContent.trim():'');}));}}
await tab(4);                       // links x2, ficha_tiene, paquete gp-e
await p.keyboard.press('Space');    // marca gp-e
await tab(2);                       // link "Qué incluye" -> negocio
await p.keyboard.type('Kabuki');
await tab(1); await p.keyboard.type('San Luis Potosí');
await tab(1); await p.keyboard.type('Gael');
await tab(1); await p.keyboard.type('4441234567');
await tab(1); await p.keyboard.type('a@b.com');
await tab(1);                       // boton PAGAR
console.log('recorrido:',seq.join(' -> '));
await p.keyboard.press('Enter');
await p.waitForTimeout(1200);
console.log('POST enviado:',post);
console.log('sessionStorage:',await p.evaluate(()=>sessionStorage.getItem('syc_pedido')));

console.log('\n=== ficha oculta: ¿se sigue enviando el valor? ===');
const p2=await b.newPage();
await p2.route('**pagos.sycsolutions.company/**',r=>r.fulfill({status:200,body:'OK'}));
let post2=null; p2.on('request',r=>{if(r.method()==='POST')post2=r.postData();});
await p2.goto('http://127.0.0.1:8099/servicio.html');
await p2.evaluate(()=>{const s=document.querySelector('input[value=si]');s.checked=true;s.dispatchEvent(new Event('change',{bubbles:true}));});
await p2.evaluate(()=>{const r=document.querySelector('input[value="gp-e"]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));});
await p2.fill('[name=ficha]','https://maps.app.goo.gl/XXXX');
// ahora cambia de idea: NO tengo ficha
await p2.evaluate(()=>{const s=document.querySelector('input[name=ficha_tiene][value=no]');s.checked=true;s.dispatchEvent(new Event('change',{bubbles:true}));});
console.log('estado tras volver a NO:',await p2.evaluate(()=>({fichaHidden:document.querySelector('[data-sv-ficha]').hidden,valor:document.querySelector('[name=ficha]').value, datosHidden:document.querySelector('[data-sv-datos]').hidden, paquete:(document.querySelector('input[name=paquete]:checked')||{}).value})));
await p2.evaluate(()=>{const r=document.querySelector('input[value="gp-e"]');if(!r.checked){r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));}});
await p2.fill('[name=negocio]','Kabuki'); await p2.fill('[name=negocio_ciudad]','SLP');
await p2.fill('[name=nombre]','Gael'); await p2.fill('[name=tel]','4441234567'); await p2.fill('[name=correo]','a@b.com');
await p2.click('button[type=submit]');
await p2.waitForTimeout(1000);
console.log('POST:',post2);
console.log('sessionStorage:',await p2.evaluate(()=>sessionStorage.getItem('syc_pedido')));
await b.close();
