/**
 * Turnstile: validación server-side y su lugar en el pipeline.
 *
 *   cd "Kimi_Agent_Web 3D Optimizada/cloudflare"
 *   node --test test/turnstile.test.mjs
 *
 * Dos mitades:
 *
 *  1. Contra el servicio REAL de Cloudflare con las claves de prueba públicas.
 *     Comprobado que con una secret de prueba siteverify ignora el valor del
 *     token, así que se puede recorrer el camino entero sin navegador.
 *  2. Contra un siteverify SIMULADO en local, que es la única forma de provocar
 *     los fallos que deben cerrar: servicio caído, 5xx, cuerpo que no es JSON y
 *     cuelgue. Ese mismo simulador cuenta las peticiones que recibe, y eso es lo
 *     que demuestra que el precheck local no gasta red.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { arranca, para, TOKEN_PRUEBA, CABECERA_TOKEN } from './arranque.mjs';

const OBJETIVO = encodeURIComponent('https://ejemplo.test');
const RUTA = `/?url=${OBJETIVO}`;

/* Claves de prueba públicas documentadas por Cloudflare. No son secretos. */
const PASA    = '1x0000000000000000000000000000000AA';
const FALLA   = '2x0000000000000000000000000000000AA';
const GASTADO = '3x0000000000000000000000000000000AA';

/* Cadena INVENTADA. No es la clave de nadie: siteverify la rechaza con
   `invalid-input-secret`. Existe porque varias pruebas necesitan un secreto que
   NO esté en la lista de claves de prueba, para que `dePrueba` sea falso y se
   ejercite la rama de producción —la que exige `action`—.
   Va en una sola constante, con una sola marca para el escáner de secretos y a
   la vista en el diff, en vez de repetida por el archivo. */
const NO_ES_DE_PRUEBA = '0x4AAAAAAAinventadoNoEsLaClaveDeNadie';  // secreto-permitido: cadena inventada

let n = 0;
const ipNueva = () => `203.0.113.${(++n % 180) + 40}`;

async function pide(base, opciones = {}) {
  const cab = { 'CF-Connecting-IP': opciones.ip || ipNueva() };
  /* null significa "no mandes la cabecera". Una cadena vacía SÍ se manda: es un
     caso distinto y hay que poder distinguirlos. Confundirlos hacía que el test
     de la cadena vacía enviara en realidad un token bueno. */
  if (opciones.token !== null) {
    cab[CABECERA_TOKEN] = opciones.token === undefined ? TOKEN_PRUEBA : opciones.token;
  }
  const r = await fetch(base + (opciones.ruta || RUTA), { method: opciones.metodo || 'GET', headers: cab });
  const texto = await r.text();
  let cuerpo = null;
  try { cuerpo = JSON.parse(texto); } catch { /* no era json */ }
  return {
    codigo: r.status,
    lim: r.headers.get('X-Limitador'),
    renovar: !!(cuerpo && cuerpo.renovar),
    esInforme: texto.includes('"score"')
  };
}

/* ---------- mitad 1: servicio real, claves de prueba ---------- */

describe('Turnstile contra el servicio real (claves de prueba)', () => {
  let lab = null;
  before(async () => { lab = await arranca({ config: 'test/wrangler.test.toml', puerto: 8901 }); });
  after(async () => { await para(lab); });

  test('token válido: pasa y llega al análisis', async () => {
    const r = await pide(lab.base);
    assert.ok([200, 502].includes(r.codigo), `devolvió ${r.codigo}`);
    assert.equal(r.lim, 'ok');
  });

  test('token ausente: 403, y pide renovar el widget', async () => {
    const r = await pide(lab.base, { token: null });
    assert.equal(r.codigo, 403);
    assert.equal(r.lim, 'turnstile-precheck');
    assert.equal(r.renovar, true);
    assert.equal(r.esInforme, false);
  });

  test('token con caracteres imposibles: 403 en el precheck', async () => {
    /* Valores de cabecera HTTP legales —si no, los rechazaría el cliente antes
       de salir— pero que no puede haber emitido el widget. */
    for (const malo of ['con espacios', '<script>alert(1)</script>', 'a,b', 'a;b', 'a"b', '{}']) {
      const r = await pide(lab.base, { token: malo });
      assert.equal(r.codigo, 403, `${JSON.stringify(malo)} devolvió ${r.codigo}`);
      assert.equal(r.lim, 'turnstile-precheck');
    }
  });

  test('token por encima de 2048 caracteres: 403 en el precheck', async () => {
    const r = await pide(lab.base, { token: 'A'.repeat(2049) });
    assert.equal(r.codigo, 403);
    assert.equal(r.lim, 'turnstile-precheck');
  });

  test('token de 2048 exactos: pasa el precheck y lo decide siteverify', async () => {
    const r = await pide(lab.base, { token: 'A'.repeat(2048) });
    assert.notEqual(r.lim, 'turnstile-precheck', 'el límite es > 2048, no >= 2048');
  });
});

