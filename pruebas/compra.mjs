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

  /* ---- EL CONTADOR, EN LA PORTADA ----
     La cantidad se elige DONDE se ve el producto, que es donde nace la
     pregunta —cuánto me cuestan las que yo quiero— y no un toque después. */
  const menos = pg.locator('.prod-compra [data-pc="-1"]');
  const mas   = pg.locator('.prod-compra [data-pc="1"]');
  ok(await menos.isVisible() && await mas.isVisible(),
     'la ficha del producto tiene su «−» y su «+»');
  /* ⚠ LOS DOS PRECIOS DEL PERFIL DE GOOGLE, no un «desde». Enseñar sólo el
     barato escondía la mitad del catálogo justo donde se decide si entrar. */
  /* Por familia: desde que las cuatro tarjetas llevan precio hay cuatro de
     estos, y el de Google es el único que enseña dos cifras. */
  const dosPrecios = (await pg.locator('[data-svc-desde="google"]').innerText()).replace(/\s+/g, ' ');
  ok(/\$1,490/.test(dosPrecios) && /\$2,300/.test(dosPrecios),
     'la tarjeta del perfil de Google enseña los DOS precios: ' + dosPrecios);
  ok(!/desde/i.test(dosPrecios), 'y ya no dice «desde», que escondía el de arriba');

  const desdePortada = (await pg.locator('[data-pc-total]').textContent()).trim();
  ok(await pg.locator('[data-pc-ir]').getAttribute('href') === 'pedido.html?n=1',
     'su botón lleva al pedido');

  /* Espera acotada que NO revienta: así un contador roto se pone en rojo con
     el nombre de su comprobación en vez de tumbar la suite con un volcado. */
  const cuando = (fn, ms = 4000) => pg.waitForFunction(fn, null, { timeout: ms })
    .then(() => true).catch(() => false);
  const leeN = () => pg.$eval('[data-pc-n]', i => i.value);

  await mas.click(); await mas.click();
  ok(await cuando(() => document.querySelector('[data-pc-n]').value === '3'),
     'el «+» sube de uno en uno: ' + await leeN());
  ok((await pg.locator('[data-pc-total]').textContent()).trim() === '$799',
     'y el importe le sigue');
  ok((await pg.locator('[data-pc-w]').textContent()).trim() === 'placas',
     'y la palabra concuerda en plural');
  /* La cantidad elegida VIAJA al pedido. Sin esto habría que elegirla dos
     veces, que es justo lo que separó estas dos pantallas en su día. */
  ok(await pg.locator('[data-pc-ir]').getAttribute('href') === 'pedido.html?n=3',
     'y el botón se lleva la cantidad elegida al pedido');

  await menos.click(); await menos.click();
  ok(await cuando(() => document.querySelector('[data-pc-n]').value === '1'),
     'y el «−» baja');
  /* En los extremos se apagan y NO dan la vuelta: un contador que salta de 25
     a 1 al pulsar «más» parece roto, y en un móvil se pulsa sin mirar. */
  ok(await menos.isDisabled(), 'en 1 el «−» se apaga');
  await pg.fill('[data-pc-n]', '25');
  await pg.locator('[data-pc-n]').blur();
  ok(await cuando(() => document.querySelector('[data-pc="1"]').disabled),
     'y en 25 el «+»');
  /* Y por encima del tope hay salida, que si no el botón apagado no dice por qué. */
  ok(await pg.locator('.pc-mas a').isVisible(), 'con un enlace para pedir más de 25');
  await pg.fill('[data-pc-n]', '1');
  await pg.locator('[data-pc-n]').blur();
  await cuando(() => document.querySelector('[data-pc-n]').value === '1');

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

  /* La vista explotada del producto vive plegada bajo el encabezado: existe,
     no ocupa nada hasta que se toca, y al abrirla enseña la foto de las capas. */
  const capas = pg.locator('.ped-capas');
  ok(await capas.count() === 1 && !(await capas.evaluate(d => d.open)),
     'la vista explotada está en el pedido y arranca plegada');
  await capas.locator('summary').click();
  await pg.waitForTimeout(150);
  ok(await capas.locator('img[src*="producto-capas"]').isVisible(),
     'y al abrirla se ve la foto de las capas');
  await capas.locator('summary').click();
  await pg.waitForTimeout(100);

  /* El «−» y el «+» NO están aquí: viven en la ficha del producto, que es
     donde se ve lo que se compra. A esta pantalla se llega con la cantidad ya
     puesta en `?n=` y el desplegable es para corregirla, no para recorrerla de
     uno en uno. */
  ok(await pg.locator('[data-cant]').count() === 0,
     'el checkout NO repite el contador: la cantidad se elige en la ficha');

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
  /* El producto va PRIMERO: es lo que se vende de una pieza, y quien entra
     por la portada lo ve sin tocar nada. */
  ok(await visible('productos') && !(await visible('servicios')) && !(await visible('clientes')),
     'al llegar se abre El producto y las otras dos están cerradas');

  await pest.nth(2).click();
  await pg.waitForTimeout(350);
  ok(await visible('clientes') && !(await visible('productos')),
     'al pulsar «Clientes» cambia el contenido en el MISMO hueco');
  ok(await pg.locator('#clientes .insta-g figure').count() === 3, 'y trae las tres instalaciones');
  /* Los bloques con .rv nacen en opacity 0 y los enciende un observador al
     entrar en pantalla; dentro de un panel cerrado eso no llega a pasar. Si el
     script no les pone .in al abrir, la galería se abre EN BLANCO. */
  ok(await pg.locator('#clientes .insta-g img').first()
       .evaluate(e => getComputedStyle(e.closest('.insta') || e).opacity) !== '0',
     'y se ve: al abrir la pestaña se descubre lo que llevaba .rv dentro');

  /* Teclado: en un role="tablist" el tabulador salta el grupo y son las flechas
     las que se mueven dentro. Sin esto el conmutador sólo sirve con ratón. */
  await pest.nth(0).focus();
  await pg.keyboard.press('ArrowRight');
  await pg.waitForTimeout(250);
  ok(await visible('servicios'), 'la flecha derecha abre la siguiente pestaña');
  ok(await pg.evaluate(() => document.activeElement.id) === 't-servicios',
     'y el foco se va con ella');
  await pg.keyboard.press('End');
  await pg.waitForTimeout(250);
  ok(await visible('clientes'), 'Fin salta a la última');
  await pg.keyboard.press('Home');
  await pg.waitForTimeout(250);
  ok(await visible('productos'), 'e Inicio vuelve a la primera');
  ok(await pest.nth(0).getAttribute('aria-selected') === 'true'
     && await pest.nth(1).getAttribute('aria-selected') === 'false',
     'aria-selected sigue a la pestaña abierta');

  /* ---- EL FONDO QUE CAMBIA AL BAJAR ----
     Cuatro fotos fijas detrás de la página que se relevan al desplazarse. Cada
     una se ancla a una sección y el relevo se calcula con la posición de ese
     ancla.

     LA QUE JUSTIFICA ESTAS LÍNEAS: el ancla tiene que MEDIR ALGO. Estuvo
     apuntando a `#servicios`, que era una sección propia hasta que Servicios y
     Productos se fusionaron en Soluciones; desde entonces es un panel de
     pestaña que nace escondido, y `getBoundingClientRect()` sobre algo con
     `display:none` devuelve ceros. Esa escena creía vivir en el píxel 0 con
     altura 0 y el fundido se calculaba sobre basura: era el salto raro entre
     las dos primeras fotos. */
  await pg.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(900);
  const escenas = await pg.$$eval('#descenso .esc', es => es.map(e => {
    const sel = e.dataset.ancla, a = document.querySelector(sel);
    const r = a && a.getBoundingClientRect();
    return { sel, alto: r ? Math.round(r.height) : 0 };
  }));
  ok(escenas.length >= 2, 'hay varias escenas de fondo');
  const ciegas = escenas.filter(e => e.alto === 0).map(e => e.sel);
  ok(ciegas.length === 0,
     'cada escena se ancla a algo que mide' + (ciegas.length ? ': CIEGA(S) ' + ciegas.join(', ') : ''));
  for (const e of escenas) console.log(`      ${e.sel.padEnd(14)} alto ${e.alto}`);

  /* Y el relevo tiene que ser de ida: cada foto entra una vez y se va una vez.
     Con un ancla rota la misma escena iba y volvía, que es lo que se ve como
     un parpadeo al subir y bajar.
     ⚠ El salto tiene que ser INSTANTÁNEO. La página lleva scroll-behavior
     suave, y midiendo a mitad de la animación salen valores de un punto que no
     es el que se pidió — eso me dio un diagnóstico falso una vez. */
  const curva = [];
  for (let y = 0; y <= 3200; y += 200) {
    await pg.evaluate(v => { document.documentElement.style.scrollBehavior = 'auto'; scrollTo(0, v); }, y);
    await pg.waitForTimeout(90);
    curva.push(await pg.$$eval('#descenso .esc', es => es.map(e => +getComputedStyle(e).opacity)));
  }
  await pg.evaluate(() => { scrollTo(0, 0); document.documentElement.style.scrollBehavior = ''; });
  let idasYvueltas = 0;
  for (let c = 0; c < escenas.length; c++) {
    const col = curva.map(f => f[c]);
    for (let i = 2; i < col.length; i++)
      if (col[i-1] - col[i-2] > 0.06 && col[i] - col[i-1] < -0.06) idasYvueltas++;
  }
  ok(idasYvueltas === 0,
     'cada foto de fondo entra y sale UNA vez, sin ir y volver' +
     (idasYvueltas ? ` (${idasYvueltas} vaivén/vaivenes)` : ''));
  /* Y que el relevo llegue a ocurrir: con el ancla rota la segunda foto no
     pasaba del 12% en toda la página. */
  const maxSegunda = Math.max(...curva.map(f => f[1]));
  ok(maxSegunda > 0.9, `la segunda foto llega a verse entera (llega a ${maxSegunda.toFixed(2)})`);

  /* ---- EL MENU DE SECCIONES ----
     Hasta ahora, en un telefono esta pagina no tenia NINGUNA navegacion: la
     lista de la barra se esconde por debajo de 1080 px y el riel del recorrido
     por debajo de 920. La unica forma de llegar a una seccion era el dedo. */
  const m = await ctx.newPage();
  vigila(m, errores);
  await m.setViewportSize({ width: 390, height: 844 });
  await m.goto(BASE + '/', { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(500);

  const boton = m.locator('#men-b'), panel = m.locator('#menu');
  ok(await boton.isVisible(), 'en móvil hay un botón de menú');
  ok(!(await panel.isVisible()), 'y el panel nace cerrado');
  ok(await boton.getAttribute('aria-expanded') === 'false', 'que es lo que dice aria-expanded');

  const caja = await boton.boundingBox();
  ok(caja.width >= 40 && caja.height >= 40,
     `el botón mide ${Math.round(caja.width)}×${Math.round(caja.height)}: se puede dar con el pulgar`);

  await boton.click();
  await m.waitForTimeout(350);
  ok(await panel.isVisible(), 'al pulsarlo se abre');
  ok(await boton.getAttribute('aria-expanded') === 'true', 'y lo anuncia');

  /* Cada destino dice QUE HAY detrás, en las palabras de quien pregunta por
     teléfono. Un menú que sólo dice «Diagnóstico» no lo entiende quien viene
     a comprar una placa. */
  const destinos = await m.$$eval('#menu .men-l', as => as.map(a => ({
    href: a.getAttribute('href'),
    titulo: a.childNodes[1].textContent.trim(),
    pie: (a.querySelector('small') || {}).textContent || '' })));
  ok(destinos.length === 6, 'lleva los seis destinos de la página');

  /* ⚠ INICIO EL PRIMERO. Faltaba: desde el menú no había forma de volver
     arriba, y «arriba» es la portada con la foto grande — lo único que alguien
     reconoce cuando se ha perdido dentro de una página larga. El logotipo ya
     llevaba ahí, pero un logotipo no se lee como un botón de volver. */
  ok(destinos[0].href === '#top' && /inicio/i.test(destinos[0].titulo),
     'y el primero es Inicio, que lleva a la portada');

  /* ⚠ EL ESQUEMA DE PREGUNTAS DICE LO MISMO QUE LA PÁGINA. La cabecera lleva
     un FAQPage con las seis preguntas y sus respuestas, y es lo que Google
     puede enseñar en su resultado. Si alguien reescribe una respuesta visible
     y no toca el JSON —o al revés— el buscador anuncia algo que la página ya
     no dice, y desde dentro se ve todo bien. Se comparan las preguntas una a
     una, en orden. */
  const faq = await m.evaluate(() => {
    const d = JSON.parse(document.querySelector('script[type="application/ld+json"]').textContent);
    const pag = (d['@graph'] || []).find(x => x['@type'] === 'FAQPage');
    return { esquema: (pag ? pag.mainEntity : []).map(q => q.name),
             visibles: [...document.querySelectorAll('#faq summary')].map(x => x.textContent.trim()) };
  });
  ok(faq.visibles.length >= 4, 'la página lleva sus preguntas frecuentes (' + faq.visibles.length + ')');
  ok(faq.esquema.join('|') === faq.visibles.join('|'),
     'y el esquema de la cabecera dice exactamente las mismas, en el mismo orden');

  /* ⚠ NINGÚN ENLACE INTERNO APUNTA AL VACÍO. Al retirar una sección quedan
     enlaces huérfanos en el menú, el riel, la barra y el pie: se pulsan, no
     pasa nada y desde dentro no se nota, porque un ancla que no existe no da
     ningún error. Se comprueban TODOS los «#…» de la página de una vez. */
  const rotos = await m.$$eval('a[href^="#"]', as => as
    .map(a => a.getAttribute('href'))
    .filter(h => h.length > 1 && !document.getElementById(h.slice(1))));
  ok(rotos.length === 0, 'ningún enlace interno apunta a una sección que no existe' +
     (rotos.length ? ': ' + [...new Set(rotos)].join(', ') : ''));

  /* ⚠ LLEGAR DESDE EL MENÚ NO PUEDE PINTAR UN RECUADRO. Los paneles llevaban
     `tabindex="0"`, así que al navegar a «#servicios» el navegador enfocaba el
     panel y `:focus-visible` dibujaba un marco dorado de lado a lado alrededor
     de medio catálogo, que no se iba hasta que algo más tomaba el foco.
     Parecía un fallo de pintado porque lo parecía. */
  ok(await m.$$eval('.sol-panel', ps => ps.every(p => !p.hasAttribute('tabindex'))),
     'los paneles no son enfocables: si no, el ancla del menú les da el foco');
  await m.goto(BASE + '/#servicios', { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(900);
  const marco = await m.evaluate(() => {
    const p = document.querySelector('.sol-panel:not([hidden])');
    return { activo: document.activeElement === p, contorno: getComputedStyle(p).outlineStyle };
  });
  ok(!marco.activo && marco.contorno === 'none',
     'y al llegar desde el menú NO se pinta ningún recuadro alrededor del panel');
  ok(await m.locator('#top').count() === 1, 'y ese destino existe de verdad en la página');
  ok(await m.locator('#top .hero-bg').count() === 1,
     'y es la portada con su foto de fondo, no un ancla suelta');
  ok(destinos.every(d => d.pie.trim().length > 12), 'y cada uno explica qué hay detrás');
  for (const d of destinos) console.log(`      ${d.href.padEnd(14)} ${d.titulo} — ${d.pie.trim()}`);
  ok(!destinos.some(d => /diagn[óo]stico|auditar|auditad/i.test(d.titulo + d.pie)),
     'sin jerga: no dice «diagnóstico» ni «auditar» en ningún destino');

  /* Los cuatro servicios, cada uno al suyo. */
  const svcs = await m.$$eval('#menu .men-s a', as => as.map(a => a.getAttribute('href')));
  ok(svcs.length === 4, 'y los cuatro servicios por separado');
  const perdidos = [];
  for (const h of svcs) if (!(await m.locator(h).count())) perdidos.push(h);
  ok(perdidos.length === 0, 'los cuatro tienen destino' + (perdidos.length ? ': ROTOS ' + perdidos : ''));

  /* Escape cierra y devuelve el foco: sin eso quien navega con teclado cierra
     el menú y su foco se queda dentro de un panel invisible. */
  await m.keyboard.press('Escape');
  await m.waitForTimeout(300);
  ok(!(await panel.isVisible()), 'Escape lo cierra');
  ok(await m.evaluate(() => document.activeElement.id) === 'men-b', 'y el foco vuelve al botón');

  /* LA QUE JUSTIFICA EL MENU: elegir un servicio lleva a ESE servicio.
     En móvil las fichas son una baraja que se arrastra de lado, así que abrir
     la pestaña no basta: si no se centra la elegida, se queda fuera de la
     pantalla a la derecha y el menú habría mentido. */
  await boton.click();
  await m.waitForTimeout(300);
  await m.locator('#menu .men-s a[href="#svc-atencion"]').click();
  await m.waitForTimeout(1200);
  ok(!(await panel.isVisible()), 'al elegir un destino el menú se aparta');
  ok(await m.locator('#servicios').isVisible(), 'y abre la pestaña donde vive ese servicio');
  const dentro = await m.locator('#svc-atencion').evaluate(e => {
    const r = e.getBoundingClientRect();
    return r.left > -40 && r.right < innerWidth + 40;
  });
  ok(dentro, 'con la ficha pedida centrada en la baraja, no fuera de pantalla');

  /* Y saltar a una sección tiene que dejar el conmutador a la vista: si el
     navegador para dentro del panel, se aterriza en medio del contenido sin
     ver que hay otras dos pestañas. */
  await m.goto(BASE + '/#clientes', { waitUntil: 'domcontentloaded' });
  await m.waitForTimeout(900);
  const tabsVisibles = await m.locator('.sol-tabs').evaluate(e => {
    const r = e.getBoundingClientRect();
    return r.top >= 70 && r.bottom <= innerHeight;
  });
  ok(tabsVisibles, 'al saltar a #clientes el conmutador queda a la vista, no tapado por la barra');
  await m.close();

  /* Nueve enlaces de esta página apuntan a #servicios y #productos, y los datos
     estructurados de la cabecera conocen #productos. Llegar por uno de ellos
     tiene que abrir su pestaña, no dejar al visitante en la que estaba. */
  await pg.goto(BASE + '/#productos', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(400);
  ok(await visible('productos'), 'entrar por #productos abre la pestaña del producto');

  /* ---- EL EMPUJÓN AL ENVÍO GRATIS ----
     Vuelve a haber umbral: la placa suelta paga envío y de dos en adelante no.
     El aviso tiene que salir EXACTAMENTE en las filas que lo pagan: en una que
     no lo paga estaría ofreciendo un ahorro que esa persona ya tiene, y faltar
     en una que sí lo paga se calla el único empujón que sube la cantidad. */
  const FILAS = JSON.parse(await pg.locator('#pc-tabla').textContent()).filas;
  const conAviso = FILAS.filter(f => f.g);
  const pagan = FILAS.filter(f => f.e > 0);
  ok(conAviso.length === pagan.length && conAviso.every(f => f.e > 0),
     'el empujón sale en las ' + pagan.length + ' filas que pagan envío y en ninguna más');
  for (const f of conAviso)
    ok(f.g.includes('$' + f.e),
       'y dice la cifra que se ahorra (' + f.n + ': «' + f.g + '»)');
  /* Y el desglose de esas filas CUADRA: la cifra grande es la suma de las dos
     chicas. Es la resta que el comprador hace de cabeza, y si no sale, la web
     parece que redondea a su favor. */
  for (const f of pagan)
    ok(f.d.includes('$' + (f.tot - f.e).toLocaleString('en-US')) && f.d.includes('$' + f.e),
       'y el desglose de ' + f.n + ' enseña de dónde sale el total: «' + f.d + '» = $' + f.tot);

  /* En la ficha se ve de verdad: con una placa el empujón está a la vista y con
     dos desaparece, porque ahí arriba ya dice «Envío gratis» y repetirlo es
     ruido. Sin esto la fila podría traer el texto y no enseñarlo nunca. */
  const emp = pg.locator('[data-pc-gratis]');
  ok(await emp.isVisible() && (await emp.textContent()).includes('$' + FILAS[0].e),
     'en la ficha, con 1 placa el empujón se ve y dice los $' + FILAS[0].e);
  await pg.locator('[data-pc="1"]').click();
  ok(await cuando(() => document.querySelector('[data-pc-gratis]').hidden),
     'y con 2 placas desaparece solo');

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

  /* ⚠ LA ENTREGA EN MANO VUELVE A MOVER EL IMPORTE, y sólo en la placa suelta:
     es la única cantidad que paga envío. Quien vive aquí no paga paquetería
     porque la llevamos nosotros, así que la cifra baja de $578 a $399 en
     cuanto teclea su código postal. De dos en adelante el envío ya era gratis
     para todo México y no hay nada que descontar: ahí lo que cambia no es el
     importe sino CÓMO le llega —en persona y con la instalación hecha—.

     Las dos mitades tienen que decir lo mismo: lo que la página enseña y lo
     que cobra el Worker con esta misma lista de rangos. Si discreparan, la web
     diría un precio y el cobro sería otro, que es el fallo que todo este
     montaje existe para impedir. */
  const suelta = JSON.parse(await pg.locator('#pc-tabla').textContent()).filas[0];
  const pesos = n => '$' + n.toLocaleString('en-US');
  const precioSuelta = pesos(suelta.tot);         // por paquetería: lleva el envío
  const precioEnMano = pesos(suelta.tot - suelta.e);   // en mano: sin él

  let e = await pideCon('79000');
  ok(e.cabecera === precioSuelta, 'con código de Ciudad Valles la cabecera dice ' + precioSuelta);
  ok(!e.aviso, 'y no aparece el aviso de entrega en mano');

  e = await pideCon(CP_LOCAL);
  ok(e.cabecera === precioEnMano,
     'con código de la ciudad baja a ' + precioEnMano + ': el envío deja de cobrarse');
  ok(e.aviso, 'y aparece el aviso de que se entrega en persona');
  const textoAviso = (await pg.locator('[data-ped-local]').textContent()).trim();
  ok(textoAviso.includes(pesos(suelta.e)) && /instalamos|persona|mano/i.test(textoAviso),
     'ese aviso dice las dos cosas —la entrega y el ahorro—: «' + textoAviso + '»');
  ok(await pg.locator('[data-ped-gratis]').isHidden(),
     'y el empujón de «lleva 2 y no pagas envío» se calla: aquí ya no lo paga');
  ok((await pg.locator('[data-ped-que]').textContent()).includes('entrega en mano'),
     'la cabecera dice «entrega en mano» en vez del texto de envío');

  /* Con dos placas el envío ya era gratis, así que el código postal de casa no
     puede mover el importe: si lo moviera, estaríamos descontando dos veces el
     mismo envío. */
  const dos = JSON.parse(await pg.locator('#pc-tabla').textContent()).filas[1];
  const e2 = await pideCon(CP_LOCAL, '2');
  ok(e2.cabecera === pesos(dos.tot),
     'con dos placas el mismo código postal NO descuenta nada: ' + pesos(dos.tot));
  ok(e2.aviso, 'pero el aviso de la entrega en persona sigue saliendo');
  ok(!/\$\d/.test((await pg.locator('[data-ped-local]').textContent()).trim()),
     'y ahí el aviso no promete ningún ahorro, porque no lo hay');

  e = await pideCon(CP_LOCAL);
  await pg.locator('[data-paso="3"] [data-sigue]').click();
  const resLocal = await pg.locator('[data-ped-resumen]').innerText();
  ok(resLocal.includes(precioEnMano), 'el resumen del paso 4 dice el mismo importe');
  ok((await pg.locator('[data-ped-pagar]').textContent()).includes(precioEnMano), 'y el botón también');
  await pg.locator('[data-ped-pagar]').click();
  await pg.waitForTimeout(700);
  const cl = Object.fromEntries(new URLSearchParams(enviado || ''));
  ok(cl.cp.replace(/\D/g, '') === CP_LOCAL, 'se manda el código postal');
  ok(!('total' in cl) && !('local' in cl) && !('envio' in cl),
     'y NINGUNA bandera de «soy local» ni importe: eso lo decide el servidor');

  await pg.goto(BASE + '/gracias.html');
  const grLocal = await pg.locator('[data-gr-resumen]').innerText();
  ok(grLocal.includes(precioEnMano), 'gracias.html declara el importe que se cobró');
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

  /* ---- EL CÓDIGO POSTAL RELLENA LO QUE SABE ----
     Tres campos seguidos de texto libre —código postal, colonia y ciudad— en
     un móvil y justo antes de pagar es de donde salían «lomas 4a», «Lomas
     cuarta seccion» y «Lomas 4ta Secc.» para la misma calle. Una dirección mal
     escrita no es un dato feo: es un paquete que vuelve.

     Lo que se comprueba aquí no es que la lista exista, sino las tres reglas
     que la hacen inofensiva: que sugiera y no obligue, que no pise lo que
     escribió una persona, y que la página siga vendiendo si el catálogo no
     llega. */
  await pg.goto(BASE + '/pedido.html?n=1');
  await pg.locator('.ped-op:has([value=blanco])').click();
  await pg.locator('[data-paso="1"] [data-sigue]').click();

  await pg.fill('[name=cp]', '78216');
  await pg.waitForFunction(() => document.querySelector('#mx-colonias').options.length > 0,
                           null, { timeout: 8000 });
  const colonias = await pg.$$eval('#mx-colonias option', o => o.map(x => x.value));
  ok(colonias.length === 3 && colonias.includes('Lomas Cuarta Sección'),
     'el 78216 despliega sus colonias: ' + colonias.join(' · '));
  /* ⚠ Y EL CAMPO TIENE QUE ESTAR ENCHUFADO A ESA LISTA. Sin esta comprobación,
     quitar el `list=` del marcado dejaba la lista llenándose en un rincón del
     documento sin que ningún campo la usara —la función muerta y la suite en
     verde—. Se probó quitándolo: pasaban las 119. */
  ok(await pg.locator('[name=colonia]').evaluate(e => !!e.list && e.list.id === 'mx-colonias'),
     'y el campo de la colonia está enchufado a ella');
  ok(await pg.locator('[name=ciudad]').evaluate(e => !!e.list && e.list.id === 'mx-ciudades'),
     'el de la ciudad, a la de las ciudades');
  ok(await pg.locator('[name=negocio_ciudad]').evaluate(e => !!e.list && e.list.id === 'mx-ciudades'),
     'y el de la ciudad del negocio, a la misma');
  ok(await pg.locator('[name=estado]').inputValue() === 'San Luis Potosí',
     'y el estado se rellena solo');
  ok(await pg.locator('[name=ciudad]').inputValue() === 'San Luis Potosí', 'y la ciudad también');
  ok(/78216/.test(await pg.locator('[data-mx-pista]').textContent()),
     'con una pista que dice de dónde salen: «' +
     (await pg.locator('[data-mx-pista]').textContent()).trim() + '»');

  /* ⚠ EL CAMPO SIGUE SIENDO DE TEXTO. Un fraccionamiento nuevo que SEPOMEX aún
     no tiene no puede impedir una compra: la lista sugiere, no encierra. */
  await pg.fill('[name=colonia]', 'Fraccionamiento que no existe');
  ok(await pg.locator('[name=colonia]').inputValue() === 'Fraccionamiento que no existe',
     'y aun así se puede escribir una colonia que no está en la lista');

  /* ⚠ LO ESCRITO A MANO MANDA. Corregir la ciudad y ver cómo se vuelve a
     cambiar sola es de las cosas que hacen abandonar un formulario. */
  await pg.fill('[name=ciudad]', 'Villa de Reyes');
  await pg.fill('[name=cp]', '64000');
  await pg.waitForFunction(() => document.querySelector('[name=estado]').value === 'Nuevo León',
                           null, { timeout: 8000 });
  ok(await pg.locator('[name=ciudad]').inputValue() === 'Villa de Reyes',
     'lo que escribió una persona NO se pisa al cambiar el código postal');
  ok(await pg.locator('[name=estado]').inputValue() === 'Nuevo León',
     'pero lo que rellenamos nosotros sí se corrige');

  /* ⚠ EL NOMBRE DEL ESTADO TIENE QUE SER EL DEL DESPLEGABLE. El catálogo
     oficial dice «Coahuila de Zaragoza» y el formulario sólo tiene
     «Coahuila»: un valor que no existe entre las opciones deja el desplegable
     VACÍO sin avisar de nada. */
  await pg.evaluate(() => {
    const e = document.querySelector('[name=estado]');
    e.value = ''; delete e.dataset.mx;
  });
  await pg.fill('[name=cp]', '27000');
  await pg.waitForFunction(() => document.querySelector('[name=estado]').value !== '',
                           null, { timeout: 8000 });
  ok(await pg.locator('[name=estado]').inputValue() === 'Coahuila',
     '«Coahuila de Zaragoza» llega como «Coahuila», que es lo que ofrece el desplegable');

  /* Un código que no está en el catálogo no puede dejar la pantalla muda ni
     bloquear nada: se dice y se sigue a mano. */
  await pg.fill('[name=cp]', '78999');
  await pg.waitForFunction(() => /a mano/.test(document.querySelector('[data-mx-pista]').textContent),
                           null, { timeout: 8000 });
  ok(await pg.locator('[name=colonia]').isEditable(),
     'un código postal desconocido lo dice y deja seguir a mano');

  /* ⚠⚠ EL TOPE DE OCHO, QUE ES EL ARREGLO DE UN BLOQUEO Y NO UNA FINURA.
     La primera versión metía las 2.528 ciudades de golpe dentro del
     «datalist» —y hasta 287 colonias en el código postal más poblado—. En un
     iPhone eso CONGELA la página: la tira de sugerencias no la dibuja esta
     web, la dibuja Safari, y con miles de elementos se queda trabada con el
     teclado abierto y sin salida. Lo encontró el dueño usando su propia web
     desde el móvil, que es donde compra su cliente.

     Así que lo que se comprueba no es que la lista exista: es que NUNCA haya
     más de ocho opciones en el documento, se escriba lo que se escriba. */
  const opciones = id => pg.$$eval('#' + id + ' option', o => o.map(x => x.value));

  const cpMasPoblado = '85203';   // 287 colonias, el peor caso del catálogo
  /* ⚠ EL CAMPO DE LA COLONIA, VACÍO PRIMERO. Viene con «Fraccionamiento que no
     existe» de la comprobación de más arriba, y con texto dentro la lista sale
     filtrada a cero: la comprobación del tope pasaría sin medir el tope. Se vio
     saboteando —se levantó el límite a 5.000 y esta línea siguió en verde—, que
     es exactamente para lo que sirve sabotear. */
  await pg.fill('[name=colonia]', '');
  await pg.fill('[name=cp]', cpMasPoblado);
  await pg.waitForFunction(() => /287/.test(document.querySelector('[data-mx-pista]').textContent),
                           null, { timeout: 8000 });
  ok((await opciones('mx-colonias')).length <= 8,
     'con 287 colonias en el código postal, el desplegable NO se llena de 287');
  ok(/escribe las primeras letras/i.test(await pg.locator('[data-mx-pista]').textContent()),
     'y la pista dice cómo encontrarla: escribiendo');
  await pg.fill('[name=colonia]', 'villa');
  await pg.waitForFunction(() => document.querySelector('#mx-colonias').options.length > 0,
                           null, { timeout: 8000 });
  const filtradas = await opciones('mx-colonias');
  ok(filtradas.length <= 8 && filtradas.every(x => /villa/i.test(x)),
     `y al escribir «villa» salen sólo las que la llevan (${filtradas.length})`);

  /* Las 2.528 ciudades no se descargan hasta que alguien va a escribir una.
     Se mira en una pestaña RECIÉN ABIERTA: en la de arriba ya se escribió en
     el campo de la ciudad, y eso es justo lo que dispara la descarga. */
  await pg.goto(BASE + '/pedido.html?n=1');
  await pg.locator('.ped-op:has([value=blanco])').click();
  await pg.locator('[data-paso="1"] [data-sigue]').click();
  ok((await opciones('mx-ciudades')).length === 0,
     'la lista de ciudades no se descarga hasta que hace falta');

  /* ⚠ Y AL TOCAR EL CAMPO SIGUE VACÍA. Ocho ciudades al azar de las 2.528 no
     ayudan a nadie, y las 2.528 son justo lo que colgaba el teléfono. */
  await pg.locator('[name=ciudad]').focus();
  await pg.waitForTimeout(600);
  ok((await opciones('mx-ciudades')).length === 0,
     'y al tocar el campo tampoco se llena: se llena al escribir');

  /* Sin acentos y en minúsculas, que es como se teclea en un móvil. */
  await pg.fill('[name=ciudad]', 'san luis potosi');
  await pg.waitForFunction(() => document.querySelector('#mx-ciudades').options.length > 0,
                           null, { timeout: 8000 });
  const ciu = await opciones('mx-ciudades');
  ok(ciu.includes('San Luis Potosí'),
     '«san luis potosi» sin acentos encuentra «San Luis Potosí»');
  ok(ciu.length <= 8, `y nunca hay más de ocho a la vez (${ciu.length})`);
  await pg.fill('[name=ciudad]', 's');
  await pg.waitForTimeout(300);
  ok((await opciones('mx-ciudades')).length <= 8,
     'ni con una sola letra, que es donde más coincidencias hay');

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
  ok(await ve('productos') && await ve('servicios') && await ve('clientes'),
     'sin JS los tres paneles de Soluciones se ven a la vez');
  ok(await pg.locator('#servicios .svc').count() === 4, 'y están los cuatro servicios');
  ok(await pg.locator('#clientes .insta-g figure').count() === 3, 'y las tres instalaciones');
  ok((await pg.locator('[data-pc-total]').textContent()).trim() !== '',
     'y el precio de una placa se lee: es HTML, no lo escribe ningún script');

  /* ⚠ EL CONTADOR NACE ESCONDIDO Y LO ENCIENDE EL SCRIPT. Sin JavaScript el
     «+» no sumaría, el campo aceptaría un número que nadie leería y el precio
     de al lado seguiría diciendo el de una placa: tres controles mintiendo a la
     vez. Escondido, la ficha dice lo que siempre dijo —una placa, su precio y
     el botón— y la cantidad se elige un toque después, en el desplegable de la
     página de pedido, que sí funciona sin script. */
  ok(!(await pg.locator('.pc-cant').isVisible()),
     'sin JS el contador de la ficha NO se enseña: no sumaría nada');
  ok(await pg.locator('[data-pc-ir]').isVisible(),
     'pero el botón de comprar sigue ahí, que es lo que no se puede perder');

  /* Las 25 cantidades siguen enteras donde se corrigen, y sin JavaScript:
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
  /* ⚠ `force` AQUÍ Y SÓLO AQUÍ, Y NO ES PEREZA. Antes de pulsar, Playwright
     espera a que el elemento deje de moverse, y eso lo mide comparando su
     posición en DOS FOTOGRAMAS SEGUIDOS (requestAnimationFrame). Con el
     JavaScript apagado el navegador no ejecuta esas llamadas, y en una página
     quieta —pedido.html no tiene ninguna animación en marcha— tampoco hay
     nada que fuerce un repintado: los dos fotogramas no llegan nunca y el
     clic caduca a los treinta segundos con un «element is not stable» que no
     habla de esta web, sino del medidor.

     Lo que se está comprobando es que un formulario normal, con method="post"
     y sin una línea de script, envía los campos correctos. Que el botón sea
     visible y alcanzable ya se comprobó arriba. */
  ok(await pg.locator('[data-ped-pagar]').isVisible(), 'el botón de pagar está a la vista');
  await pg.locator('[data-ped-pagar]').click({ force: true });
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
