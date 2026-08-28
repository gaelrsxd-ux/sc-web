import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:390,height:900},deviceScaleFactor:2});
await p.goto('http://127.0.0.1:8099/servicio.html');
// tab hasta gp-e y captura el anillo de foco
for(let i=0;i<4;i++)await p.keyboard.press('Tab');
await p.locator('.sv-plan').first().scrollIntoViewIfNeeded();
await p.locator('.sv-plan').first().screenshot({path:'/tmp/a11y/foco.png'});
console.log('foco en:',await p.evaluate(()=>document.activeElement.value));

console.log('\n=== datos escritos se conservan tras ocultar/mostrar? ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
await p.evaluate(()=>{const r=document.querySelector('input[value="gp-ea"]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));});
await p.fill('[name=negocio]','Kabuki'); await p.fill('[name=nombre]','Gael');
await p.evaluate(()=>{const s=document.querySelector('input[name=ficha_tiene][value=si]');s.checked=true;s.dispatchEvent(new Event('change',{bubbles:true}));});
console.log('tras decir SI:',await p.evaluate(()=>({datosHidden:document.querySelector('[data-sv-datos]').hidden,neg:document.querySelector('[name=negocio]').value,paq:(document.querySelector('input[name=paquete]:checked')||{}).value,tot:document.querySelector('[data-sv-tot]').textContent,que:document.querySelector('[data-sv-que]').textContent})));
await p.evaluate(()=>{const r=document.querySelector('input[value="gp-e"]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));});
console.log('tras elegir contado:',await p.evaluate(()=>({datosHidden:document.querySelector('[data-sv-datos]').hidden,neg:document.querySelector('[name=negocio]').value})));

console.log('\n=== ¿el foco se pierde si datos se oculta con el foco dentro? (simulando raton/lector) ===');
await p.goto('http://127.0.0.1:8099/servicio.html');
await p.evaluate(()=>{const r=document.querySelector('input[value="gp-ea"]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));});
await p.focus('[name=negocio]');
console.log('foco antes:',await p.evaluate(()=>document.activeElement.name));
await p.evaluate(()=>{const s=document.querySelector('input[name=ficha_tiene][value=si]');s.checked=true;s.dispatchEvent(new Event('change',{bubbles:true}));});
console.log('foco despues:',await p.evaluate(()=>document.activeElement.tagName+'/'+(document.activeElement.name||'')));
// y ahora Tab: ¿a donde va?
await p.keyboard.press('Tab');
console.log('tras Tab:',await p.evaluate(()=>{const a=document.activeElement;return a.tagName+(a.name?'['+a.name+'='+a.value+']':'')+' :: '+(a.textContent||'').trim().slice(0,40);}));
await b.close();
