/* Pruebas del Worker de cobros. Corren sin red y sin wrangler: se sustituye
   `fetch` global por un doble que captura lo que se le habría mandado a Mercado
   Pago, que es justo lo que hay que inspeccionar.

     node --test test/pagos.test.mjs

   La prueba que justifica el archivo entero es «el importe NO lo pone el
   navegador». Todo lo demás es higiene; ésa es la que evita que alguien pague
   un peso por veinte placas. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker, { CAMPOS } from '../pagos.js';
import TABLA from '../paquetes.json' with { type: 'json' };

const ORIGEN = 'https://sycsolutions.company';
/* Token inventado: no abre nada y nunca sale de este archivo, porque el fetch
   esta sustituido por un doble y jamas se habla con Mercado Pago.
   El escaner de secretos caza la linea de abajo por su FORMA —nombre de
   credencial seguido de un valor entre comillas— y hace bien; el marcador es
   su escape declarado y deja la excepcion a la vista en el diff.
   Y una nota para quien edite esto: el escaner mira TAMBIEN los comentarios,
   asi que escribir aqui el patron de ejemplo vuelve a bloquear el commit.
   Pasó de verdad al redactar este comentario. */
const ENV = { MP_ACCESS_TOKEN: 'no-es-un-token-es-una-prueba' };  // secreto-permitido: valor inventado

/* El Worker usa caches.default para el contador por IP. En Node no existe, y
   sin esto cada prueba entraría por el catch. Se implementa con un Map para
   poder además comprobar el tope. */
function montaCaches() {
  const almacen = new Map();
  globalThis.caches = {
    default: {
      async match(req) { const v = almacen.get(req.url); return v === undefined ? undefined : new Response(v); },
      async put(req, res) { almacen.set(req.url, await res.text()); },
    },
  };
  return almacen;
}

/* Doble de fetch. Guarda la llamada y responde lo que se le diga. */
function montaFetch(respuesta) {
  const llamadas = [];
  globalThis.fetch = async (url, opciones) => {
    llamadas.push({ url: String(url), opciones, cuerpo: JSON.parse(opciones.body) });
    return respuesta();
  };
  return llamadas;
}

const okMP = () => new Response(JSON.stringify({
  id: '123', init_point: 'https://www.mercadopago.com.mx/checkout/v1/redirect?pref_id=123',
}), { status: 200, headers: { 'Content-Type': 'application/json' } });

function post(campos, extra = {}) {
  const form = new FormData();
  for (const [k, v] of Object.entries(campos)) form.append(k, v);
  return new Request('https://pagos.sycsolutions.company/ir', {
    method: 'POST', body: form, headers: { Origin: ORIGEN, 'CF-Connecting-IP': '203.0.113.9', ...extra.headers },
  });
}

/* ══════════════════════════ LO QUE DE VERDAD IMPORTA ══════════════════════ */

test('el importe lo pone el servidor, NUNCA el navegador', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  /* Un atacante edita el formulario y manda un peso por el paquete de 20. */
  await worker.fetch(post({ paquete: '20', total: '1', unit_price: '1', precio: '1', monto: '1' }), ENV);
  assert.equal(llamadas.length, 1);
  const item = llamadas[0].cuerpo.items[0];
  const esperado = TABLA.paquetes.find(p => p.id === '20').total;
  assert.equal(item.unit_price, esperado, 'debe cobrar el precio de la tabla, no el del formulario');
  assert.equal(item.unit_price, 3399);
  assert.equal(item.quantity, 1, 'quantity fija a 1: si viniera del cliente, multiplicaría el cobro');
});

test('el catálogo normal se cobra de contado: installments = 1', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '1' }), ENV);
  const pm = llamadas[0].cuerpo.payment_methods;
  assert.equal(pm.installments, 1, 'installments es el MÁXIMO de cuotas; 1 = una sola exhibición');
  assert.equal(pm.default_installments, 1);
});

test('cada paquete pide las cuotas que dice la tabla, y ninguna más', async () => {
  for (const p of TABLA.paquetes) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: p.id }), ENV);
    assert.equal(llamadas[0].cuerpo.payment_methods.installments, p.cuotas,
      'cuotas del paquete ' + p.id);
  }
  /* La regla, no la lista: dos cuotas desde cierto importe. Se comprueba así y
     no con los identificadores a mano porque el catálogo pasó de once tramos a
     veinticinco, y una lista escrita aquí se queda vieja al primer retoque
     mientras que la regla no. Lo que no puede pasar nunca es que un paquete
     barato salga con cuotas o que uno caro se quede sin ellas. */
  const UMBRAL = 2500;
  for (const p of TABLA.paquetes) {
    /* Con UNA excepción: un anticipo nunca va a plazos, cueste lo que cueste.
       Mientras los únicos anticipos fueron los de Google (750 y 1,150) la
       regla del umbral bastaba sola; el del sitio web (3,100) la cruza y sigue
       siendo un anticipo. */
    const esperado = Number(p.resto) > 0 ? 1 : (p.total >= UMBRAL ? 2 : 1);
    assert.equal(p.cuotas, esperado,
      'cuotas del paquete ' + p.id + ' (' + p.total + ' MXN)');
  }
  assert.ok(TABLA.paquetes.some(p => p.cuotas === 2), 'alguno tiene que llevarlas');
  assert.ok(TABLA.paquetes.some(p => p.cuotas === 1), 'y alguno no');
});

/* Node cachea los módulos JSON y devuelve SIEMPRE el mismo objeto, así que la
   tabla que se toca aquí es exactamente la que lee el Worker. Es lo que permite
   probar el recorte de cuotas de punta a punta —entra un POST, sale la llamada
   a Mercado Pago— en vez de llamar a una función suelta. Se restaura en
   `finally` porque una tabla trucada que sobreviva contamina lo que venga
   detrás, y el fallo aparecería en otra prueba cualquiera. */
async function conCuotasEnLaTabla(id, valor, comprueba) {
  const fila = TABLA.paquetes.find(p => p.id === id);
  const original = fila.cuotas;
  try {
    fila.cuotas = valor;
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: id }), ENV);
    comprueba(llamadas[0].cuerpo.payment_methods.installments);
  } finally {
    fila.cuotas = original;
  }
}

test('NUNCA se piden tres cuotas o más: de ahí para arriba el interés lo pagas TÚ', async () => {
  /* Dos cuotas las financia el banco del comprador y no cuestan nada. Tres ya
     son meses sin intereses, que absorbe el vendedor: 4.69 % de cada venta.
     Una errata de un dígito en la tabla de precios no puede convertirse en esa
     comisión, así que el Worker recorta pase lo que pase. */
  for (const disparate of [3, 6, 12, 24, 99, '12', Infinity]) {
    await conCuotasEnLaTabla('20', disparate, n => assert.equal(n, 2,
      'con cuotas=' + String(disparate) + ' en la tabla, el cobro debe salir con 2'));
  }
});

