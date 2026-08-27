/* ============================================================================
   LA COMPRA, DE PUNTA A PUNTA, EN UN NAVEGADOR DE VERDAD

   Cubre el único camino de esta web por el que entra dinero: contador de la
   ficha → pedido.html → lo que se le manda al Worker → gracias.html.

       node servidor.js 8099 &
       node pruebas/compra.mjs

   Por qué en un navegador y no con node --test: casi todo lo que puede
   romperse aquí sólo existe dentro de un navegador. El fallo que motivó
   escribir esto fue un `pattern` de teléfono que Chrome compila con la bandera
   `v` y rechaza por inválido —«[0-9\s()+-]»—; el efecto era que la validación
   de ese campo DESAPARECÍA en silencio y aceptaba «hola» como teléfono. No hay
   forma de ver eso leyendo el HTML: sale en la consola del navegador, y por eso
   esta suite trata un error de consola como un fallo.

   Las pruebas del Worker (cloudflare/pagos/test) cubren la otra mitad: lo que
   pasa DESPUÉS del envío. Aquí no se habla con Mercado Pago: la petición al
   Worker se intercepta para poder mirar exactamente qué se le manda.

   LA COMPROBACIÓN QUE JUSTIFICA EL ARCHIVO es «no viaja ningún importe en el
   formulario». Todo lo demás es que el flujo funcione; ésa es la que evita que
   alguien edite el formulario y pague un peso por veinte placas.
   ========================================================================= */

import { chromium } from 'playwright';

const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const COBRO = 'https://pagos.sycsolutions.company/**';
const CHROME = process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome';

let fallos = 0, hechas = 0;
const ok = (cond, texto) => {
  hechas++;
  if (!cond) fallos++;
  console.log((cond ? '  ok   ' : '  FALLA ') + texto);
};

/* Google Fonts no se alcanza desde un entorno sin salida a internet, y el vídeo
   del hero se aborta al no llegar a verse. Ninguno de los dos es cosa nuestra. */
const RUIDO = /ERR_CONNECTION_RESET|ERR_ABORTED|fonts\.googleapis/;

function vigila(pg, errores) {
  pg.on('pageerror', e => errores.push('JS: ' + e.message));
  pg.on('console', m => {
    const t = m.text();
    if (m.type() === 'error' && !RUIDO.test(t)) errores.push('consola: ' + t);
  });
}

const navegador = await chromium.launch({ executablePath: CHROME });

