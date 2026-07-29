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
    res.writeHead(200, {
      'Content-Type': TIPOS[path.extname(destino).toLowerCase()] || 'application/octet-stream',
      'Cache-Control': 'no-store'
    });
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