test('una tabla sin la columna cuotas cobra de contado, no a plazos', async () => {
  /* El valor seguro es el que no cuesta dinero. Si la columna falta —tabla
     vieja desplegada, JSON a medias— lo que sale es un pago único. */
  for (const roto of [undefined, null, 0, '', 'dos', NaN, -5]) {
    await conCuotasEnLaTabla('15', roto, n => assert.equal(n, 1,
      'con cuotas=' + String(roto) + ' debe caer a 1'));
  }
});

test('el checkout abre en pago único aunque el paquete admita dos', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '20' }), ENV);
  assert.equal(llamadas[0].cuerpo.payment_methods.default_installments, 1,
    'partir el pago lo elige el comprador; no puede venir marcado de fábrica');
});

test('TODO el catálogo cobra exactamente lo que enseña la web', async () => {
  for (const p of TABLA.paquetes) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: p.id }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, p.total, 'paquete ' + p.id);
    /* Un servicio no se manda a ninguna parte: su concepto es su nombre y ya.
       Añadirle «envío gratis» sería prometer una paquetería inexistente en la
       pantalla donde el comprador mete su tarjeta. */
    const esperado = p.tipo === 'servicio'
      ? p.base
      : p.base + ' · ' + (p.envio > 0 ? 'incluye $' + p.envio + ' de envío' : 'envío gratis');
    assert.equal(llamadas[0].cuerpo.items[0].title, esperado, 'concepto del paquete ' + p.id);
  }
});

test('los servicios están en el catálogo, con su anticipo por debajo del contado', () => {
  const serv = TABLA.paquetes.filter(p => p.tipo === 'servicio');
  assert.ok(serv.length >= 2, 'hay servicios en el catálogo');
  for (const s of serv) {
    assert.equal(s.envio, 0, s.id + ': un servicio no puede llevar envío');
    /* Antes aquí decía «los servicios van a un pago», y dejó de ser verdad el
       día que los combos con placas cruzaron el umbral de las dos cuotas. La
       regla de verdad son dos: un servicio sigue el MISMO umbral que las
       placas sueltas, y un ANTICIPO no va a plazos nunca — un anticipo en
       mensualidades es un absurdo que además liaría el resto. */
    if (Number(s.resto) > 0) assert.equal(s.cuotas, 1, s.id + ': un anticipo nunca va a plazos');
    else assert.equal(s.cuotas, s.total >= 2500 ? 2 : 1,
      s.id + ': el servicio sigue el mismo umbral de cuotas que el resto del catálogo');
  }
  /* El anticipo tiene que ser MENOR que su contado. Al revés —o iguales— no es
     un anticipo: es cobrar de más por pagar a plazos. */
  for (const a of serv.filter(s => s.id.endsWith('a'))) {
    const contado = serv.find(s => s.id === a.id.slice(0, -1));
    assert.ok(contado, 'el anticipo ' + a.id + ' no tiene su contado');
    assert.ok(a.total < contado.total,
      `el anticipo ${a.id} (${a.total}) no es menor que su contado (${contado.total})`);
  }
});

test('el anticipo con ficha propia llega MARCADO al aviso de la venta', async () => {
  /* La regla —anticipo sólo si la cuenta la creamos nosotros— la aplica el
     navegador, y el navegador no es de fiar: un formulario mandado a mano puede
     pedir el anticipo declarando a la vez que ya tiene ficha.

     No se rechaza a propósito: `ficha_tiene` lo declara el comprador, así que
     bloquear no impide nada —basta con declarar «no»— y sí puede tirar una
     venta legítima si el script no corre. Lo que hace daño es que pase
     desapercibido. Esto comprueba que NO pasa desapercibido. */
  const anticipo = TABLA.paquetes.find(p => p.tipo === 'servicio' && /anticipo/i.test(p.base));
  assert.ok(anticipo, 'hay algún paquete de anticipo en el catálogo');

  /* ⚠ CON LA FICHA DECLARADA PROPIA YA NO SE COBRA: se para.
     Antes esto sólo se marcaba. El argumento —bloquear no impide nada, basta
     con declarar «no»— vale para quien manda el formulario a mano, no para el
     cliente honesto sin JavaScript, que era quien de verdad llegaba aquí y a
     quien se le cobraba la mitad de un trabajo cuya entrega no se puede
     retener. */
  montaCaches();
  let llamadas = montaFetch(okMP);
  const corte = await worker.fetch(
    post({ paquete: anticipo.id, ficha_tiene: 'si', negocio: 'El Molino Ruso' }), ENV);
  assert.equal(corte.status, 409, 'la contradicción explícita se rechaza, no se cobra');
  assert.equal(llamadas.length, 0, 'y no se llega a crear ninguna preferencia de pago');
  const html = await corte.text();
  assert.match(html, /de contado/i, 'y se le dice por dónde sí puede seguir');
  assert.match(html, /wa\.me/, 'con una salida por WhatsApp, que no es un error seco');

  /* Y SIN RESPONDER A LA PREGUNTA, también. Quien manda el formulario a mano es
     justamente quien puede omitir el campo, y un anticipo sin declarar que la
     cuenta está por crear no es más legítimo que uno con ficha propia: es el
     mismo caso con menos información. La condición mira si se dijo «no», no si
     se dijo «sí». */
  for (const raro of [undefined, '', 'SI', 'sí', 'quizá']) {   // 'si' exacto ya se rechaza arriba
    montaCaches();
    llamadas = montaFetch(okMP);
    const campos = { paquete: anticipo.id, negocio: 'El Molino Ruso' };
    if (raro !== undefined) campos.ficha_tiene = raro;
    await worker.fetch(post(campos), ENV);
    assert.match(llamadas[0].cuerpo.additional_info, /REVISAR: anticipo/,
      `«${raro}» no puede colarse como un anticipo legítimo`);
  }

  /* Y con la combinación legítima NO grita: una marca que sale siempre es una
     marca que se deja de leer a la semana. */
  montaCaches();
  llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: anticipo.id, ficha_tiene: 'no', negocio: 'El Molino Ruso' }), ENV);
  assert.doesNotMatch(llamadas[0].cuerpo.additional_info, /REVISAR/,
    'con la combinación legítima no puede saltar la marca');
});

test('el aviso de la venta dice CUÁNTO falta por cobrar de un anticipo', async () => {
  /* Ese número sólo existía en el sessionStorage del navegador del comprador:
     cualquiera podía cambiarlo desde las herramientas del navegador y el
     vendedor vería lo que el comprador quisiera. Ahora sale de la tabla y viaja
     por el mismo canal que el cobro. */
  const anticipo = TABLA.paquetes.find(p => p.tipo === 'servicio' && Number(p.resto) > 0);
  assert.ok(anticipo, 'la tabla declara lo que queda por cobrar');
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: anticipo.id, ficha_tiene: 'no', negocio: 'El Molino Ruso' }), ENV);
  assert.match(llamadas[0].cuerpo.additional_info,
    new RegExp('ANTICIPO: faltan \\$' + anticipo.resto.toLocaleString('en-US')),
    'con el importe exacto de la tabla');
});

