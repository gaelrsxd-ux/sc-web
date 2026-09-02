/* Las tres páginas de cobro que NO son de Google: el sitio web, el agente de
   WhatsApp con IA y la automatización. Comparten esqueleto y script con
   servicio.html —cuya suite es servicio.mjs— y por eso aquí no se vuelve a
   probar el mecanismo (abrir el paquete, el botón de pagar, la vuelta atrás):
   se prueba lo que es DE ESTAS PÁGINAS y lo que las une con el resto de la
   web, que es donde se cuela una contradicción:

     · cada página cobra exactamente las dos filas que el Worker tiene en su
       catálogo para su familia, y el anticipo más el resto suman el contado;
     · no hay pregunta de la ficha ni combo de placas, y el anticipo está
       siempre disponible;
     · los campos propios de cada familia viajan al cobro, y la página de
       gracias sabe cuál de los tres pasos toca;
     · la portada anuncia el mismo precio y lleva a la misma página;
     · los términos nombran cada precio, y la mensualidad del agente.

   Se corre igual que las otras:
     node servidor.js 8099 &
     node pruebas/paquetes.mjs                                                */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';

const BASE  = process.env.BASE  || 'http://127.0.0.1:8099';
const COBRO = 'https://pagos.sycsolutions.company/**';
const S     = process.env.CAPTURAS || '';

/* El catálogo del Worker es la referencia: lo que la página enseña tiene que
   ser lo que el cobro va a cobrar, y esto es lo que el cobro va a cobrar. */
const TABLA = JSON.parse(readFileSync(new URL(
  '../Kimi_Agent_Web 3D Optimizada/cloudflare/pagos/paquetes.json', import.meta.url), 'utf8'));
const TERMINOS = readFileSync(new URL(
  '../Kimi_Agent_Web 3D Optimizada/app/terminos.html', import.meta.url), 'utf8');
const porFamilia = f => TABLA.paquetes.filter(p => p.familia === f);

const FAMILIAS = [
  { f: 'web',  pagina: 'web.html',            ancla: 'sitio-web',      nombre: /sitio web/i,
    propios: ['giro', 'dominio'],       obligatorios: ['negocio', 'giro'],
    relleno: { giro: 'Sushi', dominio: 'kabuki.mx' },       paso: /logo/i },
  { f: 'ia',   pagina: 'ia.html',             ancla: 'agente-ia',      nombre: /agente de whatsapp/i,
    propios: ['giro'],    obligatorios: ['negocio', 'giro'],
    relleno: { giro: 'Sushi' },   paso: /horarios/i, mensual: 990 },
  { f: 'auto', pagina: 'automatizacion.html', ancla: 'automatizacion', nombre: /automatizaci/i,
    propios: ['tarea', 'herramientas'], obligatorios: ['negocio', 'tarea'],
    relleno: { tarea: 'Pasar los pedidos a un Excel', herramientas: 'WhatsApp, Excel' }, paso: /llamada/i },
];

const navegador = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
let fallos = 0, cuenta = 0;
const ok = (c, t) => { cuenta++; if (!c) fallos++; console.log((c ? '  ok    ' : '  FALLA ') + t); };
const errores = [];
const vigila = pg => {
  pg.on('pageerror', e => errores.push(pg.url() + ' pageerror: ' + e.message));
  pg.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/CONNECTION_RESET|ABORTED|googleapis/.test(t)) errores.push(pg.url() + ' ' + t); });
};
const hasta = async (cond, que, ms = 8000) => {
  const fin = Date.now() + ms;
  for (;;) {
    try { if (await cond()) return true; } catch (_) { /* navegando: se reintenta */ }
    if (Date.now() > fin) { ok(false, `ESPERA agotada (${ms} ms): ${que}`); return false; }
    await new Promise(r => setTimeout(r, 30));
  }
};
const lista = pg => hasta(() => pg.$eval('[data-sv-datos]', e => e.hidden), 'el script arrancó');
/* Se toca la tarjeta ARRIBA, donde va el nombre: «ver qué incluye» cae en
   medio y tiene su propio gesto (ver servicio.mjs). */
const tocaPlan = pg => pg.locator('.sv-plan .sv-elige').click({ position: { x: 24, y: 18 } });
const miles = n => n.toLocaleString('en-US');

