/**
 * Pruebas de FALLO CERRADO.
 *
 *   cd "Kimi_Agent_Web 3D Optimizada/cloudflare"
 *   node --test test/fallo-cerrado.test.mjs
 *
 * La política es: si el limitador no puede garantizar que la petición cabe en
 * la cuota, el diagnóstico NO se ejecuta. Estas pruebas comprueban justo eso, y
 * el truco para demostrarlo sin instrumentar el Worker está en el destino:
 *
 *   se pide el análisis de https://ejemplo.test, un dominio que no resuelve.
 *
 *   - Si el análisis LLEGA A EJECUTARSE, falla resolviendo y sale 502.
 *   - Si el fallo cerrado funciona, sale 503 sin haberlo intentado.
 *
 * Así que distinguir 503 de 502 es la prueba conductual de que la operación
 * cara no se ejecutó. No hace falta creerse el código: se ve en el estado.
 *
 * Cada escenario levanta su propio `wrangler dev`, así que la suite tarda.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { arranca, para, TOKEN_PRUEBA, CABECERA_TOKEN } from './arranque.mjs';

const DESTINO = '/?url=https%3A%2F%2Fejemplo.test';
const IP = '198.51.100.77';

async function pide(base, ip = IP, ruta = DESTINO) {
  const r = await fetch(base + ruta, {
    headers: { 'CF-Connecting-IP': ip, [CABECERA_TOKEN]: TOKEN_PRUEBA }
  });
  let cuerpo = null;
  try { cuerpo = await r.json(); } catch { /* puede no ser json */ }
  return { codigo: r.status, limitador: r.headers.get('X-Limitador'), cuerpo };
}

/** Levanta, comprueba y para. Deja el puerto libre pase lo que pase. */
async function conLab({ config, puerto, vars }, fn) {
  let lab = null;
  try {
    lab = await arranca({ config, puerto, vars });
    await fn(lab);
  } finally {
    await para(lab);
  }
}

describe('fallo cerrado: ninguna rama de error ejecuta el análisis', () => {

  test('SAL_LIMITE ausente -> 503, no 502', async () => {
    await conLab({ config: 'test/wrangler.sinsal.toml', puerto: 8961 }, async lab => {
      const r = await pide(lab.base);
      assert.equal(r.codigo, 503, `esperaba 503; un 502 significaría que el análisis se ejecutó`);
      assert.equal(r.limitador, 'sin-identidad');
    });
  });

  test('SAL_LIMITE vacía -> 503, no 502', async () => {
    await conLab({ config: 'test/wrangler.test.toml', puerto: 8962, vars: { SAL_LIMITE: '""' } },
      async lab => {
        const r = await pide(lab.base);
        assert.equal(r.codigo, 503);
        assert.equal(r.limitador, 'sin-identidad');
      });
  });

  test('SAL_LIMITE demasiado corta -> 503, no 502', async () => {
    await conLab({ config: 'test/wrangler.test.toml', puerto: 8963, vars: { SAL_LIMITE: 'corta' } },
      async lab => {
        const r = await pide(lab.base);
        assert.equal(r.codigo, 503);
        assert.equal(r.limitador, 'sin-identidad');
      });
  });

  test('SAL_LIMITE larga pero sin variedad -> 503, no 502', async () => {
    /* 64 caracteres, un solo símbolo distinto. Pasa el mínimo de longitud y
       debe caer igualmente: una sal predecible no es una sal. */
    const pobre = 'a'.repeat(64);
    await conLab({ config: 'test/wrangler.test.toml', puerto: 8964, vars: { SAL_LIMITE: pobre } },
      async lab => {
        const r = await pide(lab.base);
        assert.equal(r.codigo, 503);
        assert.equal(r.limitador, 'sin-identidad');
      });
  });

  test('binding del Durable Object ausente -> 503, no 502', async () => {
    await conLab({ config: 'test/wrangler.sinbinding.toml', puerto: 8965 }, async lab => {
      const r = await pide(lab.base);
      assert.equal(r.codigo, 503);
      assert.equal(r.limitador, 'sin-binding');
    });
  });

  test('sin CF-Connecting-IP -> 503 (identidad indeterminable)', async () => {
    await conLab({ config: 'test/wrangler.test.toml', puerto: 8966 }, async lab => {
      /* Sin la cabecera no hay identidad de confianza. Miniflare no la inyecta,
         así que este caso es reproducible en local tal cual. El token sí va:
         lo que se prueba aquí es la ausencia de IP, no la de Turnstile. */
      const r = await fetch(lab.base + DESTINO, { headers: { [CABECERA_TOKEN]: TOKEN_PRUEBA } });
      assert.equal(r.status, 503);
      assert.equal(r.headers.get('X-Limitador'), 'sin-identidad');
    });
  });

  test('IP con formato imposible -> 503', async () => {
    await conLab({ config: 'test/wrangler.test.toml', puerto: 8967 }, async lab => {
      for (const mala of ['no-es-una-ip', '999.999.999.999', '::::', '1.2.3', '']) {
        const r = await pide(lab.base, mala);
        assert.equal(r.codigo, 503, `la IP ${JSON.stringify(mala)} debería cerrar`);
        assert.equal(r.limitador, 'sin-identidad');
      }
    });
  });

  test('el interruptor LIMITE_ATOMICO=off es la ÚNICA vía que abre', async () => {
    await conLab({ config: 'test/wrangler.test.toml', puerto: 8968, vars: { LIMITE_ATOMICO: 'off' } },
      async lab => {
        const r = await pide(lab.base);
        assert.equal(r.limitador, 'apagado');
        /* Con el limitador apagado el análisis SÍ se ejecuta y falla resolviendo
           el dominio inexistente: 502. Ese 502 es justamente la prueba de que
           en los casos anteriores el 503 significaba "no se ejecutó". */
        assert.equal(r.codigo, 502, 'apagado debe dejar pasar hasta el análisis');
      });
  });
});