test('«Todo hecho» desde fuera de San Luis se marca SIN VISITA', async () => {
  /* La visita es la mitad de lo que separa este paquete del de $1,490. Quien
     prepara el trabajo tenía que caer en la cuenta leyendo la ciudad en mitad
     de una línea. */
  const conVisita = TABLA.paquetes.find(p => p.visita && !p.resto);
  assert.ok(conVisita, 'algún paquete declara que lleva visita');

  for (const [ciudad, marcado] of [
    ['Monterrey', true], ['Ciudad de México', true], ['', true],
    ['San Luis Potosí', false], ['san luis potosi', false],
    ['Soledad de Graciano Sánchez', false],
  ]) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: conVisita.id, ficha_tiene: 'no', negocio: 'X', negocio_ciudad: ciudad }), ENV);
    const info = llamadas[0].cuerpo.additional_info;
    assert.equal(/SIN VISITA/.test(info), marcado, `«${ciudad}» → ${marcado ? 'marcado' : 'sin marca'}`);
  }

  /* Y el paquete sin visita nunca lleva la marca: una que sale siempre se deja
     de leer a la semana. */
  const sinVisita = TABLA.paquetes.find(p => p.tipo === 'servicio' && !p.visita);
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: sinVisita.id, ficha_tiene: 'no', negocio: 'X', negocio_ciudad: 'Monterrey' }), ENV);
  assert.doesNotMatch(llamadas[0].cuerpo.additional_info, /SIN VISITA/);
});

test('se vuelve al origen desde el que se compró, no al apex siempre', async () => {
  /* El pedido viaja en sessionStorage, que es POR ORIGEN. Volviendo a otro
     dominio la página cae en un almacén vacío y pierde el resumen, el WhatsApp
     escrito y —en un servicio— el paso del correo de administrador. */
  for (const origen of ['https://www.sycsolutions.company', 'https://syc-solutions.pages.dev']) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1' }, { headers: { Origin: origen } }), ENV);
    assert.ok(llamadas[0].cuerpo.back_urls.success.startsWith(origen),
      `desde ${origen} se vuelve a ${origen}, no a otro sitio`);
  }
  /* Sin cabecera Origin se sigue usando el apex, que es lo de antes. */
  montaCaches();
  const llamadas = montaFetch(okMP);
  const req = new Request('https://pagos.sycsolutions.company/ir', {
    method: 'POST', body: (() => { const f = new FormData(); f.append('paquete', '1'); return f; })(),
    headers: { 'CF-Connecting-IP': '203.0.113.9' },
  });
  await worker.fetch(req, ENV);
  assert.ok(llamadas[0].cuerpo.back_urls.success.startsWith('https://sycsolutions.company'));
});

test('un SERVICIO vuelve a su propia página de gracias, y una placa a la suya', async () => {
  /* La página sólo distingue una compra de otra leyendo el sessionStorage que
     escribe un script. Sin JavaScript no hay nada que leer, y al comprador de
     un servicio se le decía «preparamos tus placas» sin llegar a ver nunca que
     tenía que darnos acceso. Aquí el servidor sí lo sabe. */
  const serv = TABLA.paquetes.find(p => p.tipo === 'servicio' && !p.resto);
  montaCaches();
  let llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: serv.id, ficha_tiene: 'no' }), ENV);
  assert.match(llamadas[0].cuerpo.back_urls.success, /\/gracias-servicio\.html$/);
  assert.match(llamadas[0].cuerpo.back_urls.pending, /\/gracias-servicio\.html\?estado=pendiente$/);

  montaCaches();
  llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '1' }), ENV);
  assert.match(llamadas[0].cuerpo.back_urls.success, /\/gracias\.html$/);
  assert.match(llamadas[0].cuerpo.back_urls.pending, /\/gracias\.html\?estado=pendiente$/);
});

test('«no dijo si tiene ficha» no se imprime como «la creamos nosotros»', async () => {
  /* El resumen de la venta es una instrucción de trabajo: «SIN ficha: la
     creamos» manda crear una cuenta. Dicho sobre alguien que no respondió, es
     una cuenta duplicada sobre un negocio que ya estaba en Google. */
  const serv = TABLA.paquetes.find(p => p.tipo === 'servicio');
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: serv.id, negocio: 'El Molino Ruso' }), ENV);
  assert.match(llamadas[0].cuerpo.additional_info, /NO DIJO si tiene ficha/);
  assert.doesNotMatch(llamadas[0].cuerpo.additional_info, /SIN ficha: la creamos/);
});

test('a un servicio NO se le descuenta el envío por ser de San Luis', async () => {
  const serv = TABLA.paquetes.find(p => p.tipo === 'servicio');
  montaCaches();
  const llamadas = montaFetch(okMP);
  /* Un código postal de los de casa. Con la placa esto descuenta la paquetería;
     con un servicio no hay nada que descontar y el importe no puede moverse. */
  await worker.fetch(post({ paquete: serv.id, cp: '78000' }), ENV);
  assert.equal(llamadas[0].cuerpo.items[0].unit_price, serv.total);
  assert.ok(!/envío|entrega en mano/i.test(llamadas[0].cuerpo.items[0].title),
    'el concepto de un servicio no habla de envíos: ' + llamadas[0].cuerpo.items[0].title);
});

/* ═══════════════════════ LOS DATOS DEL PEDIDO ═════════════════════════════ */

const PEDIDO = {
  modo: 'configuradas',
  negocio: 'El Molino Ruso', negocio_ciudad: 'San Luis Potosí',
  negocio_dir: 'Av. Carranza 1200',
  nombre: 'Gael Ramírez', tel: '4423697248', correo: 'gael@ejemplo.com',
  calle: 'Calle Falsa 123', colonia: 'Centro', cp: '78000',
  ciudad: 'San Luis Potosí', estado: 'San Luis Potosí', refs: 'Portón verde',
};

test('el pedido llega a Mercado Pago: resumen legible, campos con nombre y copia entera', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '4', ...PEDIDO }), ENV);
  const c = llamadas[0].cuerpo;

  /* Lo que el titular LEE en el aviso de la venta. Es la razón de ser de todo
     esto: antes la dirección y la ficha de Google se perseguían por WhatsApp
     después de cobrar. */
  assert.equal(c.additional_info,
    '4 pzas | Enlazar a: El Molino Ruso, San Luis Potosí | ' +
    'EN MANO: Gael Ramírez, Calle Falsa 123, Centro, 78000, San Luis Potosí, San Luis Potosí | ' +
    'Tel 4423697248 | Ref: Portón verde',
    'es el texto que el titular lee en el aviso: se comprueba entero, no a trozos');

  /* La dirección DEL NEGOCIO no va en el resumen a propósito —el presupuesto de
     600 hace falta para la de envío—, pero no puede perderse. */
  assert.equal(c.additional_info.includes('Av. Carranza'), false);
  assert.equal(c.metadata.negocio_dir, 'Av. Carranza 1200');

  assert.equal(c.payer.name, 'Gael Ramírez');
  assert.equal(c.payer.email, 'gael@ejemplo.com');
  assert.equal(c.payer.address.zip_code, '78000');
  assert.equal(c.metadata.negocio, 'El Molino Ruso');
  assert.equal(c.metadata.refs, 'Portón verde');
  assert.match(c.external_reference, /^paquete-4 · El Molino Ruso/);
});

