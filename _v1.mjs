import { chromium } from 'playwright';
const B = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const p = await (await B.newContext()).newPage();
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
await p.goto('http://127.0.0.1:8099/servicio.html');

const st = async () => p.evaluate(()=>{
  const l=document.querySelector('[data-sv-ficha]');
  return { hiddenProp:l.hidden, display:getComputedStyle(l).display,
           altoPx: Math.round(l.getBoundingClientRect().height),
           etiqueta:l.querySelector('span').textContent.trim() };
});
console.log('=== campo "Enlace de tu ficha" ===');
console.log('ficha_tiene=no (por defecto):', JSON.stringify(await st()));
await p.check('input[name="ficha_tiene"][value="si"]');
console.log('ficha_tiene=si             :', JSON.stringify(await st()));
await p.check('input[name="ficha_tiene"][value="no"]');
console.log('vuelve a no                :', JSON.stringify(await st()));

console.log('\n=== fieldset de datos (que SÍ tiene regla CSS) ===');
console.log(JSON.stringify(await p.evaluate(()=>{
  const f=document.querySelector('[data-sv-datos]');
  return {hiddenProp:f.hidden, display:getComputedStyle(f).display, altoPx:Math.round(f.getBoundingClientRect().height)};
})));
console.log('\nerrores JS:', errs);
await B.close();