describe('Turnstile: token rechazado por el servicio real', () => {
  test('secret "siempre falla" -> 403 y no se analiza', async () => {
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto: 8902, vars: { TURNSTILE_SECRET: FALLA }
      });
      const r = await pide(lab.base);
      assert.equal(r.codigo, 403);
      assert.equal(r.lim, 'turnstile-rechazado');
      assert.equal(r.renovar, true);
      assert.equal(r.esInforme, false);
    } finally { await para(lab); }
  });

  test('secret "token ya gastado" (replay) -> 403', async () => {
    /* Es como el servicio simula timeout-or-duplicate. No hace falta almacén de
       nonces propio: los tokens ya son de un solo uso en siteverify. */
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto: 8903, vars: { TURNSTILE_SECRET: GASTADO }
      });
      const r = await pide(lab.base);
      assert.equal(r.codigo, 403);
      assert.equal(r.lim, 'turnstile-rechazado');
    } finally { await para(lab); }
  });

  test('hostname distinto del esperado -> 403', async () => {
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto: 8904,
        vars: { TURNSTILE_HOSTNAMES: 'otro-sitio.test' }
      });
      const r = await pide(lab.base);
      assert.equal(r.codigo, 403);
      assert.equal(r.lim, 'turnstile-hostname');
    } finally { await para(lab); }
  });

  test('sin TURNSTILE_SECRET -> 503, no 403', async () => {
    /* Falta de configuración nuestra, no culpa de quien pide: fallo cerrado. */
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto: 8905, vars: { TURNSTILE_SECRET: '""' }
      });
      const r = await pide(lab.base);
      assert.equal(r.codigo, 503);
      assert.equal(r.lim, 'turnstile-sin-secreto');
    } finally { await para(lab); }
  });
});

/* ---------- mitad 2: siteverify simulado ---------- */