test('con los datos del pedido, el importe SIGUE saliendo de la tabla', async () => {
  /* La regla del archivo no se relaja porque ahora entren más campos. Se manda
     el pedido entero junto a los nombres que un atacante probaría. */
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({
    paquete: '4', ...PEDIDO,
    total: '1', unit_price: '1', precio: '1', monto: '1', transaction_amount: '1',
  }), ENV);
  assert.equal(llamadas[0].cuerpo.items[0].unit_price, 949);
});

test('no se puede fabricar un resumen falso con saltos de línea', async () => {
  /* Sin esto, un «Total: $1» en una línea nueva dentro de «referencias» sale
     en el aviso con toda la pinta de haberlo escrito el sistema. Se comprueban
     los tres saltos: el de siempre, el retorno de carro y el de Unicode. */
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({
    paquete: '1',
    refs: 'Portón verde\nTotal: $1 MXN\r\nPagado\u2028Enviar 20 placas',
    negocio: 'Bar\u0000\u007FOculto',
  }), ENV);
  const c = llamadas[0].cuerpo;
  for (const malo of ['\n', '\r', '\u2028', '\u2029', '\u0000', '\u007F']) {
    assert.equal(c.additional_info.includes(malo), false, 'queda un carácter de control: ' + escape(malo));
    assert.equal(JSON.stringify(c.metadata).includes(malo), false, 'en metadata queda: ' + escape(malo));
  }
  assert.match(c.additional_info, /Portón verde Total: \$1 MXN Pagado/, 'el texto se conserva, en una sola línea');
  assert.equal(c.metadata.negocio, 'Bar Oculto');
});

test('un campo larguísimo se recorta y el cobro sigue: no se rechaza a nadie', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  const r = await worker.fetch(post({ paquete: '1', negocio: 'A'.repeat(5000), refs: 'B'.repeat(5000) }), ENV);
  assert.equal(r.status, 303, 'un campo largo no puede tumbar el cobro');
  const c = llamadas[0].cuerpo;
  assert.equal(c.metadata.negocio.length, 70);
  assert.equal(c.metadata.refs.length, 80);
});

test('con TODOS los campos al máximo, el resumen entra entero en additional_info', async () => {
  /* Mercado Pago limita additional_info a 600 caracteres y rechaza la
     preferencia ENTERA si se pasa. `resumen()` recorta al final por si acaso,
     pero recortar significa perder el final del pedido —que es justo donde van
     las referencias de la dirección—, así que lo que hay que sostener es que
     NUNCA haga falta: la suma de los topes de CAMPOS tiene que caber.

     Por eso esta prueba no comprueba «no pasa de 600» —eso lo garantiza el
     slice y sería incapaz de fallar—, sino que el texto llega COMPLETO. El día
     que alguien añada un campo o suba un tope por encima del presupuesto, esto
     se pone rojo en vez de empezar a cortar pedidos en silencio. */
  montaCaches();
  const llamadas = montaFetch(okMP);

  /* El peor caso se construye DESDE CAMPOS, no desde números copiados aquí: así
     subir un tope allí aprieta esta prueba automáticamente. */
  const lleno = {};
  for (const [campo, max] of Object.entries(CAMPOS)) {
    if (campo === 'modo') lleno[campo] = 'configuradas';
    else if (campo === 'tel' || campo === 'cp') lleno[campo] = '9'.repeat(max);
    else if (campo === 'correo') lleno[campo] = 'a'.repeat(max - 12) + '@ejemplo.com';
    else lleno[campo] = campo[0].toUpperCase().repeat(max);
  }
  /* `refs` es lo ÚLTIMO del resumen, así que es donde muerde el recorte. Se le
     pone una marca al final: con relleno de letras repetidas, un texto cortado
     sigue terminando en la misma letra y la comprobación no vería nada. */
  lleno.refs = 'R'.repeat(CAMPOS.refs - 3) + 'FIN';

  await worker.fetch(post({ paquete: '20', ...lleno }), ENV);
  const info = llamadas[0].cuerpo.additional_info;
  assert.ok(info.length <= 600, 'tope de la API; salió con ' + info.length);
  assert.ok(info.endsWith('FIN'),
    'el resumen se cortó (' + info.length + ' car.): los topes de CAMPOS ya no caben en 600');
});

test('un correo mal escrito se omite en vez de tumbar la preferencia', async () => {
  /* Mercado Pago rechaza la preferencia ENTERA si payer.email viene mal. Perder
     el cobro por una errata de tecleo sería el peor cambio posible. */
  for (const malo of ['sin-arroba', 'a@b', 'a@b.c', '@ejemplo.com', 'hola @ejemplo.com']) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1', nombre: 'Ana', correo: malo }), ENV);
    const payer = llamadas[0].cuerpo.payer;
    assert.equal(payer.email, undefined, 'no debe mandarse el correo «' + malo + '»');
    assert.equal(payer.name, 'Ana', 'lo demás del comprador sí sigue viajando');
  }
});

test('un POST con SÓLO el paquete cobra igual', async () => {
  /* Los botones viejos, un navegador con el JavaScript apagado o un fallo de
     los pasos no pueden convertirse en una venta perdida. */
  montaCaches();
  const llamadas = montaFetch(okMP);
  const r = await worker.fetch(post({ paquete: '6' }), ENV);
  assert.equal(r.status, 303);
  const c = llamadas[0].cuerpo;
  assert.equal(c.items[0].unit_price, 1249);
  assert.equal(c.payer, undefined, 'sin datos no se manda un payer vacío: la API lo rechazaría');
  assert.equal(c.metadata, undefined);
  assert.equal(c.external_reference, 'paquete-6');
});

test('el modo sólo puede ser uno de los dos que existen', async () => {
  for (const [entra, sale] of [['configuradas', 'configuradas'], ['blanco', 'blanco'], ['gratis', undefined], ['', undefined]]) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1', modo: entra }), ENV);
    assert.equal(llamadas[0].cuerpo.metadata?.modo, sale, 'modo=' + entra);
  }
});

test('el pago vuelve a gracias.html, que es donde está el WhatsApp del pedido', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '1' }), ENV);
  assert.equal(llamadas[0].cuerpo.back_urls.success, ORIGEN + '/gracias.html');
});

/* ═════════════════════ LA ENTREGA EN MANO, SIN ENVÍO ══════════════════════ */

/* Los rangos viven en paquetes.json, que se genera. Estas pruebas trabajan
   sobre lo que haya realmente configurado en vez de sobre números escritos
   aquí: si mañana se añade una colonia, siguen valiendo. */
const RANGOS = (TABLA.entregaLocal && TABLA.entregaLocal.rangos) || [];
const CP_LOCAL = RANGOS.length ? String(RANGOS[0].desde).padStart(5, '0') : null;

/* ⚠ EL ENVÍO SE ENCIENDE A PROPÓSITO PARA PROBARLO.
   Hoy la tabla lleva el envío DENTRO del precio y no se cobra aparte, así que
   no hay nada que descontar y todas estas comprobaciones pasarían por vacías:
   verdes sin haber ejercido una sola línea del descuento. Eso es exactamente lo
   que ya avisó una revisión —«las pruebas del descuento están todas saltadas en
   la configuración que se despliega»— y es peor que no tenerlas, porque dan
   confianza sin darla.

   Que el envío se cobre o no es una DECISIÓN COMERCIAL y puede cambiar mañana.
   El mecanismo que lo descuenta a quien vive en la ciudad tiene que estar
   probado en los dos casos, así que aquí se enciende sobre la tabla de verdad,
   se ejerce, y se apaga. Node cachea el módulo JSON y devuelve el mismo objeto,
   de modo que lo que se toca es justo lo que lee el Worker. */
