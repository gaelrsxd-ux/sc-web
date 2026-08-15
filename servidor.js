/* Servidor local para ver la web en el navegador.
   Sin dependencias: solo Node. Sirve la carpeta app/ en modo lectura.

     cd "C:\Users\gaelr\OneDrive\Desktop\WEB"; node servidor.js

   Para usar otro puerto:  node servidor.js 8080
   El diagnóstico SEO solo responde desde el 8080, porque es el que el Worker
   tiene autorizado; para el resto de la página da igual el puerto. */
const http = require('http');
const fs = require('fs');
const path = require('path');

const raiz = path.join(__dirname, 'Kimi_Agent_Web 3D Optimizada', 'app');
const puerto = +(process.argv[2] || 8090);

/* ---------- LA MISMA POLÍTICA DE CONTENIDO QUE EN PRODUCCIÓN ----------
   Cloudflare Pages lee app/_headers al desplegar; este servidor no lo hacía, así
   que en local la página se veía SIN CSP. Eso convertía la prueba en local en un
   trámite vacío: los dos fallos que de verdad tumban esta web —una huella
   sha256 desfasada y un origen que falta en connect-src— sólo aparecían ya
   publicados. Se lee la misma línea del mismo archivo y se envía igual, para que
   la consola del navegador diga aquí lo que va a decir allí.
   Sólo esa cabecera: HSTS sobre http://localhost dejaría el puerto marcado como
   obligatorio-HTTPS en el navegador de quien pruebe, y eso sobrevive al final de
   la sesión.
   Se relee en CADA petición y no una vez al arrancar. Parece un derroche —son
   dos kilobytes— pero es justo lo contrario: el ciclo real es editar el HTML,
   correr  node tools/csp-hashes.mjs  y recargar. Con el valor guardado en
   memoria, esa recarga sigue enseñando la huella vieja y el navegador acusa un
   fallo que ya está arreglado; o peor, oculta uno que no lo está. */
function politicaContenido() {
  try {
    const linea = fs.readFileSync(path.join(raiz, '_headers'), 'utf8')
      .match(/^\s*Content-Security-Policy:\s*(.+)$/m);
    return linea ? linea[1].trim() : null;
  } catch (_) { return null; }
}
if (!politicaContenido()) console.warn('  Aviso: no se pudo leer la CSP de app/_headers; se sirve sin ella.');

const TIPOS = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.webp': 'image/webp',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.woff2': 'font/woff2'
};

if (!fs.existsSync(path.join(raiz, 'index.html'))) {
  console.error('No encuentro index.html en:\n  ' + raiz +
    '\nEjecuta este archivo desde la carpeta WEB.');
  process.exit(1);
}

const servidor = http.createServer((req, res) => {
  let rel = decodeURIComponent(req.url.split('?')[0]);
  if (rel === '/') rel = '/index.html';
  const destino = path.join(raiz, rel);
  /* Nunca servir fuera de la raíz */
  if (!destino.startsWith(raiz)) { res.writeHead(403).end('403'); return; }
  fs.readFile(destino, (err, buf) => {
    if (err) { res.writeHead(404, { 'Content-Type': 'text/plain' }).end('404'); return; }
    const cabeceras = {
      'Content-Type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    };
    const csp = politicaContenido();
    if (csp) cabeceras['Content-Security-Policy'] = csp;
    res.writeHead(200, cabeceras);
    res.end(buf);
  });
});

servidor.on('error', e => {
  if (e.code === 'EADDRINUSE') {
    console.error('El puerto ' + puerto + ' ya está ocupado.\n' +
      'Prueba con otro:  node servidor.js ' + (puerto + 1));
  } else console.error(e.message);
  process.exit(1);
});

servidor.listen(puerto, () => {
  console.log('\n  Web servida en:  http://localhost:' + puerto + '\n');
  console.log('  Abre esa dirección en el navegador.');
  console.log('  Para parar el servidor: Ctrl+C\n');
});