describe('Turnstile: siteverify degradado siempre cierra', () => {
  let servidor = null;
  let recibidas = 0;
  let modo = 'ok';

  before(async () => {
    servidor = createServer((req, res) => {
      recibidas++;
      if (modo === '500') { res.writeHead(500); res.end('nope'); return; }
      if (modo === 'no-json') { res.writeHead(200, { 'Content-Type': 'text/html' }); res.end('<h1>hola</h1>'); return; }
      if (modo === 'cuelga') { /* nunca responde: debe saltar el tiempo de espera */ return; }
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({ success: true, hostname: 'example.com', action: 'diagnostico-seo' }));
    });
    await new Promise(r => servidor.listen(8951, '127.0.0.1', r));
  });
  after(async () => { if (servidor) await new Promise(r => servidor.close(r)); });

  async function conMock(puerto, fn) {
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto,
        vars: { TURNSTILE_URL: 'http://127.0.0.1:8951/verify' }
      });
      await fn(lab);
    } finally { await para(lab); }
  }

  test('siteverify devuelve 5xx -> 503', async () => {
    await conMock(8906, async lab => {
      modo = '500';
      const r = await pide(lab.base);
      assert.equal(r.codigo, 503);
      /* El estado lleva el código para que en el log se distinga "contestó mal"
         de "no contestó": son averías distintas. */
      assert.equal(r.lim, 'turnstile-http-500');
      assert.equal(r.esInforme, false);
    });
  });

  test('siteverify devuelve algo que no es JSON -> 503', async () => {
    await conMock(8907, async lab => {
      modo = 'no-json';
      const r = await pide(lab.base);
      assert.equal(r.codigo, 503);
      assert.equal(r.lim, 'turnstile-inalcanzable');
    });
  });

  test('siteverify se cuelga -> 503 por tiempo de espera', async () => {
    await conMock(8908, async lab => {
      modo = 'cuelga';
      const t0 = Date.now();
      const r = await pide(lab.base);
      const ms = Date.now() - t0;
      assert.equal(r.codigo, 503);
      assert.ok(ms < 12000, `tardó ${ms} ms: el presupuesto de espera no cortó`);
    });
  });

  test('siteverify inalcanzable (puerto cerrado) -> 503', async () => {
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto: 8909,
        vars: { TURNSTILE_URL: 'http://127.0.0.1:8952/verify' }   /* nadie escucha */
      });
      const r = await pide(lab.base);
      assert.equal(r.codigo, 503);
      assert.equal(r.lim, 'turnstile-inalcanzable');
    } finally { await para(lab); }
  });

  test('EL PRECHECK NO GASTA RED: 0 peticiones a siteverify con tokens imposibles', async () => {
    await conMock(8910, async lab => {
      modo = 'ok';
      recibidas = 0;
      for (const malo of [null, 'con espacios', 'A'.repeat(3000), 'ñ', '']) {
        const r = await pide(lab.base, { token: malo });
        assert.equal(r.codigo, 403, `${String(malo).slice(0, 20)} devolvió ${r.codigo}`);
      }
      assert.equal(recibidas, 0, `el precheck disparó ${recibidas} subpeticiones y debía disparar 0`);

      /* Y con un token plausible sí se llama: la comprobación anterior mide algo. */
      await pide(lab.base);
      assert.equal(recibidas, 1, 'un token plausible debe llegar a siteverify');
    });
  });
});

/* ---------- action y polaridad del entorno ---------- */