const ENVIO_PRUEBA = 79;

async function conEnvio(id, cuerpo, envio = ENVIO_PRUEBA) {
  const fila = TABLA.paquetes.find(p => p.id === id);
  const original = fila.envio;
  try {
    fila.envio = envio;
    return await cuerpo(fila);
  } finally {
    fila.envio = original;   /* una tabla trucada que sobreviva contamina lo que venga detrás */
  }
}

test('con el envío DENTRO del precio, hoy no se descuenta nada a nadie', async () => {
  /* El estado actual del catálogo, comprobado tal cual está: se cobra lo mismo
     desde la ciudad que desde Ciudad Valles, y el concepto dice «envío gratis».
     Si algún día vuelve a haber un envío que cobrar, esta prueba lo dirá. */
  assert.ok(TABLA.paquetes.every(p => p.envio === 0),
    'esta prueba describe el catálogo con el envío incluido; si alguno lo cobra, actualízala');
  for (const cp of [CP_LOCAL, '79000', ''].filter(v => v !== null)) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1', cp }), ENV);
    const uno = TABLA.paquetes.find(p => p.id === '1');
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, uno.total, 'cp=«' + cp + '»');
    assert.match(llamadas[0].cuerpo.items[0].title, /· envío gratis/);
  }
});

test('un código postal de fuera paga su envío completo', async () => {
  /* 79000 es Ciudad Valles: mismo ESTADO, a 250 km. El estado no puede decidir
     esto, sólo el código postal. */
  await conEnvio('1', async fila => {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1', cp: '79000', estado: 'San Luis Potosí' }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, fila.total, 'el envío se cobra entero');
    assert.equal(llamadas[0].cuerpo.items[0].title,
      fila.base + ' · incluye $' + ENVIO_PRUEBA + ' de envío',
      'y el concepto lo DICE, con el importe: quien paga envío tiene que verlo escrito');
  });
});

test('sin código postal tampoco se regala el envío', async () => {
  await conEnvio('1', async fila => {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1' }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, fila.total);
  });
});

test('un código postal que no tiene cinco dígitos NO da entrega en mano', async () => {
  /* «780000» es el caso interesante: recortado a cinco daría «78000», que sí es
     de la ciudad, y acertaría un rango por pura casualidad. Un código postal
     mexicano tiene exactamente cinco dígitos; con más o con menos, no cuenta. */
  await conEnvio('1', async fila => {
    for (const malo of ['7800', '780000', '78OOO', '', '0', '78000-1234']) {
      montaCaches();
      const llamadas = montaFetch(okMP);
      await worker.fetch(post({ paquete: '1', cp: malo }), ENV);
      assert.equal(llamadas[0].cuerpo.items[0].unit_price, fila.total,
        'cp=«' + malo + '» no puede descontar');
    }
  });
});

test('el FORMATO del código postal no puede costarle el descuento a nadie', { skip: !CP_LOCAL }, async () => {
  /* Un comprador de la ciudad que pega su código desde una libreta, o cuyo
     autorrelleno mete un prefijo, escribe cosas como «78 000» o «C.P. 78000».
     Antes se recortaba a cinco CARACTERES antes de quitar los no-dígitos y
     «78 000» acababa siendo «7800»: cuatro cifras, sin descuento y sin que nada
     lo dijera. Son los cinco dígitos lo que cuenta, no cómo estén escritos. */
  await conEnvio('1', async fila => {
    for (const forma of [CP_LOCAL, ' ' + CP_LOCAL + ' ',
                         CP_LOCAL.slice(0, 2) + ' ' + CP_LOCAL.slice(2),
                         CP_LOCAL.slice(0, 2) + '-' + CP_LOCAL.slice(2), 'C.P. ' + CP_LOCAL]) {
      montaCaches();
      const llamadas = montaFetch(okMP);
      await worker.fetch(post({ paquete: '1', cp: forma }), ENV);
      assert.equal(llamadas[0].cuerpo.items[0].unit_price, fila.total - ENVIO_PRUEBA,
        'cp escrito como «' + forma + '» tiene que descontar igual');
    }
  });
});

test('un envío negativo en la tabla NO puede cobrar por encima de lo anunciado', { skip: !CP_LOCAL }, async () => {
  /* La guarda anterior era `rebajado > 0 ? rebajado : total`, que sólo miraba
     hacia abajo: con `envio: -50` la resta se volvía suma, salía mayor que el
     total y pasaba limpia. Cobrar por encima del precio exhibido no es un
     descuadre contable, es un problema con PROFECO. */
  const tope = TABLA.paquetes.find(p => p.id === '1').total;
  for (const roto of [-50, -1, undefined, null, 'x', NaN, tope, tope + 100]) {
    await conEnvio('1', async fila => {
      montaCaches();
      const llamadas = montaFetch(okMP);
      await worker.fetch(post({ paquete: '1', cp: CP_LOCAL }), ENV);
      const cobrado = llamadas[0].cuerpo.items[0].unit_price;
      assert.ok(cobrado > 0 && cobrado <= fila.total,
        'con envio=' + String(roto) + ' se cobró ' + cobrado + ', fuera de (0, ' + fila.total + ']');
    }, roto);
  }
});

test('un rango de códigos absurdo se ignora al leerlo, no sólo al generarlo', async () => {
  /* Entre el generador y este archivo hay un JSON editable a mano y un
     copiar-pegar en el panel de Cloudflare. Un rango que se salga de la banda
     del estado, o que cubra medio país, no puede sobrevivir a ese viaje.

     `RANGOS_LOCALES` se calcula al cargar el módulo, así que hay que reimportar
     con otra consulta para que se recalcule con la tabla trucada. */
  const original = TABLA.entregaLocal.rangos;
  try {
    TABLA.entregaLocal.rangos = [{ desde: 0, hasta: 99999, zona: 'todo México' }];
    const { default: recargado } = await import('../pagos.js?absurdo=1');
    await conEnvio('1', async fila => {
      montaCaches();
      const llamadas = montaFetch(okMP);
      await recargado.fetch(post({ paquete: '1', cp: '01000' }), ENV);
      assert.equal(llamadas[0].cuerpo.items[0].unit_price, fila.total,
        'un rango que cubre todo México tiene que ignorarse');
    });
  } finally {
    TABLA.entregaLocal.rangos = original;
  }
});

test('el navegador NO puede reclamar la entrega en mano por su cuenta', async () => {
  /* El descuento sale de la lista del servidor y del código postal. Mandar
     campos con pinta de bandera —«local», «entrega», «envio»— no puede moverlo. */
  await conEnvio('1', async fila => {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({
      paquete: '1', cp: '79000',
      local: '1', entrega: 'mano', envio: '0', envio_gratis: 'si', descuento: '79',
    }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, fila.total);
  });
});

