/* El camino por el que se cobra un SERVICIO. Es el segundo camino por el que
   entra dinero en esta web, y no comparte casi nada con el de las placas: no
   hay cantidad, no hay envío, no hay dirección, y sí hay una regla comercial
   —el anticipo— que sólo vale en un caso.

   Se corre igual que la otra suite:
     node servidor.js 8099 &
     node pruebas/servicio.mjs                                                */
import { chromium } from 'playwright';

const BASE  = process.env.BASE  || 'http://127.0.0.1:8099';
const COBRO = 'https://pagos.sycsolutions.company/**';
const S     = process.env.CAPTURAS || '';

const navegador = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
let fallos = 0;
const ok = (c, t) => { if (!c) fallos++; console.log((c ? '  ok    ' : '  FALLA ') + t); };
const errores = [];
const vigila = pg => {
  pg.on('pageerror', e => errores.push('pageerror: ' + e.message));
  pg.on('console', m => { const t = m.text();
    if (m.type() === 'error' && !/CONNECTION_RESET|ABORTED|googleapis/.test(t)) errores.push(t); });
};

/* Los radios de verdad están escondidos detrás de su tarjeta —así se diseñó el
   control, para que el objetivo táctil sea la tarjeta entera y no un círculo de
   14 px—. Así que se pulsa la TARJETA, que es lo que hace una persona. */
/* Las formas de pago viven DENTRO de su paquete y no se descubren hasta que se
   elige uno, así que elegir «gp-ta» son dos gestos: abrir «Todo hecho» y luego
   marcar el anticipo. Es lo que hace una persona, y el ayudante hace los dos
   para que cada prueba siga leyéndose por lo que comprueba. */
/* Toca la tarjeta ARRIBA, donde está el nombre del paquete, y no en su centro.
   El control invisible cubre el bloque entero, pero «ver qué incluye» va por
   encima de él —tiene su propio gesto— y cae justo en medio: pulsar ahí no
   elige nada, y una prueba que lo hiciera estaría midiendo otra cosa.

   Va por `position` sobre el propio control y no por coordenadas de pantalla:
   así Playwright lo trae a la vista, espera a que deje de moverse —la página se
   desplaza con animación— y comprueba que el punto pulsado sea de verdad este
   elemento. Con `mouse.click` no hay nada de eso y el clic cae donde la tarjeta
   ya no está. */
const tocaPlan = (pg, plan) =>
  pg.locator(`.sv-plan[data-plan="${plan}"] .sv-elige`).click({ position: { x: 24, y: 18 } });

const elige = async (pg, valor) => {
  const op = pg.locator(`.ped-op:has(input[value="${valor}"])`);
  if (!(await op.isVisible())) {
    const abrir = pg.locator(`.sv-plan:has(input[value="${valor}"]) .sv-elige`);
    if (await abrir.count()) {
      /* Con OTRO paquete abierto, éste está escondido y su botón también: hay
         que volver atrás primero, que es exactamente lo que hace quien se
         equivoca de paquete. */
      if (!(await abrir.isVisible())) {
        const atras = pg.locator('[data-sv-cambiar]');
        if (await atras.isVisible()) await atras.click();
        await abrir.waitFor({ state: 'visible', timeout: 4000 });
      }
      await tocaPlan(pg, await abrir.getAttribute('data-elige'));
      await op.waitFor({ state: 'visible', timeout: 4000 });
    }
  }
  await op.click();
};

/* ⚠ SÓLO LO QUE SE VE. Cada paquete lleva sus DOS frases en el marcado —la de
   «tengo ficha» y la de «no la tengo»— y el CSS enseña una y esconde la otra.
   Leerlas todas con `textContent` devuelve las dos y da igual cuál esté
   puesta: la comprobación pasaría en verde con la frase equivocada en
   pantalla. */
/* ⚠ NI UN SOLO RELOJ FIJO. Esta suite se sincronizaba con 20 `waitForTimeout`
   de entre 140 y 800 ms, y bajo carga —otro Chromium en la misma máquina— se
   ponía roja dos de cada cinco veces, cada vez por parejas distintas de
   comprobaciones. El rojo no era la página: era el reloj. Un margen fijo o
   sobra —y entonces la suite tarda de más— o falta, y entonces miente.
   `hasta()` espera A LA CONDICIÓN que la comprobación siguiente necesita, y si
   no llega lo dice con su nombre en vez de fallar en la línea de al lado. */
const hasta = async (cond, que, ms = 8000) => {
  const fin = Date.now() + ms;
  for (;;) {
    try { if (await cond()) return true; } catch (_) { /* navegando: se reintenta */ }
    if (Date.now() > fin) { ok(false, `ESPERA agotada (${ms} ms): ${que}`); return false; }
    await new Promise(r => setTimeout(r, 30));
  }
};

/* La página está lista cuando su script ya ha escondido el bloque de datos, que
   es lo primero que hace. Antes de eso no hay nada que comprobar. */
const lista = pg => hasta(
  () => pg.$eval('[data-sv-datos]', e => e.hidden), 'el script de servicio.html arrancó');

/* gracias.html está lista cuando ya ha pintado el resumen. Todas las vueltas de
   esta suite traen pedido en sessionStorage, así que el resumen SIEMPRE acaba
   apareciendo: si no aparece es un fallo, y esperar a que aparezca lo dice con
   su nombre en vez de dejar que falle la comprobación de al lado. */
const graciasLista = pg => hasta(
  () => pg.locator('[data-gr-resumen]').isVisible(), 'gracias.html pintó su resumen');

const frases = pg => pg.$$eval('.sv-plan .sv-como',
  ps => ps.filter(x => x.offsetParent !== null).map(x => x.textContent.trim()));

