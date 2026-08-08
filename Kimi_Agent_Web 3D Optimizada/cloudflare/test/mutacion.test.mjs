/**
 * Prueba negativa: demuestra que la suite DETECTA una sección crítica rota.
 *
 *   cd "Kimi_Agent_Web 3D Optimizada/cloudflare"
 *   node --test test/mutacion.test.mjs
 *
 * Un test de concurrencia en verde no demuestra nada por sí solo: puede estar
 * en verde porque el código es correcto o porque el arnés no llega a producir
 * solape. La única forma de distinguirlo es romper el limitador a propósito y
 * comprobar que la suite se pone roja.
 *
 * El archivo de producción NO se toca. El mutante se genera en un directorio
 * temporal a partir del código real, por sustitución de texto:
 *
 *   - se saca la sección crítica de `transactionSync`;
 *   - se mete un `await` entre el SELECT y el INSERT.
 *
 * Que se genere en vez de mantenerse a mano es deliberado: una copia del
 * limitador roto envejecería en cuanto alguien tocara el original y acabaría
 * probando código que ya no existe. Si alguna sustitución deja de encajar, este
 * test falla y avisa de que hay que revisarlo — que es justo lo que se quiere.
 *
 * Resultado esperado del mutante, ya medido: de 100 simultáneas pasan las 100.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, rm, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { arranca, para } from './arranque.mjs';

const PUERTO = 8971;

/** Aplica una sustitución y falla si no encajó: un mutante que no muta es un
 *  falso verde disfrazado. */
function sustituye(texto, de, a, etiqueta) {
  if (!texto.includes(de)) {
    throw new Error(
      `La mutación "${etiqueta}" ya no encaja con limitador-do.js. ` +
      `El código ha cambiado y hay que actualizar esta prueba negativa.`
    );
  }
  return texto.replace(de, a);
}

/** Saca la sección crítica de la transacción y mete un await en medio. Es el
 *  refactor descuidado clásico. */
function mutacionFuera(limitador) {
  let t = sustituye(
    limitador,
    '  #seccionCritica(tope, ventanaMs) {\n    return this.ctx.storage.transactionSync(() => {',
    '  async #seccionCritica(tope, ventanaMs) {\n    return await (async () => {',
    'abrir la sección crítica'
  );
  t = sustituye(
    t,
    "      sql.exec('INSERT INTO golpes (ts) VALUES (?)', ahora);",
    "      await new Promise(r => setTimeout(r, 0));\n      sql.exec('INSERT INTO golpes (ts) VALUES (?)', ahora);",
    'meter un await entre SELECT e INSERT'
  );
  t = sustituye(
    t,
    '      return { ok: true, permitido: true, restantes: tope - usados - 1, esperaS: 0 };\n    });',
    '      return { ok: true, permitido: true, restantes: tope - usados - 1, esperaS: 0 };\n    })();',
    'cerrar la sección crítica'
  );
  return sustituye(
    t,
    'const veredicto = this.#seccionCritica(t, w);',
    'const veredicto = await this.#seccionCritica(t, w);',
    'esperar la sección crítica'
  );
}

/** Deja la transacción en su sitio pero hace ASÍNCRONO su callback.
 *
 *  Ésta es la peligrosa de verdad, y por eso está aquí: el runtime la acepta
 *  sin rechistar. `transactionSync` devuelve la promesa, `consume` la asimila
 *  por ser async, y el Worker recibe una respuesta de forma impecable. No hay
 *  excepción, ni aviso de wrangler, ni cambio de firma que delate nada. La
 *  atomicidad simplemente deja de existir.
 *
 *  Se descubrió en revisión, después de que el comentario del propio limitador
 *  afirmara que era imposible. Por eso ahora `consume` comprueba si el
 *  veredicto es una promesa: es la única barrera real contra esto. */
function mutacionAsync(limitador) {
  let t = sustituye(
    limitador,
    'return this.ctx.storage.transactionSync(() => {',
    'return this.ctx.storage.transactionSync(async () => {',
    'hacer async el callback de la transacción'
  );
  t = sustituye(
    t,
    "      sql.exec('INSERT INTO golpes (ts) VALUES (?)', ahora);",
    "      await new Promise(r => setTimeout(r, 0));\n      sql.exec('INSERT INTO golpes (ts) VALUES (?)', ahora);",
    'meter un await dentro de la transacción'
  );
  /* Se retira la guarda para comprobar que, sin ella, el fallo es mudo. */
  return sustituye(
    t,
    "    if (veredicto && typeof veredicto.then === 'function') {\n      throw new Error('la sección crítica devolvió una promesa: no es atómica');\n    }",
    '    /* guarda retirada a propósito para esta mutación */',
    'retirar la guarda de promesa'
  );
}

/** Ignora el veredicto de siteverify: acepta el token pase lo que pase.
 *  Es el descuido más caro posible en esta capa, y desde fuera no se nota nada:
 *  el diagnóstico sigue funcionando, sólo que para todo el mundo. */
function mutacionTurnstile(worker) {
  return sustituye(
    worker,
    '  if (datos.success !== true) {',
    '  if (false) {',
    'ignorar el veredicto de siteverify'
  );
}