test('con la lista de zonas vacía no se le descuenta el envío a NADIE', { skip: RANGOS.length > 0 }, async () => {
  await conEnvio('1', async fila => {
    for (const cp of ['78000', '78100', '78430', '79000', '00000', '99999']) {
      montaCaches();
      const llamadas = montaFetch(okMP);
      await worker.fetch(post({ paquete: '1', cp }), ENV);
      assert.equal(llamadas[0].cuerpo.items[0].unit_price, fila.total, 'cp=' + cp);
    }
  });
});

test('dentro de la zona, el envío no se cobra y el concepto lo DICE', { skip: !CP_LOCAL }, async () => {
  await conEnvio('1', async fila => {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1', cp: CP_LOCAL }), ENV);
    const item = llamadas[0].cuerpo.items[0];
    assert.equal(item.unit_price, fila.total - ENVIO_PRUEBA, 'se descuenta exactamente el envío de la tabla');
    assert.equal(item.title, fila.base + ' · sin cobro de envío, entrega en mano',
      'el concepto tiene que DECIR que no se cobró envío: un importe menor sin explicación parece un error');
    assert.match(llamadas[0].cuerpo.additional_info, /EN MANO/,
      'el aviso tiene que decir que se lleva en mano, o acabará en una paquetería pagada de más');
  });
});

test('dentro de la zona, los paquetes que YA tenían envío gratis no cambian', { skip: !CP_LOCAL }, async () => {
  for (const p of TABLA.paquetes.filter(x => x.envio === 0).slice(0, 5)) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: p.id, cp: CP_LOCAL }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, p.total, 'paquete ' + p.id);
    assert.equal(llamadas[0].cuerpo.items[0].title, p.base + ' · envío gratis, entrega en mano',
      'pero el concepto sí lo dice: se entrega en mano aunque el envío ya fuera gratis');
  }
});

test('el importe cobrado NUNCA sale de la tabla, se descuente o no', async () => {
  for (const p of TABLA.paquetes) {
    for (const cp of ['78000', '78430', '79000', '01000', '', '99999']) {
      montaCaches();
      const llamadas = montaFetch(okMP);
      await worker.fetch(post({ paquete: p.id, cp }), ENV);
      const cobrado = llamadas[0].cuerpo.items[0].unit_price;
      assert.ok(cobrado === p.total || cobrado === p.total - p.envio,
        'paquete ' + p.id + ' con cp=' + cp + ' cobró ' + cobrado);
      assert.ok(cobrado > 0, 'ningún cobro puede salir en cero o negativo');
    }
  }
});

test('el concepto SIEMPRE dice qué pasó con el envío', { skip: !CP_LOCAL }, async () => {
  /* Cuatro casos, y ninguno puede quedar ambiguo. Se comprueba con el texto
     EXACTO, no con un `match`: media frase correcta y media vieja pasaría un
     match y sería justo el fallo. */
  /* Otro paquete distinto del que se le enciende el envío justo abajo: si fuera
     el mismo, «con envío» y «sin envío» serían la misma fila y dos de los cuatro
     casos se comprobarían contra sí mismos. */
  const sinEnvio = TABLA.paquetes.find(p => p.envio === 0 && p.id !== '1');
  assert.ok(sinEnvio, 'hace falta al menos un paquete con el envío ya incluido');
  await conEnvio('1', async conE => {
    const casos = [
      [conE.id, '79000', conE.base + ' · incluye $' + ENVIO_PRUEBA + ' de envío'],
      [conE.id, CP_LOCAL, conE.base + ' · sin cobro de envío, entrega en mano'],
      [sinEnvio.id, '79000', sinEnvio.base + ' · envío gratis'],
      [sinEnvio.id, CP_LOCAL, sinEnvio.base + ' · envío gratis, entrega en mano'],
    ];
    for (const [id, cp, esperado] of casos) {
      montaCaches();
      const llamadas = montaFetch(okMP);
      await worker.fetch(post({ paquete: id, cp }), ENV);
      assert.equal(llamadas[0].cuerpo.items[0].title, esperado, 'paquete ' + id + ' con cp ' + cp);
    }
  });
});

test('el concepto NO se construye buscando un trozo de texto', async () => {
  /* La versión anterior hacía `titulo.replace(/· envío incluido$/, …)`. Si
     alguien retocaba esa redacción, el replace no encontraba nada, devolvía el
     título original y el comprador local veía «envío incluido» junto a un
     importe 79 pesos menor. Ahora la tabla trae sólo la base y el final lo pone
     el Worker, así que se comprueba que en `base` NO haya nada de envío. */
  for (const p of TABLA.paquetes) {
    assert.equal(/env[íi]o|entrega|gratis/i.test(p.base), false,
      'la base del paquete ' + p.id + ' no puede hablar del envío: «' + p.base + '»');
  }
  assert.equal(TABLA.paquetes.some(p => 'titulo' in p), false,
    'el campo `titulo` desapareció: si vuelve, alguien reintrodujo el acoplamiento');
});

/* ══════════════════════════════ RUTAS Y GUARDAS ═══════════════════════════ */

test('un paquete que no existe no llega a Mercado Pago', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  const r = await worker.fetch(post({ paquete: '999' }), ENV);
  assert.equal(r.status, 404);
  assert.equal(llamadas.length, 0, 'no se crea preferencia por un paquete inventado');
});

test('sin secreto no se cobra, y se dice sin dejar al visitante tirado', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  const r = await worker.fetch(post({ paquete: '1' }), {});
  assert.equal(r.status, 503);
  assert.equal(llamadas.length, 0);
  const html = await r.text();
  assert.match(html, /wa\.me/, 'la salida de emergencia es WhatsApp');
});

test('un origen ajeno no puede cobrar en tu nombre', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  const r = await worker.fetch(post({ paquete: '1' }, { headers: { Origin: 'https://sitio-ajeno.example' } }), ENV);
  assert.equal(r.status, 403);
  assert.equal(llamadas.length, 0);
});

test('GET no cobra', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  const r = await worker.fetch(new Request('https://pagos.sycsolutions.company/ir'), ENV);
  assert.equal(r.status, 405);
  assert.equal(llamadas.length, 0);
});

test('cualquier otra ruta es 404', async () => {
  montaCaches();
  montaFetch(okMP);
  const r = await worker.fetch(new Request('https://pagos.sycsolutions.company/otra'), ENV);
  assert.equal(r.status, 404);
});

test('/estado dice SI hay secreto, nunca cuál', async () => {
  montaCaches();
  montaFetch(okMP);
  const r = await worker.fetch(new Request('https://pagos.sycsolutions.company/estado'), ENV);
  const d = await r.json();
  assert.equal(d.secreto, true);
  assert.equal(d.paquetes, TABLA.paquetes.length);
  assert.equal(JSON.stringify(d).includes(ENV.MP_ACCESS_TOKEN), false, 'el token no puede filtrarse por aquí');
});

/* ═══════════════════════════ CUANDO ALGO FALLA ════════════════════════════ */

