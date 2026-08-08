/**
 * Arnés de pruebas. NO se despliega nunca: vive en otro archivo y otra config.
 *
 * Existe por un motivo medido, no teórico: entrando por TCP contra
 * `wrangler dev`, workerd atiende las peticiones de una en una. Se probaron 40
 * lanzadas a la vez —con fetch y también con 40 sockets crudos y barrera de
 * arranque— y el máximo en vuelo simultáneo fue 1. La consecuencia es que
 *
 *   una prueba de concurrencia que ENTRA POR TCP no prueba concurrencia:
 *   el contador viejo sobre Cache API, que en producción dejaba pasar 39 de 40,
 *   sacaba un 20/40 impecable por ese camino.
 *
 * Lo que sí produce solape real es abanicar desde DENTRO del isolate con un
 * service binding a sí mismo: ahí se midió 40 en vuelo de 40. De ahí `/__rafaga`.
 *
 * Importa `seo-audit.js` REAL, no un doble, para que un error de sintaxis o un
 * reexport roto de la clase del Durable Object hagan fallar la suite en vez de
 * pasar inadvertidos hasta el despliegue.
 */

import real from '../seo-audit.js';

export { LimitadorIP } from '../seo-audit.js';

let enVuelo = 0;
let maxEnVuelo = 0;

/* Contador de subpeticiones salientes. Envuelve el fetch global una sola vez,
   al cargar el módulo, y sólo existe en el arnés: el Worker de producción no
   sabe nada de esto. Sirve para medir cuánta red gasta un análisis de verdad,
   que es el número con el que se elige el tope de subpeticiones. */
let salientes = { total: 0, turnstile: 0, analisis: 0 };
const fetchReal = globalThis.fetch;
globalThis.fetch = function (recurso, opciones) {
  const u = String((recurso && recurso.url) || recurso || '');
  salientes.total++;
  if (u.includes('challenges.cloudflare.com') || u.includes('/verify')) salientes.turnstile++;
  else salientes.analisis++;
  return fetchReal.call(this, recurso, opciones);
};

function percentil(orden, p) {
  if (!orden.length) return 0;
  const i = Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1);
  return orden[i];
}

export default {
  async fetch(peticion, env, ctx) {
    const url = new URL(peticion.url);

    if (url.pathname === '/__salud') return new Response('ok');

    /* Lee y opcionalmente pone a cero el contador de subpeticiones salientes. */
    if (url.pathname === '/__salientes') {
      const antes = { ...salientes };
      if (url.searchParams.get('reset') === '1') salientes = { total: 0, turnstile: 0, analisis: 0 };
      return Response.json(antes);
    }

    /* Habla con el Durable Object directamente, saltándose el Worker. Sirve
       para probar la semántica de la ventana con ventanas cortas (2 s en vez de
       60) sin que la suite tarde minutos, y para medir el coste del propio
       limitador sin el resto del camino. */
    if (url.pathname === '/__consume') {
      const clave = url.searchParams.get('clave') || 'x';
      const tope = Number(url.searchParams.get('tope') || '20');
      const ventana = Number(url.searchParams.get('ventana') || '60000');
      const objeto = env.LIMITADOR_DO.get(env.LIMITADOR_DO.idFromName(clave));
      const t0 = Date.now();
      const r = await objeto.consume(tope, ventana);
      return Response.json({ ...r, ms: Date.now() - t0 });
    }

    /* Abanico directo contra el Durable Object, sin pasar por el Worker.
       Aísla la propiedad de atomicidad del resto de la política: por el camino
       del Worker, una implementación lenta o rota se traduce en 503 por el
       presupuesto de tiempo y el fallo cerrado, y entonces no se distingue
       "cuenta mal" de "va lento". Aquí sólo se mide lo primero. */
    if (url.pathname === '/__rafagaDO') {
      const n = Number(url.searchParams.get('n') || '100');
      const clave = url.searchParams.get('clave') || 'x';
      const tope = Number(url.searchParams.get('tope') || '20');
      const ventana = Number(url.searchParams.get('ventana') || '60000');
      const objeto = env.LIMITADOR_DO.get(env.LIMITADOR_DO.idFromName(clave));
      const promesas = [];
      for (let i = 0; i < n; i++) {
        promesas.push(
          objeto.consume(tope, ventana)
            .then(r => (r && r.permitido === true ? 1 : 0))
            .catch(() => -1)
        );
      }
      const r = await Promise.all(promesas);
      return Response.json({
        n,
        permitidas: r.filter(x => x === 1).length,
        rechazadas: r.filter(x => x === 0).length,
        errores: r.filter(x => x === -1).length
      });
    }

    /* Abanico. Lanza n subpeticiones en el mismo turno del bucle: se crean
       TODAS las promesas antes de ceder el turno, que es lo que produce el
       solape. Un `await` dentro del bucle lo serializaría y la suite daría
       verdes falsos. */
    if (url.pathname === '/__rafaga') {
      const n = Number(url.searchParams.get('n') || '40');
      const ip = url.searchParams.get('ip') || '203.0.113.1';
      const sub = url.searchParams.get('sub') || '/?url=https%3A%2F%2Fejemplo.test';
      const metodo = url.searchParams.get('metodo') || 'GET';
      const directo = url.searchParams.get('directo') === '1';
      maxEnVuelo = 0;

      /* El token va en todas las subpeticiones: Turnstile se valida antes que el
         limitador, así que sin él la ráfaga mediría 403 en vez de cuota. */
      const token = url.searchParams.get('token') || 'XXXX.DUMMY.TOKEN.XXXX';
      const promesas = [];
      const t0 = Date.now();
      for (let i = 0; i < n; i++) {
        /* `directo` reparte entre claves distintas: sirve para el aislamiento
           entre identidades sin lanzar una ráfaga por cada una. */
        const cab = {
          'CF-Connecting-IP': directo ? `${ip}${i}` : ip,
          'X-Turnstile-Token': token
        };
        const t = Date.now();
        promesas.push(
          env.YO.fetch('https://arnes.local' + sub, { method: metodo, headers: cab })
            .then(r => ({ codigo: r.status, lim: r.headers.get('X-Limitador'), ms: Date.now() - t }))
            .catch(e => ({ codigo: -1, lim: 'excepcion', ms: Date.now() - t, err: String(e).slice(0, 80) }))
        );
      }
      const todas = await Promise.all(promesas);
      const total = Date.now() - t0;
      const tiempos = todas.map(x => x.ms).sort((a, b) => a - b);

      const cuenta = {};
      for (const x of todas) cuenta[x.codigo] = (cuenta[x.codigo] || 0) + 1;

      return Response.json({
        n,
        aceptadas: todas.filter(x => x.codigo !== 429 && x.codigo !== 503 && x.codigo !== -1).length,
        limitadas: todas.filter(x => x.codigo === 429).length,
        cerradas: todas.filter(x => x.codigo === 503).length,
        errores: todas.filter(x => x.codigo === -1).length,
        codigos: cuenta,
        estados: [...new Set(todas.map(x => x.lim))],
        maxEnVuelo,
        totalMs: total,
        p50: percentil(tiempos, 50),
        p95: percentil(tiempos, 95),
        p99: percentil(tiempos, 99)
      });
    }

    enVuelo++;
    if (enVuelo > maxEnVuelo) maxEnVuelo = enVuelo;
    try {
      return await real.fetch(peticion, env, ctx);
    } finally {
      enVuelo--;
    }
  }
};