{
  const ctx = await navegador.newContext();
  const pg = await ctx.newPage();
  vigila(pg);

  let enviado = null;
  await ctx.route(COBRO, async ruta => {
    enviado = ruta.request().postData();
    await ruta.fulfill({ status: 200, contentType: 'text/html', body: 'ok' });
  });

  await pg.goto(BASE + '/servicio.html', { waitUntil: 'domcontentloaded' });
  await lista(pg);

  /* ---- las cuatro opciones, y UNA sola marcada ---- */
  const ops = pg.locator('input[name="paquete"]');
  ok(await ops.count() === 4, 'las cuatro combinaciones existen');

  /* ---- DOS paquetes, y dentro de cada uno sus formas de pago ---- */
  ok(await pg.locator('.sv-plan').count() === 2, 'hay DOS paquetes, no cuatro opciones sueltas');
  const dentro = await pg.$$eval('.sv-plan', ps =>
    ps.map(x => x.querySelectorAll('input[name="paquete"]').length));
  ok(dentro.every(n => n === 2), 'y cada uno lleva dentro sus dos formas de pago: ' + dentro.join(' y '));

  /* EL AVISO DE CÓMO SE PAGA, ANTES DE ELEGIR. Quien ve una sola cifra decide
     ahí mismo si sigue; enterarse de que había otra forma de pagar DESPUÉS es
     un cliente perdido por no haberlo dicho a tiempo. */
  const avisos = await frases(pg);
  ok(avisos.length === 2 && avisos.every(t => /contado/i.test(t) && /anticipo/i.test(t)),
     'cada paquete dice cómo se puede pagar ANTES de elegir');
  for (const a of avisos) console.log('      ' + a.replace(/\s+/g, ' '));

  /* Nada preseleccionado: una opción marcada de fábrica en una pantalla de cobro
     es una que alguien puede comprar sin haberla elegido. */
  const marcadas = await pg.$$eval('input[name="paquete"]', is => is.filter(i => i.checked).length);
  ok(marcadas === 0, `ninguna nace marcada en una pantalla de cobro (hay ${marcadas})`);
  ok(await pg.$$eval('input[name="paquete"]', is => is.every(i => i.required)),
     'y las cuatro llevan `required`: sin JavaScript el navegador exige elegir');

  /* ---- LA VISITA NO ES NACIONAL, Y SE DICE AQUÍ ----
     «Todo hecho» promete ir al negocio a tomar las fotos. Los términos limitan
     esa visita a San Luis Potosí y Soledad desde el primer día. Un matiz que
     sólo vive en la página de términos es un matiz que se lee después de pagar,
     y quien lo descubre ahí tiene razón en enfadarse. */
  const conVisita = pg.locator('.sv-plan', { hasText: 'Vamos a tu negocio' });
  ok(await conVisita.locator('.sv-nota').count() === 1,
     'el paquete que promete la visita lleva su matiz en el mismo bloque');
  const matiz = (await conVisita.locator('.sv-nota').innerText()).trim();
  ok(/San Luis Potos/i.test(matiz) && /Soledad/i.test(matiz),
     'y dice dónde: ' + matiz.replace(/\s+/g, ' '));
  ok(/otra ciudad|fuera/i.test(matiz) && /fotos las mandas t/i.test(matiz),
     'y qué pasa desde otra ciudad, que es la mitad que faltaba');

  /* ---- PRIMERO EL PAQUETE, DESPUÉS CÓMO SE PAGA ----
     Con las cuatro formas de pago desplegadas a la vez, la pantalla pedía dos
     decisiones al mismo tiempo y el ojo comparaba importes entre paquetes
     distintos: «$750» junto a «$1,490» parece un descuento cuando es un
     anticipo. */
  ok(!(await pg.locator('.sv-pagos').first().isVisible()),
     'al entrar NO se ven las formas de pago: sólo los dos paquetes');
  ok(await pg.locator('.sv-elige:visible').count() === 2,
     'y cada paquete lleva su control para elegirlo');

  /* ⚠ EL CONTROL ES LA TARJETA ENTERA, no un rectangulito debajo del texto.
     Antes era un botón normal, y en iOS salía como una pastilla blanca del
     sistema: 200 px de objetivo dentro de una tarjeta de 700 que ya dice todo
     lo que hay que saber. */
  const tapa = await pg.$eval('.sv-plan',
    p => { const a = p.getBoundingClientRect(), b = p.querySelector('.sv-elige').getBoundingClientRect();
           return { ancho: b.width / a.width, alto: b.height / a.height,
                    ios: getComputedStyle(p.querySelector('.sv-elige')).webkitAppearance }; });
  ok(tapa.ancho > .95 && tapa.alto > .95,
     `el control cubre la tarjeta entera (${Math.round(tapa.ancho*100)}% × ${Math.round(tapa.alto*100)}%)`);
  ok(tapa.ios === 'none',
     'y sin la apariencia del sistema: en iOS un <button> sin esto sale como una pastilla blanca');
  ok(await pg.locator('.sv-pista:visible').count() === 2,
     'y cada tarjeta dice que se toca: una que reacciona al pulsarla no se distingue de un cuadro de texto');

  /* ── QUÉ INCLUYE, EN LA PROPIA TARJETA ──
     Antes esto sólo vivía en la página de términos, mezclado con plazos y
     cancelación: había que salir, leer un texto legal entero y volver. Y el
     desplegable va POR ENCIMA del control que cubre la tarjeta, así que abrirlo
     no puede ser además elegir el paquete: son dos gestos en el mismo sitio. */
  ok(await pg.locator('.sv-mas').count() === 2, 'cada paquete dice qué incluye sin salir de aquí');
  ok(await pg.$$eval('.sv-mas', ds => ds.every(d => !d.open)),
     'y nace plegado: desplegado robaría la pantalla a la decisión de arriba');
  const puntos = await pg.$$eval('.sv-mas li', ls => ls.length);
  ok(puntos >= 8, `con lo que incluye cada uno en frases cortas (${puntos} en total)`);

  /* ⚠ Y ES ÉL QUIEN RECIBE EL TOQUE. El control que elige el paquete cubre la
     tarjeta entera; sin `z-index` por encima, el desplegable queda debajo y no
     hay forma de abrirlo. Se comprueba preguntando QUÉ HAY en ese punto, y no
     dejando que el clic reviente: un choque de capas tiene que salir como un
     rojo con nombre, no como un volcado que tumba la suite entera. */
  /* Traído a la vista primero: `elementFromPoint` sólo mira DENTRO de la
     pantalla, y sobre un punto que queda debajo del pliegue devuelve `null`
     —que no es «lo tapa otro», es «no estabas mirando ahí»—. */
  await pg.locator('.sv-plan[data-plan="gp-e"] .sv-mas summary').scrollIntoViewIfNeeded();
  const encima = await pg.$eval('.sv-plan[data-plan="gp-e"] .sv-mas summary', e => {
    const c = e.getBoundingClientRect();
    const t = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
    return !!(t && t.closest('.sv-mas'));
  });
  ok(encima, 'y es él quien recibe el toque, no el control que cubre la tarjeta');

  await pg.locator('.sv-plan[data-plan="gp-e"] .sv-mas summary').click();
  await hasta(() => pg.$eval('.sv-plan[data-plan="gp-e"] .sv-mas', d => d.open),
              'se abre al tocarlo');
  ok(!(await pg.locator('.sv-plan[data-plan="gp-e"]').evaluate(e => e.classList.contains('abierto'))),
     'y abrirlo NO elige el paquete: son dos gestos distintos en el mismo sitio');
  ok(await pg.locator('.sv-plan:visible').count() === 2, 'ni aparta al otro paquete');
  await pg.locator('.sv-plan[data-plan="gp-e"] .sv-mas summary').click();
  await hasta(() => pg.$eval('.sv-plan[data-plan="gp-e"] .sv-mas', d => !d.open), 'y se vuelve a plegar');

  /* ⚠ EL RESUMEN NO PUEDE SONAR A «ESTO VA DE FOTOS». Decía «Con las fotos que
     tú nos mandes» y «Vamos a tu negocio y tomamos las fotos»: quien no sabe
     qué es configurar un perfil de Google leía eso y entendía que el paquete
     son fotos. Lo que compra es la ficha entera montada. */
  const titulares = await pg.$$eval('.sv-que', ps => ps.map(x => x.textContent.trim()));
  for (const t of titulares) console.log('      ' + t);
  ok(!titulares.some(t => /^(con|vamos)[^.]*fotos/i.test(t)),
     'ninguno de los dos resúmenes empieza hablando sólo de fotos');
  ok(/ficha|google/i.test(titulares[0]),
     'el primero dice lo que de verdad se compra: la ficha');

  /* ── EL PASO EN EL QUE SE ESTÁ ──
     Una pantalla que va descubriendo bloques no dice cuánto falta, y no saber
     cuánto falta es el motivo por el que se abandona un cobro. */
  const paso = () => pg.locator('[data-sv-paso]').innerText().then(t => t.trim());
  ok(/paso 1 de 3/i.test(await paso()), 'el rótulo dice en qué paso se está: ' + await paso());

  /* AL TOCAR, UNA SEÑAL. Sin ella, entre el dedo y el cambio de pantalla no
     pasa nada y quien tiene prisa vuelve a pulsar. Y si NO se toca, nada se
     mueve: no hay `:hover` en una pantalla táctil. */
  ok(!(await pg.locator('.sv-plan.pulsada').count()),
     'sin tocar nada, ninguna tarjeta se enciende sola');

  /* ⚠ LA HOJA DE ESTILO LLEVA LA HUELLA DE SU CONTENIDO EN EL ENLACE.
     Sin ella, Safari en iOS reutiliza el CSS viejo con el HTML nuevo y el
     resultado no parece un fallo de caché: parece un diseño roto. Pasó tres
     veces en el mismo teléfono, y una de ellas dejó el control de comprar
     convertido en una rayita de cuatro píxeles. Se comprueba también que la
     dirección con huella RESPONDA: una huella mal puesta es un 404 y una
     página sin estilos. */
  const hojas = await pg.$$eval('link[rel="stylesheet"][href^="assets/"]',
    ls => ls.map(l => l.getAttribute('href')));
  ok(hojas.length > 0 && hojas.every(h => /\.css\?v=[a-f0-9]{8}$/.test(h)),
     'cada hoja de estilo propia lleva la huella de su contenido: ' + hojas.join(' '));
  const cargadas = await pg.evaluate(() => [...document.styleSheets]
    .filter(h => h.href && h.href.includes('/assets/')).length);
  ok(cargadas === hojas.length,
     `y las ${hojas.length} se cargan de verdad con esa dirección (${cargadas})`);

  /* EN REPOSO LA TARJETA RESPIRA. Es lo que dice «esto se toca» sin escribirlo,
     y va en el borde para no competir con el precio. */
  const respira = await pg.$eval('.sv-plan',
    e => getComputedStyle(e, '::before').animationName);
  ok(respira === 'svRespira', 'y en reposo el borde respira, para que se vea que es tocable');
  /* Se toca el TÍTULO y no el centro de la tarjeta: con «ver qué incluye»
     desplegado, el centro cae dentro de ese bloque —que tiene su propio
     control y no elige nada—, y la prueba estaría midiendo otra cosa. Tocar
     el nombre del paquete es lo que hace una persona. */
  await tocaPlan(pg, 'gp-e');
  ok(await pg.locator('.sv-plan[data-plan="gp-e"]').evaluate(e => e.classList.contains('pulsada')),
     'al tocar la tarjeta —no un botón— salta la ola que confirma el toque');
  /* Y LA OLA SALE DEL PUNTO QUE SE TOCÓ, no del centro: es la diferencia entre
     una animación que decora y una que contesta al dedo. */
  const origen = await pg.$eval('.sv-plan[data-plan="gp-e"]',
    e => ({ x: e.style.getPropertyValue('--x'), y: e.style.getPropertyValue('--y') }));
  ok(/px$/.test(origen.x) && /px$/.test(origen.y),
     `la ola sale del punto que se tocó (${origen.x}, ${origen.y})`);
  await hasta(() => pg.$eval('.sv-plan[data-plan="gp-e"]', e => !e.classList.contains('pulsada')),
              'la ola se limpia sola');
  ok(await pg.locator('.sv-plan[data-plan="gp-e"]').evaluate(e => e.classList.contains('abierto')),
     'y el paquete queda abierto');
  ok(/paso 2 de 3/i.test(await paso()), 'y el rótulo avanza al paso 2: ' + await paso());
  await elige(pg, 'gp-e');
  await hasta(async () => /paso 3 de 3/i.test(await paso()), 'el rótulo llega al paso 3');
  ok(/paso 3 de 3/i.test(await paso()), 'y al elegir cómo se paga, al 3: ' + await paso());
  await pg.locator('[data-sv-cambiar]').click();
  await hasta(async () => await pg.locator('.sv-plan:visible').count() === 2, 'vuelven los dos');
  ok(!(await pg.locator('[data-sv-vuelta]').isVisible()),
     'sin nada elegido no hay nada que deshacer, así que no hay botón de volver');

  await tocaPlan(pg, 'gp-t');
  await hasta(() => pg.locator('.sv-plan[data-plan="gp-t"] .sv-pagos').isVisible(),
              'las formas de pago del paquete elegido aparecen');
  ok(await pg.locator('.sv-plan:visible').count() === 1,
     'al elegir uno, el otro se aparta: una sola cosa en pantalla');
  /* Acotado a `.sv-pagos`: la pregunta de la ficha, arriba, usa el mismo
     molde `.ped-op` y contarlas todas daba cuatro sin que sobrara ninguna. */
  ok(await pg.locator('.sv-pagos .ped-op:visible').count() === 2,
     'y sólo salen SUS dos formas de pago, no las cuatro');

  /* LA SALIDA. Un cobro sin marcha atrás es un cobro que se abandona: quien se
     equivoca de paquete y no ve cómo deshacerlo cierra la pestaña. */
  ok(await pg.locator('[data-sv-cambiar]').isVisible(),
     'y aparece el botón para cambiar de paquete');
  await pg.locator('[data-sv-cambiar]').click();
  await hasta(async () => await pg.locator('.sv-plan:visible').count() === 2,
              'vuelven los dos paquetes');
  ok(await pg.locator('.sv-plan:visible').count() === 2, 'volver deja los dos paquetes otra vez');
  ok(!(await pg.locator('.sv-pagos').first().isVisible()),
     'y las formas de pago se vuelven a guardar');
  ok(await pg.$$eval('input[name="paquete"]', is => is.every(i => !i.checked)),
     'y NINGUNA queda marcada: cobrar algo que ya no está en pantalla es cobrar a ciegas');

  /* ---- los datos no se piden hasta que hay paquete ---- */
  ok(!(await pg.locator('[data-sv-datos]').isVisible()),
     'los datos del negocio NO se piden antes de elegir paquete');
  /* Y aparecen con el PAQUETE abierto, sin esperar a la forma de pago: es lo
     que el titular pidió —«cuando seleccione el paquete que aparezca todo lo
     demás»— y evita que el bloque salte al cambiar de una opción a la otra. */
  await tocaPlan(pg, 'gp-e');
  await hasta(() => pg.locator('[data-sv-datos]').isVisible(), 'los datos aparecen al abrir el paquete');
  ok(await pg.locator('[data-sv-datos]').isVisible(),
     'y aparecen al ABRIR el paquete, antes de elegir cómo se paga');
  ok(await pg.$$eval('input[name="paquete"]', is => is.every(i => !i.checked)),
     'sin que nada quede marcado de fábrica');

  /* ---- LA QUE JUSTIFICA EL ARCHIVO: no viaja ningún importe ---- */
  const camposForm = await pg.$$eval('#sv-form [name]', es => es.map(e => e.name));
  const sospechosos = camposForm.filter(n =>
    /total|precio|monto|importe|unit_price|transaction_amount|anticipo/i.test(n));
  ok(sospechosos.length === 0,
     'NO viaja ningún importe en el formulario' + (sospechosos.length ? ': ' + sospechosos : ''));

  /* ---- la cifra grande sigue a la opción elegida, y coincide con el catálogo ---- */
  const desc = [];
  for (const v of ['gp-e', 'gp-ea', 'gp-t', 'gp-ta']) {
    await elige(pg, v);
    const suyo = await pg.$eval(`input[value="${v}"]`, i => i.dataset.tot);
    await hasta(async () => (await pg.locator('[data-sv-tot]').textContent()).trim() === suyo,
                `la cifra grande alcanza a ${v}`);
    desc.push([v, (await pg.locator('[data-sv-tot]').textContent()).trim()]);
  }
  for (const [v, visto] of desc) console.log(`      ${v.padEnd(6)} enseña ${visto}`);
  ok(desc.every(([, v]) => /^\$[\d,]+$/.test(v)), 'cada opción escribe su importe arriba');

  /* ---- EL ANTICIPO SÓLO SI LA CUENTA LA CREAMOS NOSOTROS ----
     Es la única regla comercial de esta página, y la razón de que exista: en un
     perfil de Google no se puede retener la entrega, así que con ficha ajena no
     hay nada que reservar. */
  await elige(pg, 'si');
  await hasta(() => pg.$eval('input[data-anticipo]', i => i.disabled), 'el anticipo se apaga');
  const apagados = await pg.$$eval('input[name="paquete"][data-anticipo]', is => is.map(i => i.disabled));
  ok(apagados.length === 2 && apagados.every(Boolean),
     'con ficha propia, las dos opciones de anticipo quedan deshabilitadas');
  /* Y LA FRASE CAMBIA CON LAS OPCIONES. Apagar el anticipo dejando la línea que
     promete «págalo de contado o deja un anticipo» dejaría la página diciendo
     dos cosas a la vez, que es justo la contradicción que este orden evita. */
  const conFicha = await frases(pg);
  ok(conFicha.every(t => !/deja \$[\d,]+ de anticipo/i.test(t)),
     'y la frase de cada paquete deja de prometer el anticipo');
  ok(conFicha.every(t => /ya existe/i.test(t)), 'y explica por qué: la ficha ya existe');
  for (const c of conFicha) console.log('      ' + c.replace(/\s+/g, ' '));
  const quedan = await pg.$$eval('input[name="paquete"]', is => is.filter(i => i.checked).length);
  ok(quedan === 0, 'y una elección de anticipo se deshace en vez de quedarse apagada');
  /* Y SE DICE CON PALABRAS, no sólo con un borde y menos tinta. Quien pulsa una
     tarjeta y no ve pasar nada no concluye «no está disponible», concluye «esta
     web no funciona» — y eso pasa en la pantalla de cobro. */
  const rotulo = await pg.$eval('.ped-op.apagada b',
    b => getComputedStyle(b, '::after').content);
  ok(/no disponible/i.test(rotulo), 'y la tarjeta apagada dice EN TEXTO que no está disponible');

  /* Y EL ENLACE DE LA FICHA NO PUEDE SOBREVIVIR AL CAMBIO DE RESPUESTA. Un
     campo escondido conserva su valor y lo manda igual: quien pegaba su ficha y
     luego corregía a «todavía no aparezco» mandaba las dos cosas a la vez, y el
     resumen de la venta llegaba diciendo «SIN ficha: la creamos» con un enlace
     a la ficha que ya existía debajo. */
  await elige(pg, 'gp-t');   // el bloque de datos no existe hasta que hay paquete
  await hasta(() => pg.locator('[name=ficha]').isVisible(), 'el enlace de la ficha se puede rellenar');
  await pg.fill('[name=ficha]', 'https://maps.app.goo.gl/ejemplo');
  await elige(pg, 'no');
  await hasta(() => pg.$eval('input[data-anticipo]', i => !i.disabled), 'el anticipo vuelve');
  ok(await pg.$eval('[name=ficha]', i => i.value) === '',
     'al decir que todavía no aparece, el enlace de la ficha se VACÍA, no sólo se esconde');
  const revividos = await pg.$$eval('input[name="paquete"][data-anticipo]', is => is.map(i => i.disabled));
  ok(revividos.every(d => d === false), 'y vuelven si dice que todavía no aparece en Google');
  const vuelve = await frases(pg);
  ok(vuelve.every(t => /anticipo/i.test(t)), 'y la frase vuelve a ofrecerlo');

  /* ---- lo que llega al cobro ---- */
  await elige(pg, 'gp-ta');
  await pg.fill('[name=negocio]', 'El Molino Ruso');
  await pg.fill('[name=negocio_ciudad]', 'San Luis Potosí');
  await pg.fill('[name=nombre]', 'Gael Ramírez');
  await pg.fill('[name=tel]', '4423697248');
  await pg.fill('[name=correo]', 'gael@ejemplo.com');
  await pg.click('#sv-form button[type=submit]');
  await hasta(() => !!enviado, 'el POST llega a la ruta del cobro');

  ok(!!enviado, 'el formulario llega al cobro');
  const q = new URLSearchParams(enviado || '');
  ok(q.get('paquete') === 'gp-ta', 'se manda el paquete elegido: ' + q.get('paquete'));
  ok(q.get('ficha_tiene') === 'no', 'y si tiene ficha o no, que es lo que hace legítimo el anticipo');
  ok(!q.get('cp') && !q.get('calle') && !q.get('estado'),
     'NO se pide ni se manda dirección de envío: un servicio no se envía');
  const importes = [...q.keys()].filter(k => /total|precio|monto|importe/i.test(k));
  ok(importes.length === 0, 'y tampoco viaja ningún importe');

  /* ---- teléfono corto rebota: el `pattern` tiene que estar vivo ---- */
  await pg.goto(BASE + '/servicio.html');
  await lista(pg);
  await elige(pg, 'gp-e');            // los datos no existen hasta elegir paquete
  await hasta(() => pg.locator('[name=tel]').isVisible(), 'los datos ya se pueden rellenar');
  await pg.fill('[name=negocio]', 'X'); await pg.fill('[name=negocio_ciudad]', 'Y');
  await pg.fill('[name=nombre]', 'Z'); await pg.fill('[name=correo]', 'a@b.com');
  await pg.fill('[name=tel]', '442');
  ok(!(await pg.$eval('[name=tel]', i => i.checkValidity())),
     'un teléfono de tres cifras no pasa la validación');

  /* ---- LA VUELTA, CON LO QUE LA PÁGINA ESCRIBIÓ DE VERDAD ----
     ⚠ Esto fabricaba a mano el objeto de sessionStorage, y por eso se le pasó
     el fallo que más se veía de toda la página: servicio.html guardaba el
     importe YA FORMATEADO —«$1,150»— y gracias.html lo vuelve a formatear con
     `Number(v)`, que sobre ese texto da NaN. El comprador leía «$NaN» en el
     resumen de lo que acababa de pagar. Una prueba que se inventa el dato
     comprueba que la segunda página sabe leer, no que la primera sepa escribir.

     Ahora no se inventa nada: se compra de verdad —el POST al cobro está
     interceptado, así que la pestaña vuelve al mismo origen y el sessionStorage
     que escribió el formulario sigue ahí— y se lee lo que haya salido. */
  const guardado = JSON.parse(await pg.evaluate(() => sessionStorage.getItem('syc_pedido')) || 'null');
  ok(guardado && guardado._servicio === 1, 'el formulario deja el pedido guardado para la vuelta');
  ok(typeof guardado._tot === 'number',
     'y el importe va en CRUDO, no formateado: ' + JSON.stringify(guardado._tot));
  ok(guardado._resto === 1150, 'con lo que falta por cobrar del anticipo: ' + guardado._resto);
  ok(!guardado.ficha, 'y sin el enlace de una ficha que dijo no tener');

  await pg.goto(BASE + '/gracias.html', { waitUntil: 'domcontentloaded' });
  await graciasLista(pg);
  const trasAnticipo = await pg.locator('main').innerText();
  ok(!/NaN/.test(trasAnticipo),
     'y el resumen enseña un importe, no «$NaN»' + (/NaN/.test(trasAnticipo) ? ': ' + trasAnticipo.replace(/\s+/g, ' ').slice(0, 120) : ''));
  ok(/\$1,150/.test(trasAnticipo), 'el importe que se acaba de pagar, con su formato');
  /* Quien deja un anticipo se va sin saber cuánto debe si nadie se lo dice, y
     la cifra grande que acaba de ver es la del anticipo, no la del paquete. */
  ok(/falta por pagar/i.test(trasAnticipo), 'y le dice lo que FALTA por pagar');
  ok(/entreguemos el acceso/i.test(trasAnticipo), 'y cuándo se le va a cobrar');
  const waAnti = decodeURIComponent(await pg.locator('[data-gr-wa]').getAttribute('href'));
  ok(/Todav[íi]a no aparezco/.test(waAnti), 'el WhatsApp trae escrito que su ficha no existe');
  ok(/Falta por pagar/.test(waAnti), 'y también lo que queda pendiente, por escrito');

  /* ---- Y AHORA EL OTRO CASO: ficha propia, de contado ---- */
  await pg.goto(BASE + '/servicio.html', { waitUntil: 'domcontentloaded' });
  await lista(pg);
  await elige(pg, 'si');
  await hasta(() => pg.$eval('input[data-anticipo]', i => i.disabled), 'el anticipo se apaga');
  await elige(pg, 'gp-t');
  await hasta(() => pg.locator('[name=tel]').isVisible(), 'los datos ya se pueden rellenar');
  await pg.fill('[name=negocio]', 'El Molino Ruso');
  await pg.fill('[name=negocio_ciudad]', 'San Luis Potosí');
  await pg.fill('[name=nombre]', 'Gael Ramírez');
  await pg.fill('[name=tel]', '4423697248');
  await pg.fill('[name=correo]', 'gael@ejemplo.com');
  await pg.click('#sv-form button[type=submit]');
  await hasta(() => !!enviado, 'el segundo POST llega al cobro');
  await pg.goto(BASE + '/gracias.html', { waitUntil: 'domcontentloaded' });
  await graciasLista(pg);

  const texto = await pg.locator('main').innerText();
  ok(!/NaN/.test(texto), 'de contado tampoco sale ningún «NaN»');
  ok(/\$2,300/.test(texto), 'y el importe es el del paquete completo');
  ok(!/falta por pagar/i.test(texto), 'de contado NO se le anuncia ningún resto pendiente');
  ok(/administrador/i.test(texto), 'le dice que nos añada como administrador');
  ok(/sc\.solutionscompanymx@gmail\.com/.test(texto), 'y con qué correo exactamente');
  /* ⚠ EL PÁRRAFO DE FONDO DECÍA «preparamos tus placas» y lo pisaba el script.
     Quien contrata un servicio no espera ningún paquete: anunciarle un envío es
     esconderle el único paso que sí le toca a él. */
  ok(!/env[íi]o|paqueter[íi]a|placa|direcci[óo]n de entrega/i.test(texto),
     'y NO le habla de envíos, paquetería ni placas');
  const wa = await pg.locator('[data-gr-wa]').getAttribute('href');
  ok(/Ya%20tengo%20ficha/.test(wa), 'el WhatsApp ya trae escrito que su ficha existe');
  ok(!/\$/.test(decodeURIComponent(wa)),
     'y NO declara ningún importe: el precio bueno es el del aviso de Mercado Pago');
  if (S) await pg.screenshot({ path: S + '/gracias-servicio.png' });
  await ctx.close();
}