test('si Mercado Pago falla, el visitante acaba en WhatsApp y no en un error', async () => {
  montaCaches();
  montaFetch(() => new Response('{"message":"invalid token","cause":[]}', { status: 401 }));
  const r = await worker.fetch(post({ paquete: '3' }), ENV);
  assert.equal(r.status, 502);
  const html = await r.text();
  assert.match(html, /wa\.me/);
  assert.match(html, /No se te ha cobrado nada/);
  assert.equal(html.includes('invalid token'), false, 'el error de Mercado Pago no se le enseña al visitante');
});

test('un cobro correcto redirige con 303 al checkout', async () => {
  montaCaches();
  montaFetch(okMP);
  const r = await worker.fetch(post({ paquete: '10' }), ENV);
  assert.equal(r.status, 303, '303 y no 302: tras un POST el destino se abre con GET');
  assert.match(r.headers.get('Location'), /^https:\/\/www\.mercadopago\.com\.mx\//);
  assert.equal(r.headers.get('Cache-Control'), 'no-store');
});

test('el tope por IP corta el martilleo, pero DEJA recorrer la lista entera', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);

  /* La página enseña ONCE paquetes. Mirar los precios de todos no puede agotar
     el cupo: con el tope en 12 pasaba, y lo tropezó el titular a los cinco
     minutos de publicar. Esta comprobación existe para que no vuelva. */
  for (let i = 0; i < 11; i++) {
    const r = await worker.fetch(post({ paquete: '1' }), ENV);
    assert.equal(r.status, 303, 'la pulsación ' + (i + 1) + ' de once debe pasar');
  }

  let ultima;
  for (let i = 0; i < 40; i++) ultima = await worker.fetch(post({ paquete: '1' }), ENV);
  assert.equal(ultima.status, 429, 'el martilleo sí se corta');
  assert.ok(llamadas.length <= 30, 'no más de 30 preferencias por ventana e IP, se hicieron ' + llamadas.length);
});

test('la ventana del tope vence sola y no se renueva a cada pulsación', async () => {
  const almacen = montaCaches();
  montaFetch(okMP);
  for (let i = 0; i < 40; i++) await worker.fetch(post({ paquete: '1' }), ENV);
  assert.equal((await worker.fetch(post({ paquete: '1' }), ENV)).status, 429);

  /* Se envejece la marca de inicio más allá de la ventana. Con el diseño
     anterior —el reloj era el max-age de la caché, que cada escritura
     renovaba— la cuenta NO se reiniciaba nunca mientras se siguiera pulsando:
     no era un tope por minuto sino por sesión de clics. */
  for (const [k, v] of almacen) {
    const d = JSON.parse(v);
    almacen.set(k, JSON.stringify({ n: d.n, inicio: d.inicio - 61000 }));
  }
  assert.equal((await worker.fetch(post({ paquete: '1' }), ENV)).status, 303,
    'pasada la ventana se vuelve a poder pagar');
});

/* ════════════════════════ LA TABLA, CONTRA LA WEB ═════════════════════════ */

test('la tabla del Worker no está vacía ni trae importes absurdos', () => {
  assert.equal(TABLA.moneda, 'MXN');
  assert.ok(TABLA.paquetes.length >= 1);
  for (const p of TABLA.paquetes) {
    assert.ok(Number.isInteger(p.total) && p.total > 0, 'importe entero y positivo en ' + p.id);
    assert.ok(p.total < 100000, 'importe con un tope de cordura en ' + p.id);
    assert.ok(p.base.length > 0);
    assert.ok(p.cuotas === 1 || p.cuotas === 2, 'cuotas sólo puede ser 1 o 2 en ' + p.id);
  }
});

/* ═══════════════════ LAS PLACAS DENTRO DEL PAQUETE ════════════════════════
   Cada combinación paquete × forma de pago × placas es una FILA propia del
   catálogo (gp-t2, gp-ta1…), no un recargo que calcule nadie: el importe nunca
   puede salir de una suma hecha en dos sitios, y menos del navegador. Estas
   pruebas fijan la aritmética de esas filas contra sus filas base — la regla,
   no la lista, para que aguanten el día que cambie el precio de la placa. */

test('cada fila con placas vale su fila base más las placas, y no debe ni un peso más', () => {
  const combos = TABLA.paquetes.filter(p => p.placas > 0);
  assert.ok(combos.length >= 4, 'el catálogo trae los combos de placas');
  for (const p of combos) {
    const idBase = p.id.slice(0, -String(p.placas).length);
    const base = TABLA.paquetes.find(x => x.id === idBase);
    assert.ok(base, `el combo ${p.id} tiene su fila base ${idBase}`);
    const porPlaca = (p.total - base.total) / p.placas;
    assert.ok(Number.isInteger(porPlaca) && porPlaca > 0,
      `las placas de ${p.id} cuestan un entero positivo (${porPlaca})`);
    /* ⚠ EL RESTO NO CRECE CON LAS PLACAS: se pagan hoy, no se deben. Un combo
       de anticipo que sumara las placas al resto se las cobraría DOS veces. */
    assert.equal(p.resto, base.resto,
      `el resto de ${p.id} es el de su base: las placas no se deben, se pagaron`);
    assert.ok(/placa/i.test(p.base), `el concepto de ${p.id} nombra las placas`);
  }
});

test('un combo con placas se cobra por su fila, de punta a punta', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  const combo = TABLA.paquetes.find(p => p.placas === 2 && !p.resto);
  /* El navegador intenta mentir con un total propio; manda ignorarse. */
  await worker.fetch(post({ paquete: combo.id, total: '1', ficha_tiene: 'no' }), ENV);
  assert.equal(llamadas.length, 1);
  assert.equal(llamadas[0].cuerpo.items[0].unit_price, combo.total,
    'cobra el total del combo desde la tabla: ' + combo.total);
});

test('el anticipo con placas sigue vetado si la ficha ya existe', async () => {
  montaCaches();
  montaFetch(okMP);
  const combo = TABLA.paquetes.find(p => p.placas > 0 && Number(p.resto) > 0);
  const corte = await worker.fetch(
    post({ paquete: combo.id, ficha_tiene: 'si', negocio: 'El Molino Ruso' }), ENV);
  assert.equal(corte.status, 409,
    'las placas no le abren la puerta trasera a un anticipo que no aplica');
});

test('el resumen del vendedor nombra las placas del combo, no sólo el concepto', async () => {
  /* El concepto del cobro (p.base) ya las dice, pero concepto y resumen son
     campos DISTINTOS del aviso, y quien prepara el trabajo lee el resumen: sin
     esta línea, un combo de Monterrey se preparaba sin caer en que hay dos
     placas que fabricar y hacer llegar. */
  montaCaches();
  const llamadas = montaFetch(okMP);
  const combo = TABLA.paquetes.find(p => p.placas === 2 && !p.resto);
  await worker.fetch(post({ paquete: combo.id, ficha_tiene: 'no',
    negocio: 'Kabuki', negocio_ciudad: 'Monterrey' }), ENV);
  assert.match(llamadas[0].cuerpo.additional_info, /CON 2 PLACAS DE RESEÑAS/,
    'el aviso de la venta dice las placas en su propia línea');
  assert.match(llamadas[0].cuerpo.additional_info, /acordar entrega|instalarlas/,
    'y recuerda que la entrega se acuerda: la dirección no viaja en el pedido');
});

