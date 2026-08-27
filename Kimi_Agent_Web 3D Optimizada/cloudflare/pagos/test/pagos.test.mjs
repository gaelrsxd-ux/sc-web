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
    assert.equal(p.cuotas, p.total >= UMBRAL ? 2 : 1,
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

test('los once paquetes cobran exactamente lo que enseña la web', async () => {
  for (const p of TABLA.paquetes) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: p.id }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, p.total, 'paquete ' + p.id);
    assert.equal(llamadas[0].cuerpo.items[0].title, p.titulo, 'título del paquete ' + p.id);
  }
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
   aquí: si mañana se añade una colonia, siguen valiendo. Cuando la lista está
   vacía —que es el estado seguro— lo único que se puede comprobar es justo eso:
   que no se le descuenta el envío a nadie. */
const RANGOS = (TABLA.entregaLocal && TABLA.entregaLocal.rangos) || [];
const unCpLocal = () => RANGOS.length ? String(RANGOS[0].desde).padStart(5, '0') : null;

test('un código postal de fuera paga su envío completo', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  /* 79000 es Ciudad Valles: mismo ESTADO, a 250 km. El estado no puede decidir
     esto, sólo el código postal. */
  await worker.fetch(post({ paquete: '1', cp: '79000', estado: 'San Luis Potosí' }), ENV);
  assert.equal(llamadas[0].cuerpo.items[0].unit_price, 508, 'los 79 del envío se cobran');
  assert.match(llamadas[0].cuerpo.items[0].title, /envío incluido$/);
});

test('sin código postal tampoco se regala el envío', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '1' }), ENV);
  assert.equal(llamadas[0].cuerpo.items[0].unit_price, 508);
});

test('un código postal que no tiene cinco dígitos NO da entrega en mano', async () => {
  /* «780000» es el caso interesante: recortado a cinco daría «78000», que sí es
     de la ciudad, y acertaría un rango por pura casualidad. Un código postal
     mexicano tiene exactamente cinco dígitos; con más o con menos, no cuenta. */
  for (const malo of ['7800', '780000', '78OOO', '', '0', '78000-1234']) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1', cp: malo }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, 508, 'cp=«' + malo + '» no puede descontar');
  }
});

test('el FORMATO del código postal no puede costarle el descuento a nadie', { skip: RANGOS.length === 0 }, async () => {
  /* Un comprador de la ciudad que pega su código desde una libreta, o cuyo
     autorrelleno mete un prefijo, escribe cosas como «78 000» o «C.P. 78000».
     Antes se recortaba a cinco CARACTERES antes de quitar los no-dígitos y
     «78 000» acababa siendo «7800»: cuatro cifras, sin descuento y sin que nada
     lo dijera. Son los cinco dígitos lo que cuenta, no cómo estén escritos. */
  const uno = TABLA.paquetes.find(p => p.id === '1');
  const cp = String(RANGOS[0].desde);
  for (const forma of [cp, ' ' + cp + ' ', cp.slice(0, 2) + ' ' + cp.slice(2),
                       cp.slice(0, 2) + '-' + cp.slice(2), 'C.P. ' + cp]) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1', cp: forma }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, uno.total - uno.envio,
      'cp escrito como «' + forma + '» tiene que descontar igual');
  }
});

test('un envío negativo en la tabla NO puede cobrar por encima de lo anunciado', { skip: RANGOS.length === 0 }, async () => {
  /* La guarda anterior era `rebajado > 0 ? rebajado : total`, que sólo miraba
     hacia abajo: con `envio: -50` la resta se volvía suma, salía mayor que el
     total y pasaba limpia. Cobrar por encima del precio exhibido no es un
     descuadre contable, es un problema con PROFECO. */
  const fila = TABLA.paquetes.find(p => p.id === '1');
  const original = fila.envio;
  const cp = String(RANGOS[0].desde);
  try {
    for (const roto of [-50, -1, undefined, null, 'x', NaN, fila.total, fila.total + 100]) {
      fila.envio = roto;
      montaCaches();
      const llamadas = montaFetch(okMP);
      await worker.fetch(post({ paquete: '1', cp }), ENV);
      const cobrado = llamadas[0].cuerpo.items[0].unit_price;
      assert.ok(cobrado > 0 && cobrado <= fila.total,
        'con envio=' + String(roto) + ' se cobró ' + cobrado + ', fuera de (0, ' + fila.total + ']');
    }
  } finally {
    fila.envio = original;
  }
});