/* ═══════════════════════════ CON JAVASCRIPT ══════════════════════════════ */
{
  const ctx = await navegador.newContext();
  const pg = await ctx.newPage();
  const errores = [];
  vigila(pg, errores);

  let enviado = null;
  await ctx.route(COBRO, async ruta => {
    enviado = ruta.request().postData();
    await ruta.fulfill({ status: 200, contentType: 'text/html', body: 'ok' });
  });

  /* ---- el contador de la ficha ---- */
  await pg.goto(BASE + '/#productos', { waitUntil: 'domcontentloaded' });
  const tramos = JSON.parse(await pg.locator('#pc-tabla').textContent());
  const mas = pg.locator('.prod-compra [data-pc="1"]');
  const menos = pg.locator('.prod-compra [data-pc="-1"]');

  ok(!(await pg.locator('.pc-alt').isVisible()), 'con JS, la lista larga de tramos se esconde');
  ok(await menos.isDisabled(), 'en la primera cantidad, «−» está deshabilitado');

  let descuadres = 0;
  for (let i = 0; i < tramos.length; i++) {
    const total = (await pg.locator('[data-pc-total]').textContent()).trim();
    const href = await pg.locator('[data-pc-ir]').getAttribute('href');
    if (total !== '$' + tramos[i].tot.toLocaleString('en-US')) descuadres++;
    if (href !== 'pedido.html?n=' + tramos[i].n) descuadres++;
    if (i < tramos.length - 1) await mas.click();
  }
  ok(descuadres === 0, 'los ' + tramos.length + ' tramos enseñan el importe y el enlace de la tabla');
  ok(await mas.isDisabled(), 'en la última cantidad, «+» está deshabilitado y no da la vuelta');

  /* ---- de la ficha al pedido ---- */
  for (let i = 0; i < tramos.length; i++) if (!(await menos.isDisabled())) await menos.click();
  for (let i = 0; i < 3; i++) await mas.click();                 // 1→2→3→4
  await pg.locator('[data-pc-ir]').click();
  await pg.waitForURL('**/pedido.html?n=4');

  ok(await pg.locator('#ped-cant').inputValue() === '4', 'pedido.html hereda la cantidad');
  ok((await pg.locator('[data-ped-tot]').textContent()).trim() === '$949', 'y su importe');
  ok((await pg.locator('.tag').textContent()).includes('Paso 1 de 4'), 'arranca en el paso 1 de 4');

  /* ---- validación: ningún paso se salta vacío ---- */
  await pg.locator('[data-paso="1"] [data-sigue]').click();
  await pg.locator('[data-paso="2"] [data-sigue]').click();
  ok((await pg.locator('.tag').textContent()).includes('Paso 2'),
     'sin nombre de negocio no se pasa del paso 2');

  await pg.fill('[name=negocio]', 'El Molino Ruso');
  await pg.fill('[name=negocio_ciudad]', 'San Luis Potosí');
  await pg.fill('[name=negocio_dir]', 'Av. Carranza 1200');
  await pg.locator('[data-paso="2"] [data-sigue]').click();
  await pg.locator('[data-paso="3"] [data-sigue]').click();
  ok((await pg.locator('.tag').textContent()).includes('Paso 3'), 'ni del 3 con la dirección vacía');

  /* Un teléfono corto tiene que rebotar. Con el `pattern` inválido que hubo, la
     validación de este campo desaparecía entera y esto pasaba de largo. */
  await pg.fill('[name=nombre]', 'Gael Ramírez');
  await pg.fill('[name=tel]', '442');
  await pg.fill('[name=cp]', '78000');
  await pg.fill('[name=correo]', 'gael@ejemplo.com');
  await pg.fill('[name=calle]', 'Calle Falsa 123');
  await pg.fill('[name=colonia]', 'Centro');
  await pg.fill('[name=ciudad]', 'San Luis Potosí');
  await pg.selectOption('[name=estado]', 'San Luis Potosí');
  await pg.locator('[data-paso="3"] [data-sigue]').click();
  ok((await pg.locator('.tag').textContent()).includes('Paso 3'), 'un teléfono de tres cifras no pasa');

  await pg.fill('[name=tel]', '4423697248');
  await pg.fill('[name=refs]', 'Portón verde <b>ojo</b>');
  await pg.locator('[data-paso="3"] [data-sigue]').click();
  ok((await pg.locator('.tag').textContent()).includes('Paso 4 de 4'), 'con todo puesto llega al 4');

  /* ---- el resumen ---- */
  const resumen = await pg.locator('[data-ped-resumen]').innerText();
  ok(resumen.includes('4 placas — $949'), 'el resumen dice producto e importe');
  ok(resumen.includes('Calle Falsa 123, Centro, 78000'), 'y la dirección completa');
  ok(await pg.locator('[data-ped-resumen] b').count() === 0,
     'el HTML pegado en un campo sale como TEXTO, no se ejecuta');
  ok((await pg.locator('[data-ped-pagar]').textContent()).trim() === 'Pagar $949',
     'el botón dice el importe exacto que se va a cobrar');

  /* ---- lo que se le manda al Worker ---- */
  await pg.locator('[data-ped-pagar]').click();
  await pg.waitForTimeout(700);
  const campos = Object.fromEntries(new URLSearchParams(enviado || ''));
  ok(campos.paquete === '4', 'se manda paquete=4');
  ok(campos.negocio === 'El Molino Ruso' && campos.calle === 'Calle Falsa 123',
     'con los datos del pedido');
  const importes = ['total', 'precio', 'monto', 'importe', 'unit_price', 'transaction_amount']
    .filter(k => k in campos);
  ok(importes.length === 0,
     'NO viaja ningún importe en el formulario' + (importes.length ? ' — viajan: ' + importes : ''));

  /* ---- la vuelta ---- */
  await pg.goto(BASE + '/gracias.html');     // es a donde redirige el Worker
  const gr = await pg.locator('[data-gr-resumen]').innerText();
  ok(gr.includes('El Molino Ruso') && gr.includes('$949'), 'gracias.html recupera el pedido');
  const wa = decodeURIComponent((await pg.locator('[data-gr-wa]').getAttribute('href')).split('text=')[1]);
  ok(wa.includes('Calle Falsa 123') && wa.includes('4423697248'),
     'y arma el WhatsApp con el pedido escrito');

  /* Un pago en efectivo vuelve SIN estar cobrado. Decir «gracias por tu compra»
     ahí es la forma de que nadie llegue a pagarlo. */
  await pg.goto(BASE + '/gracias.html?estado=pendiente');
  ok((await pg.locator('[data-gr-t]').innerText()).toLowerCase().includes('pendiente'),
     'con ?estado=pendiente la página NO da el pago por hecho');

  /* ---- «en blanco» salta el paso del negocio ---- */
  await pg.goto(BASE + '/pedido.html?n=10');
  await pg.locator('.ped-op:has([value=blanco])').click();
  ok((await pg.locator('.tag').textContent()).includes('Paso 1 de 3'), '«en blanco» deja 3 pasos');
  await pg.locator('[data-paso="1"] [data-sigue]').click();
  ok(await pg.locator('[data-paso="2"]').isHidden(), 'el bloque del negocio queda escondido');
  ok(await pg.locator('[name=negocio]').evaluate(e => !e.required),
     'y su campo deja de ser obligatorio: si no, el envío se bloquearía sin decir dónde');

  /* ---- una cantidad inventada en la dirección no rompe nada ---- */
  await pg.goto(BASE + '/pedido.html?n=999');
  ok(await pg.locator('#ped-cant').inputValue() === '1', '?n=999 cae a la primera cantidad');
  await pg.goto(BASE + '/pedido.html');
  ok(await pg.locator('#ped-cant').inputValue() === '1', 'sin ?n también');

  ok(errores.length === 0, 'ni un error de JavaScript o de consola' +
     (errores.length ? ':\n      ' + errores.join('\n      ') : ''));
  await ctx.close();
}

