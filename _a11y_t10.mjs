import {chromium} from 'playwright';
const b=await chromium.launch({executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome'});
const p=await b.newPage({viewport:{width:390,height:900}});
const foco=()=>p.evaluate(()=>{const a=document.activeElement;return a.tagName+(a.name?'['+a.name+'='+a.value+']':'')+' :: '+(a.textContent||'').trim().replace(/\s+/g,' ').slice(0,40);});

async function caso(tag, accion){
  await p.goto('http://127.0.0.1:8099/servicio.html');
  await p.evaluate(()=>{const r=document.querySelector('input[value="gp-ea"]');r.checked=true;r.dispatchEvent(new Event('change',{bubbles:true}));});
  await p.locator('[name=negocio]').click();
  await p.keyboard.type('Kabuki');
  console.log('\n### '+tag);
  console.log(' foco antes:',await foco());
  await accion();
  console.log(' foco despues:',await foco());
  console.log(' datos oculto:',await p.evaluate(()=>document.querySelector('[data-sv-datos]').hidden));
  await p.keyboard.press('Tab');
  console.log(' tras Tab:',await foco());
}

await caso('CLIC de raton en la tarjeta "Ya aparece en Google"', async()=>{
  await p.locator('label.ped-op:has(input[value=si])').click();
});
await caso('TAP tactil en la misma tarjeta', async()=>{
  const bx=await p.locator('label.ped-op:has(input[value=si])').boundingBox();
  await p.locator('label.ped-op:has(input[value=si])').dispatchEvent('click');
});
await b.close();