for (const F of FAMILIAS) {
  console.log(`\n══ ${F.pagina} ══`);
  const filas = porFamilia(F.f);
  const contado = filas.find(p => !p.resto), anticipo = filas.find(p => Number(p.resto) > 0);
  ok(contado && anticipo, 'el catálogo del Worker tiene su contado y su anticipo');

  const ctx = await navegador.newContext();
  const pg = await ctx.newPage();
  vigila(pg);
  let enviado = null;
  await ctx.route(COBRO, async ruta => {
    enviado = ruta.request().postData();
    await ruta.fulfill({ status: 200, contentType: 'text/html', body: 'ok' });
  });

  await pg.goto(BASE + '/' + F.pagina, { waitUntil: 'domcontentloaded' });
  await lista(pg);

  /* ---- un paquete, dos formas de pago, ninguna marcada ---- */
  ok(await pg.locator('.sv-plan').count() === 1, 'UN paquete en pantalla');
  const ops = pg.locator('input[name="paquete"]');
  ok(await ops.count() === 2, 'y dos formas de pago dentro: contado y anticipo');
  ok(await pg.$$eval('input[name="paquete"]', is => is.every(i => i.required && !i.checked)),
     'las dos obligatorias y ninguna marcada de fábrica');
  ok(await pg.locator('input[name="ficha_tiene"]').count() === 0, 'sin la pregunta de la ficha: es de Google');
  ok(await pg.locator('[data-sv-placas]').count() === 0, 'sin contador de placas: es de Google');

  /* ---- lo que la página ENSEÑA es lo que el Worker COBRA ---- */
  const precioTarjeta = (await pg.locator('.sv-nom span').innerText()).trim();
  ok(precioTarjeta === '$' + miles(contado.total), `la tarjeta dice ${precioTarjeta}, el catálogo ${contado.total}`);
  const radios = await pg.$$eval('input[name="paquete"]', is => is.map(i => ({
    value: i.value, num: Number(i.dataset.num), resto: Number(i.dataset.resto || 0), ant: i.dataset.anticipo === '1' })));
  const rc = radios.find(r => !r.ant), ra = radios.find(r => r.ant);
  ok(rc && rc.value === contado.id && rc.num === contado.total, `el contado es la fila ${contado.id} a $${miles(contado.total)}`);
  ok(ra && ra.value === anticipo.id && ra.num === anticipo.total && ra.resto === anticipo.resto,
     `el anticipo es la fila ${anticipo.id}: $${miles(anticipo.total)} hoy y $${miles(anticipo.resto)} después`);
  ok(ra && ra.num + ra.resto === contado.total, 'anticipo + resto = contado, al peso');

  /* ---- la frase de cómo se paga, ANTES de elegir, y con la entrega de esta familia ---- */
  const frase = (await pg.locator('.sv-como-sola').innerText()).replace(/\s+/g, ' ').trim();
  ok(/contado/i.test(frase) && frase.includes('$' + miles(anticipo.total) + ' de anticipo') &&
     frase.includes('$' + miles(anticipo.resto)), 'dice cómo se paga antes de elegir: ' + frase);
  const entrega = (frase.match(/cuando te entreguemos (.+?)\.$/) || [])[1];
  ok(!!entrega && !/acceso/.test(entrega), 'y promete el resto con la entrega de ESTA familia: «' + entrega + '»');
  ok(await pg.locator('.sv-como-si, .sv-como-no').count() === 0, 'sin las dos frases de la ficha, que aquí serían las dos falsas');

  if (F.mensual) {
    const nota = (await pg.locator('.sv-nota').innerText()).replace(/\s+/g, ' ');
    ok(nota.includes('$' + miles(F.mensual) + ' al mes') && /segundo mes/i.test(nota) && /aparte/i.test(nota),
       'la mensualidad se dice en la tarjeta, antes de pagar: ' + nota);
  }

  /* ---- los tres pasos ---- */
  /* textContent y no innerText: el rótulo y el botón van en mayúsculas por CSS,
     y innerText devuelve lo pintado («PASO 1 DE 3»), no lo escrito. */
  const rotulo = () => pg.locator('[data-sv-paso]').textContent();
  ok(/Paso 1 de 3/.test(await rotulo()), 'arranca en el paso 1 de 3');
  await tocaPlan(pg);
  await hasta(() => pg.locator('.sv-pagos').isVisible(), 'las formas de pago aparecen');
  ok(/Paso 2 de 3/.test(await rotulo()), 'con el paquete abierto, paso 2');
  ok(await pg.$eval('input[name="paquete"][data-anticipo]', i => !i.disabled),
     'el anticipo está disponible SIEMPRE: aquí no hay pregunta que lo apague');
  await pg.locator('.ped-op:has(input[data-anticipo])').click();
  await hasta(() => pg.$eval('[data-sv-datos]', e => !e.hidden), 'los datos aparecen');
  ok(/Paso 3 de 3/.test(await rotulo()), 'con la forma de pago, paso 3');
  ok((await pg.locator('[data-sv-tot]').innerText()).trim() === '$' + miles(anticipo.total),
     'la cifra grande es el anticipo');
  ok((await pg.locator('button[type="submit"]').textContent()).trim() === 'Pagar $' + miles(anticipo.total),
     'y el botón dice lo mismo');

  /* ---- EL «REGRESAR» SE VE SIEMPRE ----
     Dos salidas: el enlace de la barra fija, que es un botón con borde y no un
     texto gris, y «cambiar de paquete», que además de arriba está junto a
     «Pagar», donde acaba el dedo. Las dos nacen escondidas con el paquete
     cerrado y se encienden juntas al abrirlo. El titular lo pidió con estas
     palabras: «los que lo tenemos en la cara a veces no nos damos cuenta». */
  const volver = await pg.$eval('.barra .volver', a => {
    const c = getComputedStyle(a); return { borde: c.borderTopStyle, ancho: parseFloat(c.borderTopWidth) };
  });
  ok(volver.borde === 'solid' && volver.ancho >= 1, 'el «seguir viendo» de la barra es un botón con borde, no un texto');
  ok(await pg.locator('[data-sv-vuelta]').count() === 2, 'hay dos «cambiar de paquete»: arriba y junto a «Pagar»');
  ok(await pg.locator('[data-sv-vuelta]:visible').count() === 2, 'y con el paquete abierto se ven los dos');
  await pg.locator('.ped-botones [data-sv-cambiar]').click();
  ok(await hasta(() => pg.$$eval('[data-sv-vuelta]', vs => vs.every(v => v.hidden)), 'los dos «cambiar» se apagan'),
     'el de abajo cierra el paquete y apaga los dos');
  ok(await pg.$eval('[data-sv-datos]', e => e.hidden), 'y los datos se esconden con él');
  /* Se reabre y se vuelve a marcar el anticipo, que es lo que el envío de
     abajo necesita. */
  await tocaPlan(pg);
  await hasta(() => pg.locator('.ped-op:has(input[data-anticipo])').isVisible(), 'el paquete reabierto');
  await pg.locator('.ped-op:has(input[data-anticipo])').click();
  await hasta(() => pg.$eval('[data-sv-datos]', e => !e.hidden), 'los datos de vuelta');

  /* ---- los campos de esta familia ---- */
  for (const n of F.propios)
    ok(await pg.locator(`[name="${n}"]`).count() === 1, `pide «${n}», que es de esta familia`);
  ok(await pg.locator('[name="negocio_ciudad"], [name="ficha"]').count() === 0, 'y no la ciudad ni la ficha de Google');
  const req = await pg.$$eval('[data-sv-datos] [name]', cs => cs.filter(c => c.required).map(c => c.name));
  ok(F.obligatorios.every(n => req.includes(n)) && ['nombre', 'tel', 'correo'].every(n => req.includes(n)),
     'obligatorios: ' + req.join(', '));

  /* ---- se paga: sólo viaja el id, y los campos propios ---- */
  await pg.fill('[name="negocio"]', 'Kabuki');
  for (const [k, v] of Object.entries(F.relleno)) await pg.fill(`[name="${k}"]`, v);
  await pg.fill('[name="nombre"]', 'Gael');
  await pg.fill('[name="tel"]', '444 123 4567');
  await pg.fill('[name="correo"]', 'gael@kabuki.mx');
  await pg.locator('button[type="submit"]').click();
  await hasta(() => !!enviado, 'el POST llega al cobro');
  const q = new URLSearchParams(enviado || '');
  ok(q.get('paquete') === anticipo.id, 'viaja el id del anticipo: ' + q.get('paquete'));
  ok(!['total', 'precio', 'unit_price', 'monto', 'importe'].some(k => q.has(k)), 'y NINGÚN importe');
  ok(Object.entries(F.relleno).every(([k, v]) => q.get(k) === v), 'y los campos propios, tal cual');

  /* De vuelta al origen: la ruta interceptada es de otro origen y su
     sessionStorage es otro (ver servicio.mjs). */
  await pg.goto(BASE + '/gracias-paquete.html', { waitUntil: 'domcontentloaded' });
  const guardado = JSON.parse(await pg.evaluate(() => sessionStorage.getItem('syc_pedido')) || 'null');
  ok(guardado && guardado._fam === F.f && guardado._resto === anticipo.resto && guardado._tot === anticipo.total,
     'el pedido guardado lleva la familia, el total y el resto');
  await hasta(() => pg.locator('[data-gr-resumen]').isVisible(), 'gracias-paquete pintó su resumen');
  const pasos = await pg.$$eval('[data-gr-fam]', ps => ps.filter(p => !p.hidden).map(p => p.dataset.grFam));
  ok(pasos.length === 1 && pasos[0] === F.f, 'gracias-paquete deja UN paso, el de ' + F.f);
  ok(F.paso.test(await pg.locator(`[data-gr-fam="${F.f}"]`).innerText()), 'y es el paso correcto');
  const resumen = (await pg.locator('[data-gr-resumen]').innerText()).replace(/\s+/g, ' ');
  ok(resumen.includes('$' + miles(anticipo.resto)) && Object.values(F.relleno).every(v => resumen.includes(v)),
     'el resumen dice lo que falta y lo que se escribió');
  const wa = decodeURIComponent(await pg.locator('[data-gr-wa]').getAttribute('href'));
  ok(F.nombre.test(wa) && wa.includes('Falta por pagar: $' + miles(anticipo.resto)),
     'y el WhatsApp ya va redactado con el paquete y el resto');
  ok((await pg.locator('[data-gr-terminos]').getAttribute('href')).endsWith('#' + F.ancla),
     'los términos enlazan a su apartado');
  if (S) await pg.screenshot({ path: S + `/gracias-${F.f}.png`, fullPage: true });

  /* ---- sin JavaScript: todo a la vista y se paga igual ---- */
  const sin = await navegador.newContext({ javaScriptEnabled: false });
  const p2 = await sin.newPage();
  let enviado2 = null;
  await sin.route(COBRO, async ruta => {
    enviado2 = ruta.request().postData();
    await ruta.fulfill({ status: 200, contentType: 'text/html', body: 'ok' });
  });
  await p2.goto(BASE + '/' + F.pagina, { waitUntil: 'load' });
  ok(await p2.locator('.sv-pagos').isVisible() && await p2.locator('[data-sv-datos]').isVisible(),
     'sin JavaScript se ven las formas de pago y los datos');
  ok((await p2.locator('.sv-como-sola').innerText()).includes('de anticipo'), 'y la frase del anticipo sigue ahí');
  /* Sin script no hay rAF y el elemento «no es estable»: force, como en compra.mjs. */
  await p2.locator('.ped-op:has(input[name="paquete"]:not([data-anticipo]))').click({ force: true });
  await p2.fill('[name="negocio"]', 'Kabuki');
  for (const n of F.obligatorios) if (n !== 'negocio') await p2.fill(`[name="${n}"]`, F.relleno[n] || 'x');
  await p2.fill('[name="nombre"]', 'Gael');
  await p2.fill('[name="tel"]', '4441234567');
  await p2.fill('[name="correo"]', 'gael@kabuki.mx');
  await p2.locator('button[type="submit"]').click({ force: true });
  await hasta(() => !!enviado2, 'el POST sin JavaScript llega al cobro');
  ok(new URLSearchParams(enviado2 || '').get('paquete') === contado.id, 'sin JavaScript se paga el contado: ' + contado.id);
  await sin.close();
  await ctx.close();
}