/* ---- SIN JAVASCRIPT, gracias.html NO PUEDE HABLAR DE PLACAS ----
   Es la misma página para los dos caminos de cobro y sin script no sabe cuál
   fue. El párrafo que trae puesto es el único que se lee, así que tiene que ser
   cierto en los dos casos. Decía «preparamos tus placas». */
{
  const ctx = await navegador.newContext({ javaScriptEnabled: false });
  const pg = await ctx.newPage();
  await pg.goto(BASE + '/gracias.html', { waitUntil: 'domcontentloaded' });
  const fondo = (await pg.locator('[data-gr-p]').innerText()).trim();
  ok(!/placa|env[íi]o|paqueter[íi]a/i.test(fondo),
     'el párrafo de fondo no promete nada de un camino en el otro: ' + fondo.replace(/\s+/g, ' '));
  ok(/whatsapp/i.test(fondo), 'y sí dice lo que vale para los dos: que te avisamos');
  await ctx.close();
}

/* ---- VOLVER ATRÁS DESDE MERCADO PAGO ----
   El navegador restaura el formulario con su paquete todavía marcado, pero de
   la caché de páginas (bfcache) NO vuelve a ejecutar el script. El bloque de
   datos se quedaba escondido, y con él el botón de pagar: un paquete elegido y
   ninguna forma de pagarlo, en la pantalla de cobro. */
{
  const ctx = await navegador.newContext();
  const pg = await ctx.newPage();
  vigila(pg);
  await ctx.route(COBRO, r => r.fulfill({ status: 200, contentType: 'text/html', body: 'ok' }));

  await pg.goto(BASE + '/servicio.html', { waitUntil: 'domcontentloaded' });
  await lista(pg);
  await elige(pg, 'gp-t');
  await hasta(() => pg.locator('[name=tel]').isVisible(), 'los datos ya se pueden rellenar');
  await pg.fill('[name=negocio]', 'El Molino Ruso');
  await pg.fill('[name=negocio_ciudad]', 'San Luis Potosí');
  await pg.fill('[name=nombre]', 'Gael');
  await pg.fill('[name=tel]', '4423697248');
  await pg.fill('[name=correo]', 'a@b.com');
  await pg.click('#sv-form button[type=submit]');
  await pg.waitForURL(/pagos\.sycsolutions\.company/, { timeout: 8000 }).catch(() => {});
  await pg.goBack({ waitUntil: 'domcontentloaded' });
  /* Al volver de la caché de páginas el script NO se re-ejecuta: lo que hay que
     esperar es al `pageshow`, que es lo único que corre ahí. */
  await hasta(() => pg.locator('#sv-form button[type=submit]').isVisible(),
              'el botón de pagar reaparece al volver atrás');

  const marcado = await pg.evaluate(() => {
    const i = document.querySelector('input[name="paquete"]:checked'); return i ? i.value : null; });
  ok(marcado === 'gp-t', 'al volver atrás el paquete sigue elegido');
  ok(await pg.locator('#sv-form button[type=submit]').isVisible(),
     'y el botón de pagar SIGUE ahí: volver atrás no puede dejar un callejón sin salida');
  ok(await pg.locator('[data-sv-datos]').isVisible(), 'con sus datos, tal como se rellenaron');
  await ctx.close();
}

