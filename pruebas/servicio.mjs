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
const elige = (pg, valor) => pg.locator(`.ped-op:has(input[value="${valor}"])`).click();

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
  await pg.waitForTimeout(400);

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
  const avisos = await pg.$$eval('.sv-plan .sv-como', ps => ps.map(x => x.textContent.trim()));
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

  /* ---- los datos no se piden hasta que hay paquete ---- */
  ok(!(await pg.locator('[data-sv-datos]').isVisible()),
     'los datos del negocio NO se piden antes de elegir paquete');
  await elige(pg, 'gp-e');
  await pg.waitForTimeout(250);
  ok(await pg.locator('[data-sv-datos]').isVisible(), 'y aparecen en cuanto se elige uno');

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
    await pg.waitForTimeout(140);
    desc.push([v, (await pg.locator('[data-sv-tot]').textContent()).trim()]);
  }
  for (const [v, visto] of desc) console.log(`      ${v.padEnd(6)} enseña ${visto}`);
  ok(desc.every(([, v]) => /^\$[\d,]+$/.test(v)), 'cada opción escribe su importe arriba');

  /* ---- EL ANTICIPO SÓLO SI LA CUENTA LA CREAMOS NOSOTROS ----
     Es la única regla comercial de esta página, y la razón de que exista: en un
     perfil de Google no se puede retener la entrega, así que con ficha ajena no
     hay nada que reservar. */
  await elige(pg, 'si');
  await pg.waitForTimeout(250);
  const apagados = await pg.$$eval('input[name="paquete"][data-anticipo]', is => is.map(i => i.disabled));
  ok(apagados.length === 2 && apagados.every(Boolean),
     'con ficha propia, las dos opciones de anticipo quedan deshabilitadas');
  /* Y LA FRASE CAMBIA CON LAS OPCIONES. Apagar el anticipo dejando la línea que
     promete «págalo de contado o deja un anticipo» dejaría la página diciendo
     dos cosas a la vez, que es justo la contradicción que este orden evita. */
  const conFicha = await pg.$$eval('.sv-plan .sv-como', ps => ps.map(x => x.textContent.trim()));
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
  await pg.waitForTimeout(250);
  await pg.fill('[name=ficha]', 'https://maps.app.goo.gl/ejemplo');
  await elige(pg, 'no');
  await pg.waitForTimeout(250);
  ok(await pg.$eval('[name=ficha]', i => i.value) === '',
     'al decir que todavía no aparece, el enlace de la ficha se VACÍA, no sólo se esconde');
  const revividos = await pg.$$eval('input[name="paquete"][data-anticipo]', is => is.map(i => i.disabled));
  ok(revividos.every(d => d === false), 'y vuelven si dice que todavía no aparece en Google');
  const vuelve = await pg.$$eval('.sv-plan .sv-como', ps => ps.map(x => x.textContent.trim()));
  ok(vuelve.every(t => /anticipo/i.test(t)), 'y la frase vuelve a ofrecerlo');

  /* ---- lo que llega al cobro ---- */
  await elige(pg, 'gp-ta');
  await pg.fill('[name=negocio]', 'El Molino Ruso');
  await pg.fill('[name=negocio_ciudad]', 'San Luis Potosí');
  await pg.fill('[name=nombre]', 'Gael Ramírez');
  await pg.fill('[name=tel]', '4423697248');
  await pg.fill('[name=correo]', 'gael@ejemplo.com');
  await pg.click('#sv-form button[type=submit]');
  await pg.waitForTimeout(700);

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
  await pg.waitForTimeout(300);
  await elige(pg, 'gp-e');            // los datos no existen hasta elegir paquete
  await pg.waitForTimeout(250);
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
  await pg.waitForTimeout(500);
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
  await pg.waitForTimeout(400);
  await elige(pg, 'si');
  await pg.waitForTimeout(250);
  await elige(pg, 'gp-t');
  await pg.waitForTimeout(250);
  await pg.fill('[name=negocio]', 'El Molino Ruso');
  await pg.fill('[name=negocio_ciudad]', 'San Luis Potosí');
  await pg.fill('[name=nombre]', 'Gael Ramírez');
  await pg.fill('[name=tel]', '4423697248');
  await pg.fill('[name=correo]', 'gael@ejemplo.com');
  await pg.click('#sv-form button[type=submit]');
  await pg.waitForTimeout(700);
  await pg.goto(BASE + '/gracias.html', { waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(500);

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
  await pg.waitForTimeout(400);
  await elige(pg, 'gp-t');
  await pg.waitForTimeout(250);
  await pg.fill('[name=negocio]', 'El Molino Ruso');
  await pg.fill('[name=negocio_ciudad]', 'San Luis Potosí');
  await pg.fill('[name=nombre]', 'Gael');
  await pg.fill('[name=tel]', '4423697248');
  await pg.fill('[name=correo]', 'a@b.com');
  await pg.click('#sv-form button[type=submit]');
  await pg.waitForTimeout(600);
  await pg.goBack({ waitUntil: 'domcontentloaded' });
  await pg.waitForTimeout(800);

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
  await pg.waitForTimeout(500);

  const t = (await pg.locator('[data-gr-t]').innerText()).trim();
  const par = (await pg.locator('[data-gr-p]').innerText()).trim();
  ok(/pendiente/i.test(t), 'el título dice que el pago está pendiente');
  ok(!/no tienes que hacer nada más|falta un paso tuyo/i.test(par),
     'y el párrafo NO da el pago por hecho: ' + par.slice(0, 70) + '…');
  ok(/complete|termina el pago/i.test(par), 'sino que le dice cómo terminarlo');
  await ctx.close();
}

/* ---- sin JavaScript ---- */
{
  const ctx = await navegador.newContext({ javaScriptEnabled: false });
  const pg = await ctx.newPage();
  await pg.goto(BASE + '/servicio.html', { waitUntil: 'load' });
  ok(await pg.locator('.ped-f').count() === 3, 'sin JS se ven los tres bloques a la vez');
  ok(await pg.locator('input[name="paquete"]').count() === 4, 'y las cuatro opciones');
  /* Cada opción lleva su precio ESCRITO al lado, no calculado: sin script, ese
     es el único precio que el visitante puede leer. */
  const etiquetas = await pg.$$eval('.ped-op b', bs => bs.map(b => b.textContent));
  ok(etiquetas.filter(t => /\$/.test(t)).length === 4,
     'cada una lleva su importe escrito, no calculado por un script');
  ok((await pg.locator('[data-sv-tot]').textContent()).trim() === '',
     'y la cifra grande queda vacía en vez de mentir');

  /* ⚠ Y LA FRASE DE FONDO NO PUEDE PROMETER EL ANTICIPO A SECAS. Aquí estaba
     escrita la versión de «no tengo ficha», que ofrece el anticipo sin
     condición; a quien llega sin JavaScript con su ficha ya hecha, la página le
     ofrecía un anticipo que el Worker marca para revisión y que los términos no
     sostienen. La condición tiene que estar DENTRO de la frase, porque sin
     script no hay nadie que la cambie. */
  const sinJs = await pg.$$eval('.sv-plan .sv-como', ps => ps.map(x => x.textContent.trim()));
  for (const t of sinJs) console.log('      ' + t.replace(/\s+/g, ' '));
  ok(sinJs.length === 2 && sinJs.every(t => /si la cuenta la creamos nosotros/i.test(t)),
     'la frase de fondo condiciona el anticipo: sin script nadie va a condicionarlo por ella');
  ok(sinJs.every(t => /contado/i.test(t)),
     'y sigue diciendo que se puede pagar de contado, que es lo que vale siempre');
  await ctx.close();
}

console.log(errores.length ? '\nERRORES DE CONSOLA: ' + errores.join(' | ') : '\nsin errores de consola');
if (errores.length) fallos++;
console.log(fallos ? `\n${fallos} de las comprobaciones FALLAN` : '\nTodas las comprobaciones en verde');
await navegador.close();
process.exit(fallos ? 1 : 0);
