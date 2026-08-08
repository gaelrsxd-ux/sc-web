/**
 * Arranque y parada de `wrangler dev` para las suites de prueba.
 *
 * Dos escollos de Windows que ya han mordido y por eso están resueltos aquí:
 *
 *  - Node >= 20 se niega a lanzar un .cmd directamente (CVE-2024-27980), así que
 *    hace falta shell. Y el comando va en UNA cadena, no en array: con array,
 *    `shell: true` concatena sin escapar y la ruta de este proyecto lleva
 *    espacios.
 *  - Con shell, `kill()` mata sólo al cmd.exe intermedio y deja workerd vivo
 *    ocupando el puerto. La siguiente ejecución falla con "address in use" sin
 *    explicar por qué. Hay que matar el árbol entero.
 */

import { spawn } from 'node:child_process';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const ES_WIN = process.platform === 'win32';

/* Token que emite el widget cuando se usa una sitekey de prueba. Con una secret
   key de prueba, siteverify ignora por completo el valor del token —comprobado
   contra el servicio real— así que cualquier cadena valdría; se usa el literal
   documentado para que las pruebas se parezcan a lo que enviará el widget. */
export const TOKEN_PRUEBA = 'XXXX.DUMMY.TOKEN.XXXX';
export const CABECERA_TOKEN = 'X-Turnstile-Token';

export function matarArbol(p) {
  if (!p || p.exitCode !== null) return;
  if (ES_WIN) spawn('taskkill', ['/pid', String(p.pid), '/T', '/F'], { stdio: 'ignore' });
  else { try { process.kill(-p.pid, 'SIGTERM'); } catch { p.kill('SIGTERM'); } }
}

export async function esperaArranque(base, intentos = 120) {
  for (let i = 0; i < intentos; i++) {
    try {
      const r = await fetch(base + '/__salud');
      if (r.ok) return true;
    } catch { /* todavía no escucha */ }
    await new Promise(r => setTimeout(r, 500));
  }
  return false;
}

/**
 * Levanta wrangler dev. Devuelve { proc, dir, base } o lanza si no arranca.
 * `vars` es un objeto de sobrescrituras --var.
 */
export async function arranca({ config, puerto, vars = {} }) {
  const dir = await mkdtemp(join(tmpdir(), 'syc-do-'));
  const extra = Object.entries(vars).map(([k, v]) => `--var ${k}:${v}`).join(' ');
  const cmd = `npx wrangler dev -c ${config}` +
    ` --port ${puerto} --persist-to "${dir}" --log-level error ${extra}`;
  const proc = spawn(cmd, { shell: true, stdio: ['ignore', 'pipe', 'pipe'] });
  const base = `http://127.0.0.1:${puerto}`;

  let salida = '';
  proc.stderr.on('data', d => { salida += String(d); });
  proc.stdout.on('data', d => { salida += String(d); });

  if (!(await esperaArranque(base))) {
    matarArbol(proc);
    await rm(dir, { recursive: true, force: true }).catch(() => {});
    throw new Error(`wrangler dev no arrancó con ${config}\n${salida.slice(-1500)}`);
  }
  return { proc, dir, base };
}

export async function para(lab) {
  if (!lab) return;
  matarArbol(lab.proc);
  await new Promise(r => setTimeout(r, 900));
  await rm(lab.dir, { recursive: true, force: true }).catch(() => {});
}