/* ---- UN PAGO PENDIENTE NO SE DA POR HECHO ----
   Mercado Pago devuelve aquí con ?estado=pendiente cuando el pago es en
   efectivo o por transferencia y todavía no se ha completado. Decirle «no
   tienes que hacer nada más» a quien tiene un recibo sin pagar en la mano es
   la forma de que nadie lo pague nunca. */
{
  const ctx = await navegador.newContext();
  const pg = await ctx.newPage();
  vigila(pg);
  await pg.goto(BASE + '/gracias.html');
  await pg.evaluate(() => sessionStorage.setItem('syc_pedido', JSON.stringify({
    _servicio: 1, _t: 'Todo hecho · anticipo', _tot: 1150, _resto: 1150, ficha_tiene: 'no',
    negocio: 'El Molino Ruso', nombre: 'Gael', tel: '4423697248', correo: 'a@b.com' })));
  await pg.goto(BASE + '/gracias.html?estado=pendiente', { waitUntil: 'domcontentloaded' });
  await hasta(async () => /pendiente/i.test(await pg.locator('[data-gr-t]').innerText()),
              'gracias.html reconoció el pago pendiente');

  const t = (await pg.locator('[data-gr-t]').innerText()).trim();
  const par = (await pg.locator('[data-gr-p]').innerText()).trim();
  ok(/pendiente/i.test(t), 'el título dice que el pago está pendiente');
  ok(!/no tienes que hacer nada más|falta un paso tuyo/i.test(par),
     'y el párrafo NO da el pago por hecho: ' + par.slice(0, 70) + '…');
  ok(/complete|termina el pago/i.test(par), 'sino que le dice cómo terminarlo');
  await ctx.close();
}