/* ═════════════════════════ SIN JAVASCRIPT ════════════════════════════════
   No es un lujo de accesibilidad: es el suelo del que cuelga todo lo demás.
   Si un script falla al cargar, la web tiene que seguir vendiendo. */
{
  const ctx = await navegador.newContext({ javaScriptEnabled: false });
  const pg = await ctx.newPage();
  let enviado = null;
  await ctx.route(COBRO, async ruta => {
    enviado = ruta.request().postData();
    await ruta.fulfill({ status: 200, contentType: 'text/html', body: 'ok' });
  });

  await pg.goto(BASE + '/');
  ok(await pg.locator('.pc-alt').isVisible(), 'sin JS, la lista de tramos SÍ se ve');
  ok(await pg.locator('.pc-nl li').count() === 11, 'y están los once');

  await pg.goto(BASE + '/pedido.html?n=10');
  ok(await pg.locator('.ped-f:visible').count() === 4, 'sin JS se ven los cuatro bloques a la vez');

  await pg.selectOption('#ped-cant', '10');
  for (const [k, v] of Object.entries({
    negocio: 'Bar Central', negocio_ciudad: 'SLP', nombre: 'Ana Ruiz', tel: '4423697248',
    cp: '78000', correo: 'ana@ejemplo.com', calle: 'Hidalgo 45', colonia: 'Centro', ciudad: 'SLP',
  })) await pg.fill('[name=' + k + ']', v);
  await pg.selectOption('[name=estado]', 'San Luis Potosí');
  await pg.locator('[data-ped-pagar]').click();
  await pg.waitForTimeout(700);

  const campos = Object.fromEntries(new URLSearchParams(enviado || ''));
  ok(campos.paquete === '10', 'se envía la cantidad elegida en el desplegable');
  ok(campos.negocio === 'Bar Central' && campos.calle === 'Hidalgo 45', 'con todos los datos');
  ok(!('total' in campos) && !('precio' in campos), 'y tampoco viaja ningún importe');
  await ctx.close();
}

await navegador.close();
console.log('\n' + (fallos ? fallos + ' de ' + hechas + ' comprobaciones FALLAN' : hechas + ' comprobaciones, todas en verde'));
process.exit(fallos ? 1 : 0);
