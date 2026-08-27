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
  const tramos = JSON.parse(await pg.locator('#pc-tabla').textContent()).filas;
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
  await pg.fill('[name=cp]', '79000');   // Ciudad Valles: mismo estado, 250 km
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
  ok(resumen.includes('Calle Falsa 123, Centro, 79000'), 'y la dirección completa');
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

  /* ---- EL EMPUJÓN AL ENVÍO GRATIS Y EL ZOOM DEL DOBLE TOQUE ----
     Lo segundo lo reportó el titular desde su iPhone: pulsar «+» rápido para
     subir de cantidad hacía que la página diera un salto de zoom. Dos toques
     seguidos sobre el mismo sitio son el gesto de «ampliar» del navegador, y
     este botón está hecho justo para pulsarse rápido. */
  await pg.goto(BASE + '/#productos', { waitUntil: 'domcontentloaded' });
  const av = pg.locator('[data-pc-gratis]');
  const campoN = pg.locator('[data-pc-n]');

  for (const [n, ahorro] of [['1', '$79'], ['2', '$69'], ['3', '$59']]) {
    await campoN.fill(n); await campoN.blur();
    const t = (await av.textContent()).trim();
    ok(await av.isVisible() && t.includes('Lleva 4') && t.includes(ahorro),
       n + ' placa(s): avisa del envío gratis y dice que se ahorra ' + ahorro);
  }
  for (const n of ['4', '12', '25']) {
    await campoN.fill(n); await campoN.blur();
    ok(!(await av.isVisible()), n + ' placas: el aviso desaparece, que ahí ya es gratis');
  }

  const ta = async sel => pg.locator(sel).first().evaluate(e => getComputedStyle(e).touchAction);
  ok(await ta('[data-pc="1"]') === 'manipulation' && await ta('[data-pc="-1"]') === 'manipulation',
     'los botones de cantidad llevan touch-action:manipulation');
  /* En el CAMPO sería un error: mataría el doble toque para seleccionar el
     número. El zoom que hace iOS ahí es otro —el de enfocar letra pequeña— y lo
     evitan los 16 px, no touch-action. */
  ok(await ta('[data-pc-n]') === 'auto', 'el campo del número NO lo lleva');
  ok(await campoN.evaluate(e => parseFloat(getComputedStyle(e).fontSize)) >= 16,
     'y conserva sus 16 px, que es lo que evita el zoom al enfocarlo en iOS');

  /* Lo que NO se puede romper: el pellizco para ampliar. Hay gente que lo
     necesita para leer, y apagarlo incumple la WCAG 1.4.4. */
  const vp = await pg.locator('meta[name=viewport]').getAttribute('content');
  ok(!/user-scalable\s*=\s*no|maximum-scale/.test(vp), 'el zoom de la página sigue permitido');
  ok(await pg.evaluate(() => getComputedStyle(document.body).touchAction) === 'auto',
     'y el body no está bloqueado: el pellizco y el arrastre siguen intactos');

  /* Al quitar el resaltado gris de iOS hay que poner algo en su lugar, o el
     botón queda mudo al dedo; y el :hover no puede quedarse pegado tras tocar. */
  const reglas = await pg.evaluate(() => {
    const out = [];
    for (const h of document.styleSheets) {
      let rs; try { rs = h.cssRules; } catch (_) { continue; }
      for (const r of rs) {
        if (r.conditionText && /hover:\s*hover/.test(r.conditionText)) {
          for (const i of r.cssRules) out.push({ sel: i.selectorText, enMedia: true });
        } else if (r.selectorText) out.push({ sel: r.selectorText, enMedia: false });
      }
    }
    return out;
  });
  ok(!reglas.some(r => r.sel && /\.pc-b:hover/.test(r.sel) && !r.enMedia),
     'el :hover del botón vive sólo dentro de @media (hover:hover)');
  ok(reglas.some(r => r.sel && /\.pc-b:active/.test(r.sel)),
     'y hay un :active que sustituye al resaltado de toque retirado');

  await campoN.fill('1'); await campoN.blur();
  for (let i = 0; i < 5; i++) await pg.locator('[data-pc="1"]').click({ delay: 20 });
  ok((await campoN.inputValue()) === '6', 'cinco toques rápidos suben de 1 a 6, uno por toque');

  /* ---- LA ENTREGA EN MANO ----
     Es lo único de esta web donde un dato del comprador mueve el importe, así
     que se comprueba que las dos mitades —lo que la página enseña y lo que se
     le manda al Worker— no puedan discrepar. */
  await pg.goto(BASE + '/pedido.html');   // venimos de gracias.html, que no tiene la tabla
  const RANGOS = JSON.parse(await pg.locator('#pc-tabla').textContent()).local.rangos;
  ok(RANGOS.length > 0, 'hay zonas de entrega en mano configuradas');
  const CP_LOCAL = String(RANGOS[0].desde);

  async function pideCon(cp, n = '1') {
    await pg.goto(BASE + '/pedido.html?n=' + n);
    await pg.locator('.ped-op:has([value=blanco])').click();
    await pg.locator('[data-paso="1"] [data-sigue]').click();
    for (const [k, v] of Object.entries({
      nombre: 'Ana Ruiz', tel: '4423697248', correo: 'a@b.com',
      calle: 'Hidalgo 45', colonia: 'Centro', ciudad: 'SLP',
    })) await pg.fill('[name=' + k + ']', v);
    await pg.selectOption('[name=estado]', 'San Luis Potosí');
    await pg.fill('[name=cp]', cp);
    return {
      cabecera: (await pg.locator('[data-ped-tot]').textContent()).trim(),
      aviso: await pg.locator('[data-ped-local]').isVisible(),
    };
  }

  let e = await pideCon('79000');
  ok(e.cabecera === '$508', 'con código de Ciudad Valles la cabecera sigue en $508');
  ok(!e.aviso, 'y no aparece el aviso de entrega en mano');

  e = await pideCon(CP_LOCAL);
  ok(e.cabecera === '$429', 'con código de la ciudad la cabecera baja a $429');
  ok(e.aviso, 'y aparece el aviso de que no se cobra el envío');

  /* Nota: el caso del código con espacio —«78 000»— no se prueba aquí porque el
     campo lleva maxlength=5 y el navegador lo trunca antes de que llegue a
     ninguna parte. Esa tolerancia importa en el Worker, que sí puede recibir un
     POST de fuera del navegador, y allí está probada.

     Y lo que de verdad importa: que lo que se ENSEÑA y lo que se COBRA sean lo
     mismo. El Worker recalcula por su cuenta, así que basta con comprobar que
     el formulario le manda el código postal y ningún importe. */
  await pg.locator('[data-paso="3"] [data-sigue]').click();
  const resLocal = await pg.locator('[data-ped-resumen]').innerText();
  ok(resLocal.includes('$429'), 'el resumen del paso 4 dice $429, no $508');
  ok((await pg.locator('[data-ped-pagar]').textContent()).includes('$429'), 'y el botón también');
  await pg.locator('[data-ped-pagar]').click();
  await pg.waitForTimeout(700);
  const cl = Object.fromEntries(new URLSearchParams(enviado || ''));
  ok(cl.cp.replace(/\D/g, '') === CP_LOCAL, 'se manda el código postal');
  ok(!('total' in cl) && !('local' in cl) && !('envio' in cl),
     'y NINGUNA bandera de «soy local» ni importe: eso lo decide el servidor');

  /* La página de gracias tiene que declarar el importe que se cobró, no el de
     tarifa: tres cifras distintas del mismo pedido son una reclamación. */
  await pg.goto(BASE + '/gracias.html');
  const grLocal = await pg.locator('[data-gr-resumen]').innerText();
  ok(grLocal.includes('$429') && !grLocal.includes('$508'),
     'gracias.html dice $429, que es lo que se cobró');
  const waLocal = decodeURIComponent((await pg.locator('[data-gr-wa]').getAttribute('href')).split('text=')[1]);
  ok(!/\$\d/.test(waLocal), 'y el WhatsApp no declara ningún importe propio');

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
  ok(await pg.locator('.pc-nl li').count() === 25, 'y están las veinticinco cantidades');

  await pg.goto(BASE + '/pedido.html?n=10');
  ok(await pg.locator('.ped-f:visible').count() === 4, 'sin JS se ven los cuatro bloques a la vez');
  /* La cifra grande sólo la puede escribir el script. Con un valor puesto en el
     HTML, elegir «20 placas» dejaba la tipografía más grande de la página
     diciendo $508: dos precios a la vez y ganando el falso. */
  ok((await pg.locator('[data-ped-tot]').textContent()).trim() === '',
     'sin JS la cifra grande está vacía en vez de mentir');

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
