/**
 * Pruebas de concurrencia, aislamiento, caché y bypass del limitador atómico.
 *
 *   cd "Kimi_Agent_Web 3D Optimizada/cloudflare"
 *   node --test test/concurrencia.test.mjs
 *
 * Cero dependencias: `node:test` viene con Node.
 *
 * LO PRIMERO QUE HAY QUE SABER: entrando por TCP contra `wrangler dev`, workerd
 * atiende de una en una —medido: 40 lanzadas a la vez, máximo 1 en vuelo—. Por
 * ese camino el contador viejo sobre Cache API, que en producción dejaba pasar
 * 39 de 40, sacaba un 20/40 impecable. Por eso las ráfagas van por `/__rafaga`,
 * que abanica desde dentro del isolate, y por eso el primer test comprueba que
 * hubo solape de verdad: si eso se cae, ningún otro verde de esta suite
 * significa nada.
 */

import { test, describe, before, after } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { arranca, para, TOKEN_PRUEBA, CABECERA_TOKEN } from './arranque.mjs';

const PUERTO = 8931;
const TOPE = 20;
const SUB = '/?url=https%3A%2F%2Fejemplo.test';

let lab = null;
let mock = null;
let BASE = '';

let n = 0;
/* Clave nueva por prueba: cada nombre distinto es un Durable Object distinto
   con su propio fichero SQLite. No hay estado que resetear porque no existe, y
   una clave recién creada nunca está a mitad de una ventana sucia. Más fiable
   que un endpoint de reset, y sin puertas traseras en producción. */
const ipNueva = () => `198.51.100.${(++n % 200) + 1}`.replace(/$/, `?${Date.now()}${n}`);

/* Las IP de prueba tienen que ser IP válidas para que `identidad()` las acepte,
   así que la unicidad se consigue recorriendo el espacio 203.0.113.0/24 y
   198.51.100.0/24 (bloques reservados a documentación) en vez de inventar
   sufijos. Con dos /24 hay 500 claves distintas, de sobra para la suite. */
let contador = 0;
function claveNueva() {
  contador++;
  const bloque = contador < 250 ? '203.0.113.' : '198.51.100.';
  return bloque + ((contador % 250) + 1);
}

async function rafaga(n, ip, opciones = {}) {
  const q = new URLSearchParams({ n: String(n), ip, sub: opciones.sub || SUB });
  if (opciones.metodo) q.set('metodo', opciones.metodo);
  if (opciones.directo) q.set('directo', '1');
  const r = await fetch(`${BASE}/__rafaga?${q}`);
  assert.equal(r.status, 200, 'el arnés debe responder 200');
  return r.json();
}

async function una(ip, ruta = SUB, init = {}) {
  const r = await fetch(BASE + ruta, {
    ...init,
    headers: {
      'CF-Connecting-IP': ip,
      [CABECERA_TOKEN]: TOKEN_PRUEBA,
      ...(init.headers || {})
    }
  });
  return { codigo: r.status, lim: r.headers.get('X-Limitador'), acao: r.headers.get('Access-Control-Allow-Origin') };
}

/** Habla con el Durable Object directamente. Ventanas cortas para los bordes. */
async function consume(clave, tope = 20, ventana = 60000) {
  const r = await fetch(`${BASE}/__consume?clave=${encodeURIComponent(clave)}&tope=${tope}&ventana=${ventana}`);
  return r.json();
}

