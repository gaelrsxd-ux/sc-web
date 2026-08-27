/* Pruebas del Worker de cobros. Corren sin red y sin wrangler: se sustituye
   `fetch` global por un doble que captura lo que se le habría mandado a Mercado
   Pago, que es justo lo que hay que inspeccionar.

     node --test test/pagos.test.mjs

   La prueba que justifica el archivo entero es «el importe NO lo pone el
   navegador». Todo lo demás es higiene; ésa es la que evita que alguien pague
   un peso por veinte placas. */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import worker from '../pagos.js';
import TABLA from '../paquetes.json' with { type: 'json' };

const ORIGEN = 'https://sycsolutions.company';
const ENV = { MP_ACCESS_TOKEN: 'TEST-token-de-mentira' };

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

test('fuerza el pago de contado: installments = 1', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  await worker.fetch(post({ paquete: '1' }), ENV);
  const pm = llamadas[0].cuerpo.payment_methods;
  assert.equal(pm.installments, 1, 'installments es el MÁXIMO de cuotas; 1 = una sola exhibición');
  assert.equal(pm.default_installments, 1);
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

test('el tope por IP corta el martilleo', async () => {
  montaCaches();
  const llamadas = montaFetch(okMP);
  let ultima;
  for (let i = 0; i < 15; i++) ultima = await worker.fetch(post({ paquete: '1' }), ENV);
  assert.equal(ultima.status, 429);
  assert.ok(llamadas.length <= 12, 'no se crean más de 12 preferencias por minuto y IP, se hicieron ' + llamadas.length);
});

/* ════════════════════════ LA TABLA, CONTRA LA WEB ═════════════════════════ */

test('la tabla del Worker no está vacía ni trae importes absurdos', () => {
  assert.equal(TABLA.moneda, 'MXN');
  assert.ok(TABLA.paquetes.length >= 1);
  for (const p of TABLA.paquetes) {
    assert.ok(Number.isInteger(p.total) && p.total > 0, 'importe entero y positivo en ' + p.id);
    assert.ok(p.total < 100000, 'importe con un tope de cordura en ' + p.id);
    assert.ok(p.titulo.length > 0);
  }
});