/* ---- LA PÁGINA DE GRACIAS DEL SERVICIO, SIN JAVASCRIPT ----
   Es la razón de que exista `gracias-servicio.html`. Las dos compras volvían a
   la misma página, que distingue una de otra leyendo el sessionStorage que
   escribe un script. Sin JavaScript no hay nada que leer: al comprador de un
   servicio se le decía «preparamos tus placas» —un envío que no existe— y NUNCA
   veía el correo al que tenía que añadirnos, que es lo que arranca el plazo de
   entrega. Pagaba y se quedaba esperando algo que dependía de él.
   Ahora la rama la elige el Worker (back_urls) y todo lo importante está en el
   marcado. */
{
  const ctx = await navegador.newContext({ javaScriptEnabled: false });
  const pg = await ctx.newPage();
  await pg.goto(BASE + '/gracias-servicio.html', { waitUntil: 'load' });
  const t = await pg.locator('main').innerText();
  ok(/sc\.solutionscompanymx@gmail\.com/.test(t),
     'SIN SCRIPT dice a qué correo hay que añadirnos: es lo que arranca el plazo');
  ok(/administrador/i.test(t), 'y con qué permiso');
  ok(/todav[íi]a no aparece/i.test(t),
     'y también el otro caso, porque sin script no se puede saber cuál es');
  ok(!/placa|env[íi]o|paqueter[íi]a/i.test(t), 'y NO habla de placas ni de envíos');
  ok(/1 a 7 d[íi]as/i.test(t), 'y dice el plazo');
  const wa = decodeURIComponent(await pg.locator('[data-gr-wa]').getAttribute('href'));
  ok(/configuraci[óo]n de mi Google/i.test(wa),
     'y el WhatsApp de fondo ya viene redactado como servicio, no como pedido');
  /* La vuelta lleva a los servicios, no a la tienda de placas. */
  ok(await pg.locator('a[href="/#servicios"]').count() > 0, 'y la vuelta lleva a los servicios');
  await ctx.close();
}