test('un rango de códigos absurdo se ignora al leerlo, no sólo al generarlo', async () => {
  /* Entre el generador y este archivo hay un JSON editable a mano y un
     copiar-pegar en el panel de Cloudflare. Un rango que se salga de la banda
     del estado, o que cubra medio país, no puede sobrevivir a ese viaje. */
  const original = TABLA.entregaLocal.rangos;
  try {
    TABLA.entregaLocal.rangos = [{ desde: 0, hasta: 99999, zona: 'todo México' }];
    const { default: recargado } = await import('../pagos.js?absurdo=1');
    montaCaches();
    const llamadas = montaFetch(okMP);
    await recargado.fetch(post({ paquete: '1', cp: '01000' }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, 508,
      'un rango que cubre todo México tiene que ignorarse');
  } finally {
    TABLA.entregaLocal.rangos = original;
  }
});

test('el estado que no cuadra con el código postal se MARCA, pero no cambia el precio', { skip: RANGOS.length === 0 }, async () => {
  /* Todos los códigos 78000-79999 son de San Luis Potosí, así que «código local
     + otro estado» nunca es legítimo: o alguien busca los 79 pesos, o —mucho
     más común— tecleó mal su código. El precio sigue dependiendo sólo del
     código; lo único que cambia es que el titular lo ve. */
  const uno = TABLA.paquetes.find(p => p.id === '1');
  const cp = String(RANGOS[0].desde);
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '1', cp, estado: 'Jalisco', nombre: 'Ana', calle: 'X 1' }), ENV);
  assert.match(llamadas[0].cuerpo.additional_info, /REVISAR CP:/);
  assert.equal(llamadas[0].cuerpo.items[0].unit_price, uno.total - uno.envio,
    'marcarlo no puede cambiar lo que se cobra');
});

test('el cobro caduca: los enlaces viejos no siguen pagables para siempre', async () => {
  /* Quien se equivoca de código postal, vuelve atrás y corrige, deja viva la
     preferencia anterior con su importe y su dirección congelados. Pagarla
     mandaría el paquete a la dirección vieja. */
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '1' }), ENV);
  const c = llamadas[0].cuerpo;
  assert.equal(c.expires, true);
  const caduca = Date.parse(c.expiration_date_to);
  assert.ok(Number.isFinite(caduca), 'la fecha de caducidad tiene que ser una fecha');
  const horas = (caduca - Date.now()) / 3600000;
  assert.ok(horas > 0.5 && horas < 3, 'debe caducar en una hora larga, salió en ' + horas.toFixed(2) + ' h');
});

test('el navegador NO puede reclamar la entrega en mano por su cuenta', async () => {
  /* El descuento sale de la lista del servidor y del código postal. Mandar
     campos con pinta de bandera —«local», «entrega», «envio»— no puede moverlo. */
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({
    paquete: '1', cp: '79000',
    local: '1', entrega: 'mano', envio: '0', envio_gratis: 'si', descuento: '79',
  }), ENV);
  assert.equal(llamadas[0].cuerpo.items[0].unit_price, 508);
});

test('con la lista de zonas vacía no se le descuenta el envío a NADIE', { skip: RANGOS.length > 0 }, async () => {
  /* Es el estado seguro y por eso se comprueba: cobrar de más se devuelve;
     regalar paquetería a medio estado, no. */
  for (const cp of ['78000', '78100', '78430', '79000', '00000', '99999']) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: '1', cp }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, 508, 'cp=' + cp);
  }
});

test('dentro de la zona, el envío no se cobra y el concepto lo DICE', { skip: RANGOS.length === 0 }, async () => {
  const cp = unCpLocal();
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '1', cp }), ENV);
  const item = llamadas[0].cuerpo.items[0];
  const uno = TABLA.paquetes.find(p => p.id === '1');
  assert.equal(item.unit_price, uno.total - uno.envio, 'se descuenta exactamente el envío de la tabla');
  assert.equal(item.title.includes('envío incluido'), false,
    'un título que diga «envío incluido» junto a un importe menor parece un error de cobro');
  assert.match(item.title, /entrega en /);
  assert.match(llamadas[0].cuerpo.additional_info, /EN MANO/,
    'el aviso tiene que decir que se lleva en mano, o acabará en una paquetería pagada de más');
});

test('dentro de la zona, los paquetes que YA tenían envío gratis no cambian', { skip: RANGOS.length === 0 }, async () => {
  const cp = unCpLocal();
  for (const p of TABLA.paquetes.filter(x => x.envio === 0)) {
    montaCaches();
    const llamadas = montaFetch(okMP);
    await worker.fetch(post({ paquete: p.id, cp }), ENV);
    assert.equal(llamadas[0].cuerpo.items[0].unit_price, p.total, 'paquete ' + p.id);
    assert.equal(llamadas[0].cuerpo.items[0].title, p.titulo, 'y el concepto tampoco cambia');
  }
});

test('el importe cobrado NUNCA sale de la tabla, se descuente o no', async () => {
  /* La comprobación de cordura de todo el bloque: sea cual sea el código
     postal, lo que se cobra es o el total del paquete o el total menos su
     propio envío. Ninguna otra cifra puede aparecer. */
  for (const p of TABLA.paquetes) {
    for (const cp of ['78000', '78430', '79000', '01000', '', '99999']) {
      montaCaches();
      const llamadas = montaFetch(okMP);
      await worker.fetch(post({ paquete: p.id, cp }), ENV);
      const cobrado = llamadas[0].cuerpo.items[0].unit_price;
      assert.ok(cobrado === p.total || cobrado === p.total - p.envio,
        'paquete ' + p.id + ' con cp=' + cp + ' cobró ' + cobrado +
        ', que no es ni ' + p.total + ' ni ' + (p.total - p.envio));
      assert.ok(cobrado > 0, 'ningún cobro puede salir en cero o negativo');
    }
  }
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
    assert.ok(p.titulo.length > 0);
    assert.ok(p.cuotas === 1 || p.cuotas === 2, 'cuotas sólo puede ser 1 o 2 en ' + p.id);
  }
});
