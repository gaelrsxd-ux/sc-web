/**
 * Lista blanca de rutas y métodos — defensa en profundidad.
 *
 *   cd "Kimi_Agent_Web 3D Optimizada/cloudflare"
 *   node --test test/rutas.test.mjs
 *
 * Por qué existe esta suite: el Worker ignoraba el path y analizaba con
 * cualquier ruta que llevara ?url=. En producción se explotó de verdad —una
 * regla de zona que salta la fase de bots para /robots.txt y /sitemap.xml no
 * filtraba por hostname— y `audit…/robots.txt?url=…` devolvía el informe entero
 * esquivando Super Bot Fight Mode.
 *
 * La regla de zona hay que arreglarla igual. Estas pruebas garantizan que, si
 * alguien vuelve a abrirla por error, aquí ya no queda nada que abrir.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { arranca, para, TOKEN_PRUEBA, CABECERA_TOKEN } from './arranque.mjs';

const PUERTO = 8941;
const OBJETIVO = encodeURIComponent('https://ejemplo.test');
let lab = null;
let BASE = '';

let n = 0;
const ipNueva = () => `203.0.113.${(++n % 200) + 20}`;

async function pide(ruta, opciones = {}) {
  const r = await fetch(BASE + ruta, {
    method: opciones.metodo || 'GET',
    headers: {
      'CF-Connecting-IP': opciones.ip || ipNueva(),
      [CABECERA_TOKEN]: TOKEN_PRUEBA,
      ...(opciones.cab || {})
    }
  });
  const texto = await r.text();
  return {
    codigo: r.status,
    tipo: r.headers.get('Content-Type') || '',
    allow: r.headers.get('Allow'),
    lim: r.headers.get('X-Limitador'),
    acao: r.headers.get('Access-Control-Allow-Origin'),
    cuerpo: texto,
    esInforme: texto.includes('"score"')
  };
}

describe('lista blanca de rutas y métodos', () => {
  before(async () => {
    lab = await arranca({ config: 'test/wrangler.test.toml', puerto: PUERTO });
    BASE = lab.base;
  });
  after(async () => { await para(lab); });

  test('la ruta canónica sigue funcionando', async () => {
    const r = await pide(`/?url=${OBJETIVO}`);
    assert.ok([200, 502].includes(r.codigo), `devolvió ${r.codigo}`);
    assert.equal(r.lim, 'ok');
  });

  test('REGRESIÓN: /robots.txt?url= NO ejecuta el diagnóstico', async () => {
    /* Ésta es la petición exacta con la que se saltó SBFM en producción. */
    const r = await pide(`/robots.txt?url=${OBJETIVO}`);
    assert.equal(r.esInforme, false, 'devolvió un informe: el bypass sigue abierto');
    assert.equal(r.codigo, 200);
    assert.match(r.tipo, /text\/plain/);
    assert.match(r.cuerpo, /Disallow: \//);
  });

  test('GET /robots.txt sin query: 200 text/plain con Disallow: /', async () => {
    /* Esto es una API, no una web: no hay nada que indexar y conviene decirlo.
       Se comprueba también el Content-Type, porque servir el robots como algo
       distinto de texto plano haría que los rastreadores lo ignorasen. */
    const r = await pide('/robots.txt');
    assert.equal(r.codigo, 200);
    assert.match(r.tipo, /^text\/plain/, `Content-Type inesperado: ${r.tipo}`);
    assert.match(r.cuerpo, /User-agent: \*/);
    assert.match(r.cuerpo, /Disallow: \//);
    assert.equal(r.esInforme, false);
  });

  test('/sitemap.xml da 404, con y sin query', async () => {
    for (const ruta of ['/sitemap.xml', `/sitemap.xml?url=${OBJETIVO}`]) {
      const r = await pide(ruta);
      assert.equal(r.codigo, 404, `${ruta} devolvió ${r.codigo}`);
      assert.equal(r.esInforme, false);
    }
  });

  test('cualquier otra ruta con ?url= da 404 y no analiza', async () => {
    const rutas = [
      `/cualquier-otra?url=${OBJETIVO}`,
      `/api/v1/audit?url=${OBJETIVO}`,
      `/favicon.ico?url=${OBJETIVO}`,
      `/.well-known/security.txt?url=${OBJETIVO}`,
      `//?url=${OBJETIVO}`,
      `/index.html?url=${OBJETIVO}`
    ];
    for (const ruta of rutas) {
      const r = await pide(ruta);
      assert.equal(r.codigo, 404, `${ruta} devolvió ${r.codigo}`);
      assert.equal(r.esInforme, false, `${ruta} ejecutó el diagnóstico`);
    }
  });

  test('métodos no previstos en la ruta canónica: 405 con Allow', async () => {
    for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const r = await pide(`/?url=${OBJETIVO}`, { metodo });
      assert.equal(r.codigo, 405, `${metodo} devolvió ${r.codigo}`);
      if (metodo !== 'HEAD') {
        assert.equal(r.allow, 'GET, OPTIONS', `${metodo} no anunció Allow correcto`);
      }
      assert.equal(r.esInforme, false);
    }
  });

  test('métodos no previstos en /robots.txt: 405 con Allow propio', async () => {
    for (const metodo of ['POST', 'PUT', 'DELETE']) {
      const r = await pide('/robots.txt', { metodo });
      assert.equal(r.codigo, 405);
      assert.equal(r.allow, 'GET, HEAD');
    }
  });

  test('HEAD /robots.txt se admite', async () => {
    const r = await pide('/robots.txt', { metodo: 'HEAD' });
    assert.equal(r.codigo, 200);
  });

  test('el preflight sigue funcionando en la ruta canónica y 404 fuera de ella', async () => {
    const ok = await pide(`/?url=${OBJETIVO}`, {
      metodo: 'OPTIONS',
      cab: { 'Origin': 'https://sycsolutions.company', 'Access-Control-Request-Method': 'GET' }
    });
    assert.equal(ok.codigo, 200);
    assert.equal(ok.acao, 'https://sycsolutions.company');

    const fuera = await pide('/otra-ruta', { metodo: 'OPTIONS' });
    assert.equal(fuera.codigo, 404);
  });

  test('las rutas rechazadas NO consumen cuota del limitador', async () => {
    /* Si 404 y 405 gastaran cuota, cualquiera podría agotar el diagnóstico de
       una IP compartida sin llegar a pedir un solo análisis. */
    const ip = ipNueva();
    for (let i = 0; i < 30; i++) {
      await pide(`/robots.txt?url=${OBJETIVO}`, { ip });
      await pide(`/otra?url=${OBJETIVO}`, { ip });
      await pide(`/?url=${OBJETIVO}`, { ip, metodo: 'POST' });
    }
    let aceptadas = 0;
    for (let i = 0; i < 25; i++) {
      if ((await pide(`/?url=${OBJETIVO}`, { ip })).codigo !== 429) aceptadas++;
    }
    assert.equal(aceptadas, 20, 'la cuota debía estar intacta y quedó en ' + aceptadas);
  });
});