/* ══ LA PORTADA Y LOS TÉRMINOS: EL MISMO PRECIO EN LOS TRES SITIOS ══ */
console.log('\n══ portada y términos ══');
{
  const pg = await navegador.newPage();
  vigila(pg);
  await pg.goto(BASE + '/#servicios', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(500);
  for (const F of FAMILIAS) {
    const contado = porFamilia(F.f).find(p => !p.resto);
    const cifra = (await pg.locator(`[data-svc-desde="${F.f}"]`).innerText()).replace(/\s+/g, ' ');
    ok(cifra.includes('$' + miles(contado.total)), `la tarjeta de ${F.f} anuncia ${cifra}`);
    const tarjeta = pg.locator(`.svc:has([data-svc-desde="${F.f}"])`);
    ok((await tarjeta.locator('.svc-btn').getAttribute('href')) === F.pagina, 'y su botón lleva a ' + F.pagina);
    ok(await tarjeta.locator('a[href*="wa.me"]').count() === 0, 'sin el «Solicitar» de WhatsApp: ahora se compra');
    ok(TERMINOS.includes('$' + miles(contado.total) + ' MXN') && TERMINOS.includes(`id="${F.ancla}"`),
       `los términos dicen $${miles(contado.total)} MXN bajo #${F.ancla}`);
    if (F.mensual) ok(TERMINOS.includes('$' + miles(F.mensual) + ' MXN al mes'), 'y la mensualidad del agente');
  }
  ok(!/no llevan precio publicado|se cotizan por propuesta, como se explica arriba\.\s*La/.test(TERMINOS),
     'los términos ya no dicen que estos servicios se cotizan');
  const google = (await pg.locator('[data-svc-desde="google"]').innerText()).replace(/\s+/g, ' ');
  ok(/1,490/.test(google) && /2,300/.test(google), 'y Google sigue con sus dos precios: ' + google);
  await pg.close();
}

console.log(errores.length ? '\nERRORES DE CONSOLA: ' + errores.join(' | ') : '\nsin errores de consola');
if (errores.length) fallos++;
console.log(fallos ? `\n${fallos} FALLO(S) de ${cuenta}` : `\n${cuenta} comprobaciones, todas en verde`);
await navegador.close();
process.exit(fallos ? 1 : 0);
