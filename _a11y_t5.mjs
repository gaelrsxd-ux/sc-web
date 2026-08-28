import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:390,height:740}});
await p.goto('http://127.0.0.1:8099/servicio.html');
await p.evaluate(()=>{const e=document.querySelector('input[name=ficha_tiene][value=si]');e.checked=true;e.dispatchEvent(new Event('change',{bubbles:true}));});
await p.locator('.sv-plan').first().scrollIntoViewIfNeeded();
await p.locator('.sv-plan').first().screenshot({path:'/tmp/a11y/apagada.png'});
console.log('captura guardada');

await p.goto('http://127.0.0.1:8099/servicio.html');
for(let i=0;i<4;i++)await p.keyboard.press('Tab');
await p.keyboard.press('Space');
const info=await p.evaluate(()=>{
  const t=document.querySelector('.ped-prod').getBoundingClientRect();
  const d=document.querySelector('[data-sv-datos]').getBoundingClientRect();
  const f=document.activeElement.closest('.ped-op').getBoundingClientRect();
  return {scrollY:Math.round(scrollY), vh:innerHeight,
    prodTop:Math.round(t.top), prodBottom:Math.round(t.bottom),
    datosTop:Math.round(d.top),
    botonTop:Math.round(document.querySelector('.ped-btn').getBoundingClientRect().top),
    focoTop:Math.round(f.top), focoBottom:Math.round(f.bottom),
    tot:document.querySelector('[data-sv-tot]').textContent};
});
console.log('tras marcar con teclado (390x740):',JSON.stringify(info));
await p.screenshot({path:'/tmp/a11y/tras-elegir.png'});
console.log('outline tarjeta enfocada:', await p.evaluate(()=>{
  const l=document.activeElement.closest('.ped-op');const s=getComputedStyle(l);
  return s.outlineStyle+' '+s.outlineWidth+' '+s.outlineColor+' offset '+s.outlineOffset;}));
await b.close();