/* ---- Y CON JAVASCRIPT, LA MISMA PÁGINA AFINA ---- */
{
  const ctx = await navegador.newContext();
  const pg = await ctx.newPage();
  vigila(pg);
  await pg.goto(BASE + '/gracias-servicio.html');
  await pg.evaluate(() => sessionStorage.setItem('syc_pedido', JSON.stringify({
    _servicio: 1, _t: 'Todo hecho · anticipo', _tot: 1150, _resto: 1150, ficha_tiene: 'no',
    negocio: 'El Molino Ruso', negocio_ciudad: 'San Luis Potosí', nombre: 'Gael',
    tel: '4423697248', correo: 'a@b.com' })));

  await pg.goto(BASE + '/gracias-servicio.html', { waitUntil: 'domcontentloaded' });
  await graciasLista(pg);
  const conJs = await pg.locator('main').innerText();
  ok(!/NaN/.test(conJs), 'ningún «NaN» en el importe');
  ok(/\$1,150/.test(conJs), 'el importe que se acaba de pagar');
  ok(/falta por pagar/i.test(conJs), 'y lo que queda del anticipo');
  ok(!/a[ñn][áa]denos como administrador/i.test(
       (await pg.locator('[data-gr-p]').innerText())),
     'con la ficha por crear NO se le pide que nos añada: esa cuenta todavía no existe');

  /* ⚠ CON EL PAGO PENDIENTE, «Falta por pagar» MIENTE. Quien tiene un recibo de
     efectivo sin pagar en la mano no debe sólo el resto: no ha pagado nada, y
     el primero de los dos pagos hay que hacerlo AHORA. */
  await pg.goto(BASE + '/gracias-servicio.html?estado=pendiente', { waitUntil: 'domcontentloaded' });
  await hasta(async () => /pendiente/i.test(await pg.locator('[data-gr-t]').innerText()),
              'la página reconoció el pago pendiente');
  const pend = await pg.locator('main').innerText();
  ok(!/falta por pagar/i.test(pend),
     'con el pago pendiente NO se anuncia el resto: todavía no ha pagado ni el anticipo');
  ok(/termina el pago|se complete/i.test(pend), 'sino cómo terminar el que tiene a medias');
  const waPend = decodeURIComponent(await pg.locator('[data-gr-wa]').getAttribute('href'));
  ok(!/Falta por pagar/.test(waPend), 'y el WhatsApp tampoco lo declara');
  await ctx.close();
}