async function construyeMutante(mutar, mutarWorker) {
  const raiz = await mkdtemp(join(tmpdir(), 'syc-mutante-'));
  await mkdir(join(raiz, 'test'), { recursive: true });

  const limitador = mutar
    ? mutar(await readFile(new URL('../limitador-do.js', import.meta.url), 'utf8'))
    : await readFile(new URL('../limitador-do.js', import.meta.url), 'utf8');

  const worker = mutarWorker
    ? mutarWorker(await readFile(new URL('../seo-audit.js', import.meta.url), 'utf8'))
    : await readFile(new URL('../seo-audit.js', import.meta.url), 'utf8');

  await writeFile(join(raiz, 'limitador-do.js'), limitador, 'utf8');
  await writeFile(join(raiz, 'seo-audit.js'), worker, 'utf8');
  await copyFile(new URL('./arnes.js', import.meta.url), join(raiz, 'test', 'arnes.js'));
  await copyFile(new URL('./arranque.mjs', import.meta.url), join(raiz, 'test', 'arranque.mjs'));

  const toml = (await readFile(new URL('./wrangler.test.toml', import.meta.url), 'utf8'))
    .replace('name = "syc-seo-audit-test"', 'name = "syc-seo-audit-mutante"')
    .replace('service = "syc-seo-audit-test"', 'service = "syc-seo-audit-mutante"');
  await writeFile(join(raiz, 'test', 'wrangler.test.toml'), toml, 'utf8');

  return raiz;
}

const MUTANTES = [
  { nombre: 'sección crítica fuera de la transacción, con await', mutar: mutacionFuera, puerto: PUERTO },
  { nombre: 'callback de la transacción hecho async (fallo mudo)', mutar: mutacionAsync, puerto: PUERTO + 1 }
];

describe('prueba negativa: la suite detecta una sección crítica rota', () => {
  for (const m of MUTANTES) test(`${m.nombre}: 100 simultáneas pasan de largo`, async () => {
    const raiz = await construyeMutante(m.mutar, null);
    let lab = null;
    try {
      lab = await arranca({
        config: `"${join(raiz, 'test', 'wrangler.test.toml')}"`,
        puerto: m.puerto
      });

      /* Se mide contra el Durable Object directamente, no por el camino del
         Worker. Motivo, y es un resultado real de esta sesión: por el camino
         del Worker el mutante devolvía 9 aceptadas de 100, no 100. La carrera
         estaba ahí, pero el presupuesto de 800 ms y el fallo cerrado la
         convertían en una avalancha de 503. La suite lo detectaba igual —el
         resultado no era el correcto— pero el número no decía la verdad sobre
         lo que había fallado. Aislado del timeout, el sobrepaso se ve limpio. */
      const q = new URLSearchParams({ n: '100', clave: 'mutante-' + m.puerto, tope: '20' });
      const r = await (await fetch(`${lab.base}/__rafagaDO?${q}`)).json();

      assert.ok(r.permitidas > 20,
        `el mutante permitió ${r.permitidas} de 100 (el tope es 20): ` +
        `la suite NO detecta la carrera y sus verdes no valen`);

      console.log(`      mutante: ${r.permitidas}/100 permitidas — sobrepaso de ${r.permitidas - 20}, detectado`);
    } finally {
      await para(lab);
      await rm(raiz, { recursive: true, force: true }).catch(() => {});
    }
  });

  test('Turnstile que ignora el veredicto de siteverify: la suite lo detecta', async () => {
    /* La mutación más silenciosa de todas: el diagnóstico sigue funcionando,
       sólo que ya no filtra a nadie.
       Se prueba contra un siteverify simulado que responde `success:false` pero
       con hostname y action correctos. Hace falta ese simulador para AISLAR la
       comprobación: con las claves de prueba reales, una respuesta de fallo no
       trae hostname, así que la comprobación de hostname atrapa la mutación por
       su cuenta —dato útil, es defensa en profundidad real— y no se vería si la
       de `success` sigue viva o no. */
    const servidor = createServer((req, res) => {
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify({
        success: false,
        'error-codes': ['invalid-input-response'],
        hostname: 'example.com',
        action: 'diagnostico-seo'
      }));
    });
    await new Promise(r => servidor.listen(8953, '127.0.0.1', r));

    const raiz = await construyeMutante(null, mutacionTurnstile);
    let lab = null;
    try {
      lab = await arranca({
        config: `"${join(raiz, 'test', 'wrangler.test.toml')}"`,
        puerto: PUERTO + 2,
        vars: { TURNSTILE_URL: 'http://127.0.0.1:8953/verify' }
      });

      const r = await fetch(lab.base + '/?url=' + encodeURIComponent('https://ejemplo.test'), {
        headers: { 'CF-Connecting-IP': '203.0.113.77', 'X-Turnstile-Token': 'XXXX.DUMMY.TOKEN.XXXX' }
      });

      assert.notEqual(r.status, 403,
        'el mutante devolvió 403: la mutación no se aplicó y la prueba no valdría');
      console.log(`      mutante Turnstile: devolvió ${r.status} donde el código correcto da 403 — detectado`);
    } finally {
      await para(lab);
      await rm(raiz, { recursive: true, force: true }).catch(() => {});
      await new Promise(r => servidor.close(r));
    }
  });
});