describe('limitador atómico sobre Durable Object SQLite', () => {
  before(async () => {
    /* siteverify LOCAL para toda esta suite. Turnstile va antes del limitador,
       así que cada petición de una ráfaga hace su validación: con 500 a la vez,
       eso son 500 conexiones TLS simultáneas contra Cloudflare desde una sola
       máquina. Medido: fallaban todas y el test daba 0 de 500 aceptadas por
       agotarse el tiempo de espera, no por el limitador.
       Lo que esta suite mide es la atomicidad del contador, así que no puede
       depender de un servicio externo. El comportamiento real de Turnstile
       —incluida su degradación— se prueba contra el servicio de verdad en
       test/turnstile.test.mjs, que es donde corresponde. */
    mock = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: true, hostname: 'example.com', action: 'diagnostico-seo'
      }));
    });
    await new Promise(r => mock.listen(8955, '127.0.0.1', r));

    lab = await arranca({
      config: 'test/wrangler.test.toml', puerto: PUERTO,
      vars: { TURNSTILE_URL: 'http://127.0.0.1:8955/verify' }
    });
    BASE = lab.base;
  });
  after(async () => {
    await para(lab);
    if (mock) await new Promise(r => mock.close(r));
  });

  /* ---------- centinela ---------- */

  test('CENTINELA: el arnés produce solape real (sin esto la suite no prueba nada)', async () => {
    const r = await rafaga(40, claveNueva());
    assert.ok(r.maxEnVuelo >= 20,
      `solape insuficiente: maxEnVuelo=${r.maxEnVuelo}. La suite no puede detectar carreras.`);
  });

  test('CENTINELA: el limitador está activo (ni abierto ni apagado)', async () => {
    const r = await una(claveNueva());
    assert.ok(['ok', 'limite'].includes(r.lim), `X-Limitador=${r.lim}: el DO no está contando`);
  });

  /* ---------- volumen ---------- */

  test('1 sola petición pasa', async () => {
    const r = await una(claveNueva());
    assert.notEqual(r.codigo, 429);
    assert.equal(r.lim, 'ok');
  });

  for (const [cuantas, esperadas] of [[19, 19], [20, 20], [21, 20]]) {
    test(`${cuantas} secuenciales -> ${esperadas} aceptadas`, async () => {
      const ip = claveNueva();
      const cods = [];
      for (let i = 0; i < cuantas; i++) cods.push((await una(ip)).codigo);
      assert.equal(cods.filter(c => c !== 429).length, esperadas);
      assert.equal(cods.filter(c => c === 429).length, cuantas - esperadas);
    });
  }

  test('35 secuenciales: 20 aceptadas, 15 bloqueadas, corte exacto en la 21', async () => {
    const ip = claveNueva();
    const cods = [];
    for (let i = 0; i < 35; i++) cods.push((await una(ip)).codigo);
    assert.equal(cods.filter(c => c !== 429).length, TOPE);
    assert.equal(cods.filter(c => c === 429).length, 15);
    assert.equal(cods.slice(0, TOPE).every(c => c !== 429), true);
    assert.equal(cods.slice(TOPE).every(c => c === 429), true);
  });

  test('40 simultáneas, ventana limpia: exactamente 20 (antes pasaban 39)', async () => {
    const r = await rafaga(40, claveNueva());
    assert.equal(r.aceptadas, TOPE, `pasaron ${r.aceptadas} de 40`);
    assert.equal(r.cerradas, 0, 'ninguna debe fallar cerrada en el camino feliz');
    console.log(`      40 simultáneas: p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms total=${r.totalMs}ms solape=${r.maxEnVuelo}`);
  });

  /* Este es el que de verdad caza la carrera, y no es suposición: se probó
     rompiendo el limitador a propósito (un `await` dentro de la sección
     crítica) y el resultado fue
         40 simultáneas ..... PASÓ   (no detectó nada)
         100 simultáneas .... FALLÓ  (pasaron 100 de 100)
     Con 40, el entrelazado depende de cómo caiga el planificador. Si algún día
     hay que quitar un test por tiempo, se quita el de 40, nunca este. */
  test('100 simultáneas, ventana limpia: exactamente 20', async () => {
    const r = await rafaga(100, claveNueva());
    assert.equal(r.aceptadas, TOPE, `pasaron ${r.aceptadas} de 100`);
    assert.equal(r.cerradas, 0);
    console.log(`      100 simultáneas: p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms total=${r.totalMs}ms solape=${r.maxEnVuelo}`);
  });

  test('500 simultáneas, ventana limpia: exactamente 20', async () => {
    const r = await rafaga(500, claveNueva());
    assert.equal(r.aceptadas, TOPE, `pasaron ${r.aceptadas} de 500`);
    assert.equal(r.errores, 0, 'no debe haber excepciones');
    /* Las excedidas pueden salir como 429 (lo normal) o como 503 si la cola del
       objeto supera el presupuesto de tiempo. Ambas deniegan; el reparto se
       imprime porque es el dato que gobierna la elección de PRESUPUESTO_DO_MS.
       Lo que NO puede pasar es que una excedida se acepte. */
    console.log(`      500 simultáneas: p50=${r.p50}ms p95=${r.p95}ms p99=${r.p99}ms total=${r.totalMs}ms solape=${r.maxEnVuelo}`);
    console.log(`      500 simultáneas: 429=${r.limitadas} 503=${r.cerradas} códigos=${JSON.stringify(r.codigos)}`);
  });

  test('atomicidad aislada: 100 llamadas directas al DO permiten exactamente 20', async () => {
    /* Sin pasar por el Worker, así que sin presupuesto de tiempo ni fallo
       cerrado de por medio: mide sólo si el contador cuenta bien. Es la
       contraparte positiva de test/mutacion.test.mjs, donde esta misma llamada
       con la sección crítica rota permite 100 de 100. */
    const q = new URLSearchParams({ n: '100', clave: 'directo-' + claveNueva(), tope: '20' });
    const r = await (await fetch(`${BASE}/__rafagaDO?${q}`)).json();
    assert.equal(r.permitidas, TOPE, `permitió ${r.permitidas} de 100`);
    assert.equal(r.errores, 0);
  });

  test('REGRESIÓN: un tope mayor que el techo de filas no vuelve ilimitado el limitador', async () => {
    /* La purga de cinturón deja siempre las 100 filas más nuevas, así que con
       un tope por encima de eso `usados` nunca lo alcanzaba y TODO se aceptaba.
       Medido antes del arreglo: con tope=101 y con tope=200, 400 de 400
       permitidas, ninguna rechazada jamás. Ahora el tope se acota. */
    for (const tope of [101, 200, 5000]) {
      const c = claveNueva() + '-t' + tope;
      let ok = 0;
      for (let i = 0; i < 30; i++) if ((await consume(c, tope, 60000)).permitido) ok++;
      assert.ok(ok <= 20, `con tope=${tope} pasaron ${ok}: el limitador quedó abierto`);
    }
  });

  test('REGRESIÓN: una ventana mayor que la de referencia se acota', async () => {
    /* La limpieza mide siempre con la ventana de referencia, así que una
       ventana más larga hacía que la alarma borrara marcas VIVAS y el contador
       se reseteara solo. Medido antes del arreglo con una ventana de 10
       minutos: a los ~90 s volvía a aceptar con 20 marcas vivas dentro. */
    const c = claveNueva() + '-vlarga';
    let ok = 0;
    for (let i = 0; i < 25; i++) if ((await consume(c, 20, 3_600_000)).permitido) ok++;
    assert.equal(ok, 20, 'debe seguir cortando en 20 aunque se pida una ventana de una hora');
  });

  test('overshoot observado = 0 en diez ráfagas seguidas de 100', async () => {
    let peor = 0;
    for (let i = 0; i < 10; i++) {
      const r = await rafaga(100, claveNueva());
      peor = Math.max(peor, r.aceptadas - TOPE);
    }
    assert.equal(peor, 0, `overshoot observado ${peor}`);
  });

  /* ---------- ventana y recuperación ---------- */

  test('Retry-After se redondea al alza a múltiplos de 10, y nunca se queda corto', async () => {
    /* El valor exacto sale de la marca más antigua de la ventana. En una IP
       compartida —una oficina, un CGNAT— eso le cuenta a quien recibe el 429
       cuándo pidió algo un tercero, con precisión de segundo. Redondear al alza
       lo vuelve un dato grueso.
       El invariante que NO se puede romper es el otro: el valor devuelto nunca
       puede ser MENOR que la espera real, porque entonces el cliente volvería
       antes de tiempo y se llevaría otro 429. */
    const ip = claveNueva();
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) await una(ip);

    const r = await fetch(BASE + SUB, {
      headers: { 'CF-Connecting-IP': ip, [CABECERA_TOKEN]: TOKEN_PRUEBA }
    });
    assert.equal(r.status, 429);

    const cabecera = Number(r.headers.get('Retry-After'));
    assert.equal(cabecera % 10, 0, `Retry-After=${cabecera} no es múltiplo de 10`);
    assert.ok(cabecera > 0 && cabecera <= 60, `Retry-After=${cabecera} fuera de rango`);

    /* La marca más antigua se puso en la primera petición, hacia t0. Lo que de
       verdad queda por esperar es la ventana menos lo transcurrido. */
    const restanteReal = 60 - (Date.now() - t0) / 1000;
    assert.ok(cabecera >= restanteReal,
      `Retry-After=${cabecera} es MENOR que la espera real ${restanteReal.toFixed(1)}s`);
  });

  test('ráfaga posterior inmediata: 0 aceptadas', async () => {
    const ip = claveNueva();
    assert.equal((await rafaga(40, ip)).aceptadas, TOPE);
    assert.equal((await rafaga(40, ip)).aceptadas, 0);
    assert.equal((await rafaga(40, ip)).aceptadas, 0);
  });

  test('recuperación al vencer la ventana (ventana corta de 2 s)', async () => {
    /* Contra el DO directamente para no esperar 60 s. La semántica de la ventana
       es la misma; sólo cambia el parámetro. */
    const c = claveNueva();
    let ok = 0;
    for (let i = 0; i < 25; i++) if ((await consume(c, 20, 2000)).permitido) ok++;
    assert.equal(ok, 20);
    assert.equal((await consume(c, 20, 2000)).permitido, false);
    await new Promise(r => setTimeout(r, 2200));
    assert.equal((await consume(c, 20, 2000)).permitido, true, 'debe recuperarse al vencer la ventana');
  });

  test('borde de ventana: antes de T bloquea, pasado T libera una plaza', async () => {
    /* Con ventana deslizante cada marca caduca por su cuenta, así que el
       instante que importa es el de la marca MÁS VIEJA, no el del final del
       llenado. Llenar las 20 plazas cuesta más de un segundo de reloj real
       (son 20 idas y vueltas HTTP), así que el borde se calcula desde la
       primera marca. Un test que ignore eso mide otra cosa y falla sin motivo.
       Ventana amplia (8 s) para que el llenado quepa holgado dentro. */
    const c = claveNueva();
    const V = 8000;
    const t0 = Date.now();
    for (let i = 0; i < 20; i++) assert.equal((await consume(c, 20, V)).permitido, true);
    assert.equal((await consume(c, 20, V)).permitido, false, 'con 20 vivas debe rechazar');

    /* 400 ms ANTES de que caduque la primera marca. */
    const antes = t0 + V - 400 - Date.now();
    if (antes > 0) await new Promise(r => setTimeout(r, antes));
    assert.equal((await consume(c, 20, V)).permitido, false, 'antes de T debe seguir bloqueando');

    /* 400 ms DESPUÉS. La primera marca ya caducó: queda una plaza libre. */
    await new Promise(r => setTimeout(r, 800));
    assert.equal((await consume(c, 20, V)).permitido, true, 'pasado T debe liberar una plaza');
  });

  test('marcas de tiempo idénticas no se pisan (20 en el mismo milisegundo)', async () => {
    /* Con ventana deslizante por marcas, si el INSERT usara la marca como clave
       primaria dos peticiones en el mismo milisegundo colapsarían en una fila y
       el contador se quedaría corto. La tabla no tiene clave primaria justo por
       esto; la ráfaga simultánea lo ejercita. */
    const r = await rafaga(60, claveNueva());
    assert.equal(r.aceptadas, TOPE);
  });

  /* ---------- aislamiento entre identidades ---------- */

  test('dos claves distintas no se estorban', async () => {
    /* Secuenciales a propósito: dos ráfagas en paralelo son 80 subpeticiones
       simultáneas en el mismo isolate y tumban el workerd local (comprobado:
       500 y proceso muerto). El solape DENTRO de cada ráfaga, que es lo que
       prueba la atomicidad, se conserva entero. */
    const a = await rafaga(40, claveNueva());
    assert.equal(a.aceptadas, TOPE);
    const b = await rafaga(40, claveNueva());
    assert.equal(b.aceptadas, TOPE, 'la segunda clave no puede heredar el bloqueo de la primera');
  });

  test('una clave agotada no bloquea a una tercera', async () => {
    const a = claveNueva();
    assert.equal((await rafaga(40, a)).aceptadas, TOPE);
    assert.equal((await rafaga(10, a)).aceptadas, 0);
    assert.equal((await una(claveNueva())).codigo !== 429, true);
  });

  test('100 identidades distintas: ninguna comparte contador', async () => {
    /* `directo` hace que cada subpetición use una IP distinta. Si dos
       compartieran Durable Object, la segunda vería el contador de la primera y
       acabaría rechazada con 429. Por eso lo que se afirma aquí es que NO hay
       ningún 429, que es exactamente "ninguna comparte contador".
       Antes se afirmaba `aceptadas === 100`, y eso medía otra cosa: cualquier
       503 lo hacía fallar aunque el aislamiento fuera perfecto. Y ocurre: con
       100 peticiones a la vez, algunas validaciones de Turnstile no llegan a
       tiempo desde una sola máquina —se midió 14 de 100 en una tanda y 0 en las
       dos siguientes— y el Worker cierra, que es lo que debe hacer. Esos 503 se
       cuentan aparte; los 429 son los que delatarían una colisión. */
    const r = await rafaga(100, '203.0.114.', { directo: true });
    assert.equal(r.limitadas, 0, `${r.limitadas} identidades compartieron contador`);
    /* Puede haber algún 503 y no es un fallo del aislamiento: son 100 objetos
       DISTINTOS creándose a la vez, cada uno con su arranque en frío, y algunos
       pasan del presupuesto de 1500 ms. Es una carga que no tiene forma de
       producción —allí 100 identidades distintas son 100 personas, no una
       ráfaga simultánea desde una máquina— pero conviene que quede a la vista:
       es el mismo efecto que hace que el limitador cierre bajo cola. */
    assert.ok(r.aceptadas >= 80,
      `sólo ${r.aceptadas} de 100 llegaron al análisis (503=${r.cerradas})`);
  });

  test('IPv6 del mismo /64 comparten cuota; /64 distintos, no', async () => {
    /* Un cliente IPv6 suele recibir un /64 entero. Limitar por dirección
       completa regalaría cuota infinita a cualquiera con IPv6, así que la
       identidad se trunca a /64. */
    const base = '2001:db8:aaaa:bbbb';
    for (let i = 0; i < 20; i++) {
      const r = await una(`${base}::${i.toString(16)}`);
      assert.notEqual(r.codigo, 429, `la ${i + 1} no debería bloquearse`);
    }
    const mismo = await una(`${base}:ffff::9`);
    assert.equal(mismo.codigo, 429, 'otra dirección del mismo /64 debe compartir cuota');

    const otro = await una('2001:db8:aaaa:cccc::1');
    assert.notEqual(otro.codigo, 429, 'un /64 distinto debe tener cuota propia');
  });

  test('IPv4 y su forma mapeada en IPv6 son la misma identidad', async () => {
    const ip = claveNueva();
    for (let i = 0; i < 20; i++) assert.notEqual((await una(ip)).codigo, 429);
    const mapeada = await una('::ffff:' + ip);
    assert.equal(mapeada.codigo, 429, '::ffff:x.x.x.x debe compartir contador con x.x.x.x');
  });

  test('variantes de escritura de la misma IP no crean identidades nuevas', async () => {
    const ip = claveNueva();
    for (let i = 0; i < 20; i++) assert.notEqual((await una(ip)).codigo, 429);
    for (const variante of [` ${ip} `, `${ip}.`, ip.toUpperCase()]) {
      assert.equal((await una(variante)).codigo, 429, `la variante ${JSON.stringify(variante)} evadió el contador`);
    }
  });

  /* ---------- caché ---------- */

  test('una URL cacheada NO permite saltarse el contador', async () => {
    /* El limitador va ANTES de la Cache API justo por esto: si fuera después,
       una ráfaga contra una URL ya calculada se serviría entera. */
    const objetivo = '/?url=https%3A%2F%2Fejemplo.test%2Fcacheada';
    const calienta = claveNueva();
    await una(calienta, objetivo);                    /* deja la respuesta en caché */

    const ip = claveNueva();
    const r = await rafaga(60, ip, { sub: objetivo });
    assert.equal(r.aceptadas, TOPE, `una URL cacheada dejó pasar ${r.aceptadas}`);
  });

  test('URLs distintas comparten el mismo contador de identidad', async () => {
    const ip = claveNueva();
    let ok = 0;
    for (let i = 0; i < 25; i++) {
      const r = await una(ip, `/?url=https%3A%2F%2Fejemplo.test%2F${i}`);
      if (r.codigo !== 429) ok++;
    }
    assert.equal(ok, TOPE, 'cambiar la URL no debe dar cuota extra');
  });

  test('cambiar el orden o el contenido del query no da cuota extra', async () => {
    const ip = claveNueva();
    const rutas = [
      '/?url=https%3A%2F%2Fejemplo.test%2F%3Fa%3D1%26b%3D2',
      '/?url=https%3A%2F%2Fejemplo.test%2F%3Fb%3D2%26a%3D1',
      '/?url=https%3A%2F%2Fejemplo.test&x=1',
      '/?x=1&url=https%3A%2F%2Fejemplo.test'
    ];
    let ok = 0;
    for (let i = 0; i < 25; i++) {
      const r = await una(ip, rutas[i % rutas.length]);
      if (r.codigo !== 429) ok++;
    }
    assert.equal(ok, TOPE);
  });

  /* ---------- métodos y peticiones raras ---------- */

  test('OPTIONS no consume cuota (es preflight, no ejecuta nada caro)', async () => {
    const ip = claveNueva();
    for (let i = 0; i < 30; i++) {
      const r = await una(ip, SUB, { method: 'OPTIONS' });
      assert.equal(r.codigo, 200, 'el preflight debe seguir funcionando siempre');
    }
    /* Y la cuota real sigue intacta después de 30 preflights. */
    assert.notEqual((await una(ip)).codigo, 429);
  });

  test('métodos no permitidos dan 405 y no abren ninguna vía', async () => {
    const ip = claveNueva();
    for (const metodo of ['POST', 'PUT', 'DELETE', 'PATCH', 'HEAD']) {
      const r = await una(ip, SUB, { method: metodo });
      assert.ok([405, 429].includes(r.codigo), `${metodo} devolvió ${r.codigo}`);
    }
  });

  test('peticiones malformadas no consumen cuota ni ejecutan el análisis', async () => {
    const ip = claveNueva();
    const malas = [
      '/',                                   /* sin parámetro */
      '/?url=',                              /* vacío */
      '/?url=%01%02basura',
      '/?url=file%3A%2F%2F%2Fetc%2Fpasswd',
      '/?url=http%3A%2F%2F127.0.0.1%2F'
    ];
    for (const ruta of malas) {
      const r = await una(ip, ruta);
      assert.ok([400, 405].includes(r.codigo), `${ruta.slice(0, 40)} devolvió ${r.codigo}`);
    }
    /* La cuota sigue entera: nada de lo anterior llegó al limitador. */
    let ok = 0;
    for (let i = 0; i < 25; i++) if ((await una(ip)).codigo !== 429) ok++;
    assert.equal(ok, TOPE);
  });

  test('una URL larga pero válida se acepta y consume cuota', async () => {
    /* No es una petición malformada: 4000 caracteres de ruta son legales y el
       Worker debe tratarla como cualquier otra, contándola. Se comprueba aquí y
       no entre las malformadas porque confundir ambas cosas fue un error real
       de esta suite: daba por rechazada una petición que sí se procesa. */
    const ip = claveNueva();
    const larga = '/?url=' + encodeURIComponent('https://ejemplo.test/' + 'a'.repeat(4000));
    const r = await una(ip, larga);
    assert.ok([200, 502].includes(r.codigo), `devolvió ${r.codigo}`);
    assert.equal(r.lim, 'ok');
  });

  test('Unicode y cabeceras raras no rompen la identidad', async () => {
    const ip = claveNueva();
    const r = await una(ip, '/?url=' + encodeURIComponent('https://ejemplo.test/ñandú-café-日本'), {
      headers: { 'X-Rara': 'ü'.repeat(50), 'Accept-Language': 'es-ES,es;q=0.9' }
    });
    assert.ok([200, 502].includes(r.codigo), `devolvió ${r.codigo}`);
    assert.equal(r.lim, 'ok');
  });

  test('camino completo por TCP: el Worker real responde y marca la cabecera', async () => {
    const r = await una(claveNueva());
    assert.notEqual(r.codigo, 429);
    assert.equal(r.lim, 'ok');
  });
});
