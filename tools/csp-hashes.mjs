/**
 * Recalcula los hashes SHA-256 de los scripts inline y los escribe en la
 * directiva script-src de app/_headers.
 *
 * Existe porque la web carga en una sola petición: el JS vive dentro del propio
 * HTML. Eso obligaba a poner 'unsafe-inline' en la CSP, y 'unsafe-inline' anula
 * justamente la protección que la CSP debería dar contra el XSS —precisamente
 * en la página que muestra texto traído de webs de terceros—. Con hashes se
 * conserva la petición única y se recupera la política.
 *
 * El precio es que los hashes caducan en cuanto se toca una línea de script.
 * Por eso esto es un script y no un valor escrito a mano:
 *
 *   node tools/csp-hashes.mjs           actualiza app/_headers
 *   node tools/csp-hashes.mjs --check   no escribe; sale con 1 si está desfasado
 *
 * El modo --check es el que debe correr antes de desplegar: si alguien editó el
 * HTML y olvidó regenerar, la CSP bloquearía el script y la web se quedaría sin
 * JavaScript en producción. Mejor que falle el despliegue.
 */

import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = join(dirname(fileURLToPath(import.meta.url)), '..');
const APP = join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'app');
const HEADERS = join(APP, '_headers');

/* Tipos que el navegador ejecuta. Un bloque application/ld+json es un dato,
   no un script: el navegador no lo ejecuta y la CSP no lo exige. Incluirlo
   ensuciaría la política con un hash que no hace falta. */
const EJECUTABLES = new Set(['', 'text/javascript', 'module', 'application/javascript']);

function hashesDe(html) {
  const fuera = [];
  const re = /<script([^>]*)>([\s\S]*?)<\/script>/gi;
  let m;
  while ((m = re.exec(html)) !== null) {
    const attrs = m[1] || '';
    if (/\bsrc\s*=/i.test(attrs)) continue;               // script externo: no lleva hash
    const tipo = (attrs.match(/\btype\s*=\s*["']?([^"'\s>]*)/i)?.[1] || '').toLowerCase();
    if (!EJECUTABLES.has(tipo)) continue;                 // ld+json y demás datos

    /* CRLF -> LF antes de calcular. No es cosmético: el HTML obliga al navegador
       a normalizar los saltos de línea al preprocesar el flujo de entrada, así
       que el hash que comprueba se calcula sobre LF aunque el archivo esté
       guardado con CRLF —que es el caso aquí, en Windows—. Sin esta línea los
       hashes se generan correctos «en disco» y el navegador los rechaza todos:
       la web se publica sin JavaScript y la CSP parece rota sin motivo. */
    const contenido = m[2].replace(/\r\n/g, '\n');
    fuera.push('sha256-' + createHash('sha256').update(contenido, 'utf8').digest('base64'));
  }
  return fuera;
}

const paginas = readdirSync(APP).filter(f => f.endsWith('.html')).sort();
const hashes = [];
const detalle = [];
for (const p of paginas) {
  const hs = hashesDe(readFileSync(join(APP, p), 'utf8'));
  detalle.push(`  ${p.padEnd(26)} ${hs.length} script(s) inline`);
  for (const h of hs) if (!hashes.includes(h)) hashes.push(h);
}

const directiva = "script-src 'self' " + hashes.map(h => `'${h}'`).join(' ');

const original = readFileSync(HEADERS, 'utf8');

/* Se ancla en la LÍNEA de la cabecera, no en la primera aparición del texto
   "script-src". El archivo lleva comentarios que mencionan la directiva, y un
   reemplazo global machacaba el comentario y dejaba la cabecera real intacta:
   el script decía haber actualizado y no había cambiado nada. */
const LINEA_CSP = /^(\s*Content-Security-Policy:\s*)(.*)$/m;
const linea = original.match(LINEA_CSP);
if (!linea) {
  console.error('ERROR: no se encontró la cabecera Content-Security-Policy en _headers');
  process.exit(2);
}
if (!/script-src [^;]*/.test(linea[2])) {
  console.error('ERROR: la cabecera CSP no contiene una directiva script-src');
  process.exit(2);
}
const actualizado = original.replace(
  LINEA_CSP,
  (_, prefijo, valor) => prefijo + valor.replace(/script-src [^;]*/, directiva)
);

console.log('Páginas analizadas:');
console.log(detalle.join('\n'));
console.log(`\n${hashes.length} hash(es) únicos:`);
hashes.forEach(h => console.log('  ' + h));

if (process.argv.includes('--check')) {
  if (original === actualizado) {
    console.log('\nOK: _headers está sincronizado con el HTML.');
    process.exit(0);
  }
  console.error('\nDESFASADO: los hashes de _headers no coinciden con el HTML actual.');
  console.error('Ejecuta:  node tools/csp-hashes.mjs');
  process.exit(1);
}

if (original === actualizado) {
  console.log('\n_headers ya estaba al día; no se ha escrito nada.');
} else {
  writeFileSync(HEADERS, actualizado, 'utf8');
  console.log('\n_headers actualizado.');
}