/* ═══════════ LOS OTROS TRES SERVICIOS: WEB, AGENTE DE IA Y AUTOMATIZACIÓN ═══════════
   Llegaron con `familia` en la fila. Lo que hay que sostener es que el Worker
   los cobra igual que a todo —importe de la tabla, anticipo por debajo del
   contado— y que NO les aplica lo que es sólo de Google: la pregunta de la
   ficha, su marca de REVISAR y su página de gracias. */

const FAMILIAS_NUEVAS = ['web', 'ia', 'auto'];
const porFamilia = f => TABLA.paquetes.filter(p => p.familia === f);

test('las tres familias nuevas están en el catálogo: un contado y un anticipo cada una', () => {
  for (const f of FAMILIAS_NUEVAS) {
    const filas = porFamilia(f);
    assert.equal(filas.length, 2, f + ': un contado y un anticipo, y sin combos de placas');
    const contado = filas.find(p => !p.resto), anticipo = filas.find(p => Number(p.resto) > 0);
    assert.ok(contado && anticipo, f + ': falta el contado o el anticipo');
    assert.equal(anticipo.total + anticipo.resto, contado.total, f + ': anticipo + resto = contado');
    assert.ok(anticipo.total >= contado.total / 2, f + ': el anticipo es al menos la mitad');
    assert.equal(anticipo.cuotas, 1, f + ': un anticipo nunca va a plazos');
    assert.ok(filas.every(p => p.placas === undefined), f + ': las placas sólo se añaden en Google');
    assert.ok(filas.every(p => p.tipo === 'servicio' && p.envio === 0), f + ': es un servicio, sin envío');
  }
});

test('un anticipo de web, IA o automatización NO se marca REVISAR: ahí no hay ficha que declarar', async () => {
  for (const f of FAMILIAS_NUEVAS) {
    const a = porFamilia(f).find(p => Number(p.resto) > 0);
    montaCaches();
    const llamadas = montaFetch(okMP);
    const r = await worker.fetch(post({ paquete: a.id, negocio: 'Kabuki' }), ENV);
    assert.equal(r.status, 303, f + ': el anticipo cobra');
    const info = llamadas[0].cuerpo.additional_info;
    assert.ok(!/REVISAR/.test(info), f + ': sin REVISAR — ' + info);
    assert.ok(!/ficha/i.test(info), f + ': sin la línea de la ficha — ' + info);
    assert.ok(info.includes('ANTICIPO: faltan $' + a.resto.toLocaleString('en-US')),
      f + ': dice lo que falta — ' + info);
  }
});

test('web, IA y automatización vuelven a gracias-paquete.html; Google sigue en la suya', async () => {
  for (const f of FAMILIAS_NUEVAS) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: porFamilia(f)[0].id }), ENV);
    assert.equal(llamadas[0].cuerpo.back_urls.success, ORIGEN + '/gracias-paquete.html', f);
    assert.equal(llamadas[0].cuerpo.back_urls.pending, ORIGEN + '/gracias-paquete.html?estado=pendiente', f);
  }
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: 'gp-e' }), ENV);
  assert.equal(llamadas[0].cuerpo.back_urls.success, ORIGEN + '/gracias-servicio.html');
});

test('el resumen de cada familia lleva lo suyo: giro y dominio, giro, tarea y herramientas', async () => {
  const casos = {
    web:  { campos: { negocio: 'Kabuki', giro: 'Sushi', dominio: 'kabuki.mx', nombre: 'Gael', tel: '444 123 4567' },
            espera: ['Kabuki', 'Giro: Sushi', 'Dominio/página: kabuki.mx', 'Contacto: Gael', 'Tel 4441234567'] },
    ia:   { campos: { negocio: 'Kabuki', giro: 'Sushi' },
            espera: ['Kabuki', 'Giro: Sushi'] },
    auto: { campos: { negocio: 'Kabuki', tarea: 'Pasar pedidos a un Excel', herramientas: 'WhatsApp, Excel' },
            espera: ['Usa: WhatsApp, Excel', 'Tarea: Pasar pedidos a un Excel'] },
  };
  for (const [f, c] of Object.entries(casos)) {
    const p = porFamilia(f).find(x => !x.resto);
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: p.id, ...c.campos }), ENV);
    const info = llamadas[0].cuerpo.additional_info;
    for (const e of c.espera) assert.ok(info.includes(e), f + ': falta «' + e + '» en: ' + info);
    assert.ok(!/ficha/i.test(info), f + ': no habla de la ficha de Google');
    /* Y la copia campo a campo, que es la que se puede buscar después. */
    for (const k of Object.keys(c.campos)) assert.ok(llamadas[0].cuerpo.metadata[k], f + ': metadata.' + k);
  }
});

test('la tarea va al FINAL del resumen: si algún día algo se recorta, no es el teléfono', async () => {
  const p = porFamilia('auto').find(x => !x.resto);
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: p.id, negocio: 'Kabuki', tarea: 'x'.repeat(300), tel: '4441234567' }), ENV);
  const info = llamadas[0].cuerpo.additional_info;
  assert.ok(info.indexOf('Tel 4441234567') < info.indexOf('Tarea:'), info);
  assert.ok(new RegExp('Tarea: x{' + CAMPOS.tarea + '}$').test(info),
    'la tarea se recorta a su tope y cierra el resumen: «' + info.slice(-30) + '»');
});

test('con TODOS los campos de cada familia al máximo, el resumen entra entero en 600', async () => {
  const propios = { web: ['giro', 'dominio'], ia: ['giro'], auto: ['tarea', 'herramientas'] };
  for (const [f, extra] of Object.entries(propios)) {
    const a = porFamilia(f).find(x => Number(x.resto) > 0);
    const campos = {};
    for (const k of ['negocio', 'nombre', ...extra]) campos[k] = 'x'.repeat(CAMPOS[k]);
    campos.tel = '9'.repeat(CAMPOS.tel);
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: a.id, ...campos }), ENV);
    const info = llamadas[0].cuerpo.additional_info;
    assert.ok(info.length <= 600, f + ': ' + info.length);
    /* Lo que de verdad importa: el ÚLTIMO campo llegó completo. */
    const ultimo = extra.includes('tarea') ? 'Tarea: ' + 'x'.repeat(CAMPOS.tarea) : 'Tel ' + '9'.repeat(CAMPOS.tel);
    assert.ok(info.endsWith(ultimo), f + ': el final del resumen es «' + info.slice(-30) + '»');
  }
});

test('el anticipo con ficha propia sigue parándose en Google, y sólo en Google', async () => {
  montaCaches();
  montaFetch(okMP);
  const r = await worker.fetch(post({ paquete: 'web-ca', ficha_tiene: 'si' }), ENV);
  assert.equal(r.status, 303, 'en la web no hay ficha que declarar: cobra aunque el campo venga puesto a mano');
  const g = await worker.fetch(post({ paquete: 'gp-ea', ficha_tiene: 'si' }), ENV);
  assert.equal(g.status, 409, 'en Google la contradicción explícita se sigue parando');
});