describe('Turnstile: action y polaridad de ENTORNO', () => {
  let servidor = null;
  let recibidas = 0;
  let respuesta = {};

  before(async () => {
    servidor = createServer((req, res) => {
      recibidas++;
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(respuesta));
    });
    await new Promise(r => servidor.listen(8957, '127.0.0.1', r));
  });
  after(async () => { if (servidor) await new Promise(r => servidor.close(r)); });

  test('action distinta de la esperada -> 403 y sin consumir cuota', async () => {
    /* La rama de producción del control de `action` no se puede ejercitar con
       las claves de prueba reales, porque con ellas siteverify NO devuelve ese
       campo. Con el simulador sí: se responde éxito, hostname correcto y una
       action equivocada, que es exactamente el caso que hay que rechazar. */
    respuesta = { success: true, hostname: 'example.com', action: 'otra-cosa' };
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto: 8914,
        vars: {
          TURNSTILE_URL: 'http://127.0.0.1:8957/verify',
          /* Secreto que NO es de prueba: así `dePrueba` es falso y la
             comprobación de action se exige, igual que en producción. */
          TURNSTILE_SECRET: NO_ES_DE_PRUEBA
        }
      });
      const ip = ipNueva();
      for (let i = 0; i < 5; i++) {
        const r = await pide(lab.base, { ip });
        assert.equal(r.codigo, 403, `devolvió ${r.codigo}`);
        assert.equal(r.lim, 'turnstile-accion');
        assert.equal(r.renovar, true);
      }

      /* Y la cuota sigue intacta: 5 rechazos no gastaron ninguna plaza. */
      respuesta = { success: true, hostname: 'example.com', action: 'diagnostico-seo' };
      let aceptadas = 0;
      for (let i = 0; i < 25; i++) {
        if ((await pide(lab.base, { ip })).codigo !== 429) aceptadas++;
      }
      assert.equal(aceptadas, 20, 'la cuota no estaba intacta: ' + aceptadas);
    } finally { await para(lab); }
  });

  test('action correcta con secreto real -> pasa', async () => {
    respuesta = { success: true, hostname: 'example.com', action: 'diagnostico-seo' };
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto: 8915,
        vars: {
          TURNSTILE_URL: 'http://127.0.0.1:8957/verify',
          TURNSTILE_SECRET: NO_ES_DE_PRUEBA
        }
      });
      const r = await pide(lab.base);
      assert.notEqual(r.codigo, 403);
      assert.equal(r.lim, 'ok');
    } finally { await para(lab); }
  });

  test('POLARIDAD: sin ENTORNO, las claves de prueba se RECHAZAN', async () => {
    /* Todo lo que no sea "dev" explícito tiene que comportarse como producción.
       Si esta prueba se pusiera verde con un 200, significaría que basta con
       olvidar la variable para que una clave de prueba valga. */
    let lab = null;
    try {
      lab = await arranca({ config: 'test/wrangler.sinentorno.toml', puerto: 8916 });
      const r = await pide(lab.base);
      assert.equal(r.codigo, 503);
      assert.equal(r.lim, 'turnstile-claves-de-prueba');
    } finally { await para(lab); }
  });

  test('POLARIDAD: sin ENTORNO, TURNSTILE_URL se IGNORA', async () => {
    /* El simulador diría que sí a todo. Si el Worker lo usara, la petición
       pasaría. La prueba de que NO lo usa es doble: el contador del simulador
       se queda a cero y la petición no pasa.
       No se afirma un código concreto a propósito: lo que devuelva el
       siteverify de verdad ante un secreto inventado no está bajo nuestro
       control. Medido: contesta 400 con `invalid-input-secret`, que el Worker
       traduce a 503 porque es una avería de configuración nuestra, no una culpa
       del visitante. Afirmar "403" ataba la prueba a un detalle ajeno. */
    respuesta = { success: true, hostname: 'example.com', action: 'diagnostico-seo' };
    recibidas = 0;
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.sinentorno.toml', puerto: 8917,
        vars: {
          TURNSTILE_URL: 'http://127.0.0.1:8957/verify',
          TURNSTILE_SECRET: NO_ES_DE_PRUEBA
        }
      });
      const r = await pide(lab.base);
      assert.equal(recibidas, 0, `el simulador recibió ${recibidas} peticiones: el override NO se ignoró`);
      assert.ok([403, 503].includes(r.codigo),
        `esperaba una denegación y llegó ${r.codigo}: el simulador habría dejado pasar`);
      assert.equal(r.esInforme, false);
    } finally { await para(lab); }
  });
});

/* ---------- orden del pipeline ---------- */

describe('Turnstile va ANTES del limitador', () => {
  test('un token inválido NO consume cuota del Durable Object', async () => {
    let lab = null;
    try {
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto: 8911, vars: { TURNSTILE_SECRET: FALLA }
      });
      const ip = ipNueva();
      /* 40 intentos con token que siteverify rechaza. */
      for (let i = 0; i < 40; i++) {
        const r = await pide(lab.base, { ip });
        assert.equal(r.codigo, 403);
      }
      await para(lab);

      /* Mismo identificador, ahora con la clave que pasa: la cuota debe estar
         intacta. Si Turnstile fuera después del limitador, aquí quedarían 0. */
      lab = await arranca({
        config: 'test/wrangler.test.toml', puerto: 8912, vars: { TURNSTILE_SECRET: PASA }
      });
      let aceptadas = 0;
      for (let i = 0; i < 25; i++) {
        if ((await pide(lab.base, { ip })).codigo !== 429) aceptadas++;
      }
      assert.equal(aceptadas, 20, 'la cuota no estaba intacta: quedaron ' + aceptadas);
    } finally { await para(lab); }
  });

  test('un acierto de caché sigue exigiendo token válido', async () => {
    let lab = null;
    try {
      lab = await arranca({ config: 'test/wrangler.test.toml', puerto: 8913 });
      const ruta = `/?url=${encodeURIComponent('https://ejemplo.test/cacheado-turnstile')}`;
      await pide(lab.base, { ruta });                      /* deja la respuesta en caché */
      const sinToken = await pide(lab.base, { ruta, token: null });
      assert.equal(sinToken.codigo, 403, 'la caché sirvió sin token');
      assert.equal(sinToken.esInforme, false);
    } finally { await para(lab); }
  });
});
