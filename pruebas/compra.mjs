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

  /* ---- la ficha de la portada: UNA cifra y a dónde lleva ----
     El contador de 25 cantidades vivía aquí y se fue a pedido.html, que ya
     elegía cantidad con un desplegable de 25. Lo que la portada tiene que
     seguir diciendo bien es el precio de entrada —el que decide si sigues— y
     llevar al sitio correcto. Los 25 tramos se comprueban abajo, donde ahora
     se eligen de verdad. */
  await pg.goto(BASE + '/#productos', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(400);

  ok(await pg.locator('#soluciones').count() === 1, 'la portada tiene UNA sección de soluciones');
  ok(await pg.locator('.prod-compra [data-pc="1"]').count() === 0,
     'el contador ya NO está en la portada: no hay dos sitios donde elegir cantidad');
  const desdePortada = (await pg.locator('[data-pc-total]').textContent()).trim();
  ok(await pg.locator('[data-pc-ir]').getAttribute('href') === 'pedido.html?n=1',
     'su botón lleva al pedido');

  /* ---- de la ficha al pedido ---- */
  await pg.locator('[data-pc-ir]').click();
  await pg.waitForURL('**/pedido.html?n=1');
  const tramos = JSON.parse(await pg.locator('#pc-tabla').textContent()).filas;
  ok(desdePortada === '$' + tramos[0].tot.toLocaleString('en-US'),
     'la cifra «desde» de la portada (' + desdePortada + ') es el precio de 1 placa de la tabla');

  await pg.selectOption('#ped-cant', '4');
  await pg.waitForTimeout(250);
  ok(await pg.locator('#ped-cant').inputValue() === '4', 'en el pedido se elige la cantidad');
  ok((await pg.locator('[data-ped-tot]').textContent()).trim() === '$949', 'y su importe');
  ok((await pg.locator('.tag').textContent()).includes('Paso 1 de 4'), 'arranca en el paso 1 de 4');

  /* Los 25 tramos, donde ahora se eligen. Antes se recorrían en la portada a
     base de 24 toques al «+»; aquí se comprueba lo mismo sobre el desplegable
     que de verdad decide lo que se cobra. */
  let descuadres = 0;
  for (const t of tramos) {
    await pg.selectOption('#ped-cant', String(t.n));
    await pg.waitForTimeout(25);
    const visto = (await pg.locator('[data-ped-tot]').first().textContent()).trim();
    if (visto !== '$' + t.tot.toLocaleString('en-US')) descuadres++;
  }
  ok(descuadres === 0, 'los ' + tramos.length + ' tramos enseñan el importe de la tabla en el pedido');
  await pg.selectOption('#ped-cant', '4');
  await pg.waitForTimeout(200);

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

  /* ---- EL ZOOM DEL DOBLE TOQUE, AHORA EN LAS PESTANAS ----
     El titular lo reportó desde su iPhone sobre el «+» del contador: pulsar
     rápido hacía que la página diera un salto de zoom. Dos toques seguidos
     sobre el mismo sitio son el gesto de «ampliar» del navegador.

     El contador se fue a pedido.html —que elige cantidad con un desplegable, y
     un desplegable no se pulsa dos veces seguidas—, pero la trampa no
     desapareció: se mudó. Ahora el sitio que se toca rápido son las tres
     pestañas de Soluciones, y son ellas las que tienen que llevar la misma
     protección. Estas comprobaciones son las de antes apuntando donde ahora
     está el riesgo. */
  await pg.goto(BASE + '/#soluciones', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(400);

  const ta = async sel => pg.locator(sel).first().evaluate(e => getComputedStyle(e).touchAction);
  ok(await ta('.sol-t') === 'manipulation', 'las pestañas llevan touch-action:manipulation');

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
  ok(!reglas.some(r => r.sel && /\.sol-t:hover/.test(r.sel) && !r.enMedia),
     'el :hover de la pestaña vive sólo dentro de @media (hover:hover)');
  ok(reglas.some(r => r.sel && /\.sol-t:active/.test(r.sel)),
     'y hay un :active que sustituye al resaltado de toque retirado');

  /* ---- LAS TRES PESTANAS ---- */
  const pest = pg.locator('.sol-t');
  ok(await pest.count() === 3, 'hay tres pestañas');
  const visible = async id => pg.locator('#' + id).isVisible();
  ok(await visible('servicios') && !(await visible('productos')) && !(await visible('casos')),
     'al llegar se abre Servicios y las otras dos están cerradas');

  await pest.nth(2).click();
  await pg.waitForTimeout(350);
  ok(await visible('casos') && !(await visible('servicios')),
     'al pulsar «Casos reales» cambia el contenido en el MISMO hueco');
  ok(await pg.locator('#casos .insta-g figure').count() === 3, 'y trae las tres instalaciones');
  /* Los bloques con .rv nacen en opacity 0 y los enciende un observador al
     entrar en pantalla; dentro de un panel cerrado eso no llega a pasar. Si el
     script no les pone .in al abrir, la galería se abre EN BLANCO. */
  ok(await pg.locator('#casos .insta-g img').first()
       .evaluate(e => getComputedStyle(e.closest('.insta') || e).opacity) !== '0',
     'y se ve: al abrir la pestaña se descubre lo que llevaba .rv dentro');

  /* Teclado: en un role="tablist" el tabulador salta el grupo y son las flechas
     las que se mueven dentro. Sin esto el conmutador sólo sirve con ratón. */
  await pest.nth(0).focus();
  await pg.keyboard.press('ArrowRight');
  await pg.waitForTimeout(250);
  ok(await visible('productos'), 'la flecha derecha abre la siguiente pestaña');
  ok(await pg.evaluate(() => document.activeElement.id) === 't-productos',
     'y el foco se va con ella');
  await pg.keyboard.press('End');
  await pg.waitForTimeout(250);
  ok(await visible('casos'), 'Fin salta a la última');
  await pg.keyboard.press('Home');
  await pg.waitForTimeout(250);
  ok(await visible('servicios'), 'e Inicio vuelve a la primera');
  ok(await pest.nth(0).getAttribute('aria-selected') === 'true'
     && await pest.nth(1).getAttribute('aria-selected') === 'false',
     'aria-selected sigue a la pestaña abierta');

  /* Nueve enlaces de esta página apuntan a #servicios y #productos, y los datos
     estructurados de la cabecera conocen #productos. Llegar por uno de ellos
     tiene que abrir su pestaña, no dejar al visitante en la que estaba. */
  await pg.goto(BASE + '/#productos', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(400);
  ok(await visible('productos'), 'entrar por #productos abre la pestaña del producto');

  /* El aviso del envío gratis: hoy no hay umbral que empujar porque el envío va
     dentro del precio. La tabla vive ahora en pedido.html. */
  await pg.goto(BASE + '/pedido.html');
  const conAviso = JSON.parse(await pg.locator('#pc-tabla').textContent()).filas.filter(f => f.g);
  ok(conAviso.length === 0, 'la tabla no trae ningún aviso de envío pendiente de enseñar');

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

  /* ⚠ CON EL ENVÍO DENTRO DEL PRECIO, LA ENTREGA EN MANO YA NO DESCUENTA NADA.
     Lo que cambia para quien vive en la ciudad no es el importe sino CÓMO le
     llega: en persona y con la instalación hecha, en vez de por paquetería. El
     mecanismo del descuento sigue probado, pero en las pruebas del Worker,
     donde se le puede encender un envío de mentira; aquí se comprueba lo que la
     página promete hoy. */
  const suelta = JSON.parse(await pg.locator('#pc-tabla').textContent()).filas[0];
  const precioSuelta = '$' + suelta.tot.toLocaleString('en-US');

  let e = await pideCon('79000');
  ok(e.cabecera === precioSuelta, 'con código de Ciudad Valles la cabecera dice ' + precioSuelta);
  ok(!e.aviso, 'y no aparece el aviso de entrega en mano');

  e = await pideCon(CP_LOCAL);
  ok(e.cabecera === precioSuelta, 'con código de la ciudad cuesta lo MISMO: el envío ya iba incluido');
  ok(e.aviso, 'pero sí aparece el aviso de que se entrega en persona');
  const textoAviso = (await pg.locator('[data-ped-local]').textContent()).trim();
  ok(!/\$\d/.test(textoAviso) && /instalamos|persona|mano/i.test(textoAviso),
     'y ese aviso NO promete dinero, promete la entrega: «' + textoAviso + '»');
  ok((await pg.locator('[data-ped-que]').textContent()).includes('entrega en mano'),
     'la cabecera dice «entrega en mano» en vez del texto de envío');

  await pg.locator('[data-paso="3"] [data-sigue]').click();
  const resLocal = await pg.locator('[data-ped-resumen]').innerText();
  ok(resLocal.includes(precioSuelta), 'el resumen del paso 4 dice el mismo importe');
  ok((await pg.locator('[data-ped-pagar]').textContent()).includes(precioSuelta), 'y el botón también');
  await pg.locator('[data-ped-pagar]').click();
  await pg.waitForTimeout(700);
  const cl = Object.fromEntries(new URLSearchParams(enviado || ''));
  ok(cl.cp.replace(/\D/g, '') === CP_LOCAL, 'se manda el código postal');
  ok(!('total' in cl) && !('local' in cl) && !('envio' in cl),
     'y NINGUNA bandera de «soy local» ni importe: eso lo decide el servidor');

  await pg.goto(BASE + '/gracias.html');
  const grLocal = await pg.locator('[data-gr-resumen]').innerText();
  ok(grLocal.includes(precioSuelta), 'gracias.html declara el importe que se cobró');
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

  /* SIN JAVASCRIPT LOS TRES PANELES SE VEN, uno debajo de otro. En el marcado
     no llevan `hidden`: lo pone el script. Si se invirtiera —esconder en el
     HTML y descubrir con JS— un script caído dejaría dos tercios del catálogo
     invisibles, y un buscador vería una portada que no enseña ni el producto ni
     los casos. Es el mismo suelo que pedido.html. */
  await pg.goto(BASE + '/');
  const ve = async id => pg.locator('#' + id).isVisible();
  ok(await ve('servicios') && await ve('productos') && await ve('casos'),
     'sin JS los tres paneles de Soluciones se ven a la vez');
  ok(await pg.locator('#servicios .svc').count() === 4, 'y están los cuatro servicios');
  ok(await pg.locator('#casos .insta-g figure').count() === 3, 'y las tres instalaciones');
  ok((await pg.locator('[data-pc-total]').textContent()).trim() !== '',
     'y el precio «desde» se lee: es HTML, no lo escribe ningún script');

  /* Las 25 cantidades siguen enteras donde ahora se eligen, y sin JavaScript:
     un <select> nativo funciona con el script caído. */
  await pg.goto(BASE + '/pedido.html');
  ok(await pg.locator('#ped-cant option').count() === 25,
     'sin JS, pedido.html conserva las veinticinco cantidades');

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