/* ---- SIN JAVASCRIPT ----
   ⚠ ESTE BLOQUE PASABA IGUAL CON JAVASCRIPT ENCENDIDO. Cinco de sus seis
   comprobaciones daban idéntico en los dos contextos —contar `.ped-f` no mira
   `hidden`, y la cifra grande también nace vacía con script cuando no hay nada
   marcado—, así que el día que la emulación no se aplicase el bloque se habría
   quedado en verde sin haber probado nada. Y eso PASÓ: bajo carga, el contexto
   arrancó con JavaScript vivo en dos de cinco ejecuciones.

   Ahora lo primero que hace es afirmar algo que es FALSO con script, para que
   el bloque falle en voz alta si la emulación no se aplicó. */
{
  const ctx = await navegador.newContext({ javaScriptEnabled: false });
  const pg = await ctx.newPage();
  let enviado = null;
  await ctx.route(COBRO, async ruta => {
    enviado = ruta.request().postData();
    await ruta.fulfill({ status: 200, contentType: 'text/html', body: 'ok' });
  });
  await pg.goto(BASE + '/servicio.html', { waitUntil: 'load' });

  /* EL CANARIO. Con script, `datos.hidden=true` corre al analizar el documento
     y este bloque está escondido. Si se ve, es que no hay script — y si esto
     falla, ninguna de las comprobaciones de abajo significa nada. */
  const canario = await pg.locator('[data-sv-datos]').isVisible();
  ok(canario, 'CANARIO: sin script el bloque de datos se ve — si esto falla, el resto de este bloque no prueba nada');

  ok(await pg.locator('.ped-f').count() === 3, 'sin JS se ven los tres bloques a la vez');
  ok(await pg.locator('input[name="paquete"]').count() === 4, 'y las cuatro opciones');
  /* Cada opción lleva su precio ESCRITO al lado, no calculado: sin script, ese
     es el único precio que el visitante puede leer. */
  const etiquetas = await pg.$$eval('.ped-op b', bs => bs.map(b => b.textContent));
  ok(etiquetas.filter(t => /\$/.test(t)).length === 4,
     'cada una lleva su importe escrito, no calculado por un script');
  ok((await pg.locator('[data-sv-tot]').textContent()).trim() === '',
     'y la cifra grande queda vacía en vez de mentir');

  /* ⚠ LA FRASE TIENE QUE CAMBIAR SIN SCRIPT. Antes era un solo <p> que el
     script reescribía, así que sin JavaScript sólo existía una de las dos
     verdades: quien marcaba «ya aparece en Google» seguía leyendo «deja $750 de
     anticipo». Ahora son tres párrafos hermanos y los turna el CSS. */
  /* La pregunta de arriba nace respondida con «todavía no aparece», así que
     ése es el estado de partida y hay exactamente UNA frase visible por
     paquete. */
  const sinFicha = await frases(pg);
  ok(sinFicha.length === 2 && sinFicha.every(t => /deja \$[\d,]+ de anticipo/i.test(t)),
     'con ficha por crear lo ofrece, y SIN script: lo hace el CSS');

  await pg.locator('.ped-op:has(input[value="si"])').click();
  const conFicha = await frases(pg);
  for (const t of conFicha) console.log('      ' + t.replace(/\s+/g, ' '));
  ok(conFicha.length === 2 && conFicha.every(t => !/deja \$[\d,]+ de anticipo/i.test(t)),
     'y con ficha propia DEJA de prometerlo, también sin script');
  ok(conFicha.every(t => /ya existe/i.test(t)), 'y explica por qué');

  /* Y la opción no se puede pulsar: `pointer-events:none` por CSS. Es la única
     de las tres capas —CSS, `disabled` del script, y el corte del Worker— que
     sigue en pie cuando el JavaScript no carga. */
  const anti = pg.locator('.ped-op:has(input[data-anticipo])').first();
  await anti.click({ timeout: 1500 }).catch(() => {});
  ok(!(await pg.locator('input[data-anticipo]').first().isChecked()),
     'la opción de anticipo no se deja marcar con la ficha ya declarada propia');

  /* El enlace de la ficha sólo se pide cuando hay ficha que enlazar. Sin script
     se veía siempre, incluido el estado por defecto donde por definición no
     existe. */
  ok(await pg.locator('[data-sv-ficha]').isVisible(),
     'con ficha propia sí se pide el enlace de la ficha');
  await pg.locator('.ped-op:has(input[value="no"])').click();
  ok(!(await pg.locator('[data-sv-ficha]').isVisible()),
     'y con ficha por crear no se pide: no hay ficha que enlazar');

  /* ⚠ LO QUE LA REGLA EXIGE DE VERDAD: QUE EL FORMULARIO SE ENVÍE.
     Todo lo de arriba mira la página quieta. Lo que hace que «sin JavaScript se
     sigue vendiendo» sea cierto es que el POST salga con lo que hay que
     mandar, y eso no lo comprobaba nadie. */
  await pg.locator('.ped-op:has(input[value="gp-t"])').click();
  await pg.fill('[name=negocio]', 'El Molino Ruso');
  await pg.fill('[name=negocio_ciudad]', 'San Luis Potosí');
  await pg.fill('[name=nombre]', 'Gael');
  await pg.fill('[name=tel]', '4423697248');
  await pg.fill('[name=correo]', 'a@b.com');
  await pg.locator('#sv-form button[type=submit]').click();
  await pg.waitForURL(/pagos\.sycsolutions\.company/, { timeout: 8000 }).catch(() => {});
  ok(!!enviado, 'SIN JAVASCRIPT EL FORMULARIO SE ENVÍA: eso es lo que sostiene la regla');
  const qs = new URLSearchParams(enviado || '');
  ok(qs.get('paquete') === 'gp-t', 'con el paquete elegido: ' + qs.get('paquete'));
  ok(qs.get('ficha_tiene') === 'no', 'y con la respuesta que decide el anticipo');
  ok([...qs.keys()].filter(k => /total|precio|monto|importe/i.test(k)).length === 0,
     'y sin ningún importe dentro');
  await ctx.close();
}

console.log(errores.length ? '\nERRORES DE CONSOLA: ' + errores.join(' | ') : '\nsin errores de consola');
if (errores.length) fallos++;
console.log(fallos ? `\n${fallos} de las comprobaciones FALLAN` : '\nTodas las comprobaciones en verde');
await navegador.close();
process.exit(fallos ? 1 : 0);
