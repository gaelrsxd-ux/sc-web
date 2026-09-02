#!/usr/bin/env node
/* ============================================================================
   LA HUELLA DE LAS HOJAS DE ESTILO

   Para qué está. Esta web sirve `assets/legal.css` y `assets/pedido.css` bajo
   un nombre que NO cambia nunca. El servidor manda `max-age=0, must-revalidate`,
   que en teoría obliga al navegador a preguntar antes de reutilizarlas — y en la
   práctica no siempre pasa: Safari en iOS reutiliza subrecursos desde su caché
   de memoria y desde la caché de páginas sin volver a preguntar, y si alguna vez
   hubo un service worker sirviéndolas, peor.

   El resultado es HTML NUEVO CON CSS VIEJO, que no se parece a un fallo de
   caché: se parece a un diseño roto. Pasó tres veces seguidas en el mismo
   teléfono, y cada vez costó media hora descartar que el CSS estuviera mal
   escrito, mal servido o mal desplegado — estaba bien las tres veces:

     · un contador de cantidad salió apilado en vertical y en versalitas,
     · un botón salió como la pastilla blanca del sistema de iOS,
     · y ese mismo botón, ya sin rótulo visible, salió como una rayita de
       cuatro píxeles que había que acertar para poder comprar.

   Lo que hace este archivo. Le pone a cada enlace de hoja de estilo una huella
   del CONTENIDO del archivo:

     <link rel="stylesheet" href="assets/pedido.css?v=a3f19c2e">

   Cambia el CSS → cambia la huella → cambia la dirección → el navegador no
   tiene nada que reutilizar y lo pide entero. Y mientras no cambie, la
   dirección tampoco, así que se sigue aprovechando la caché. No hay que
   acordarse de nada ni vaciar nada a mano.

   Cómo se usa:
     node tools/assets.mjs            reescribe los enlaces de los .html
     node tools/assets.mjs --check    no toca nada; falla si alguno no coincide

   ⚠ EL ORDEN IMPORTA. Esto cambia el HTML, así que va ANTES de
   `tools/csp-hashes.mjs` —que firma los <script> del mismo archivo— y después
   de `tools/precios.mjs`, que es quien reescribe el contenido. El hook y el CI
   los corren en ese orden.
   ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'app');

const comprobar = process.argv.includes('--check');

/* Ocho caracteres de SHA-256 del contenido. No hace falta más: esto no protege
   de nada, sólo distingue una versión de otra, y una dirección de doscientos
   caracteres es una dirección que nadie va a leer en un registro. */
const huella = ruta =>
  crypto.createHash('sha256').update(fs.readFileSync(ruta)).digest('hex').slice(0, 8);

/* Cualquier enlace a una hoja de estilo propia, con o sin huella ya puesta. La
   parte de la consulta se descarta entera y se vuelve a escribir: así una
   huella vieja no se acumula con la nueva. */
const ENLACE = /(<link[^>]*rel="stylesheet"[^>]*href=")assets\/([\w.-]+\.css)(\?[^"]*)?(")/g;
/* Y lo mismo con los scripts propios. El del checkout de los servicios vive en
   assets/servicio.js porque lo comparten cuatro páginas, y sin huella le pasaría
   lo que les pasaba a las hojas: HTML nuevo con script viejo en el teléfono, y
   un formulario de cobro que se comporta como el de la semana pasada. */
const SCRIPT = /(<script[^>]*src=")assets\/([\w.-]+\.js)(\?[^"]*)?(")/g;

const paginas = fs.readdirSync(APP).filter(f => f.endsWith('.html'));
const problemas = [];
let tocados = 0, enlaces = 0;

for (const pagina of paginas) {
  const ruta = path.join(APP, pagina);
  const antes = fs.readFileSync(ruta, 'utf8');

  const sella = (todo, ini, archivo, _vieja, fin) => {
    const ruta = path.join(APP, 'assets', archivo);
    /* Un enlace a un archivo que no existe se deja como está y se avisa: es un
       fallo de otra clase —un 404 en producción— y taparlo con una huella
       inventada sólo lo escondería. */
    if (!fs.existsSync(ruta)) {
      problemas.push(`${pagina}: enlaza assets/${archivo}, que no existe`);
      return todo;
    }
    enlaces++;
    return `${ini}assets/${archivo}?v=${huella(ruta)}${fin}`;
  };
  const despues = antes.replace(ENLACE, sella).replace(SCRIPT, sella);

  if (despues === antes) continue;
  tocados++;
  if (comprobar) {
    problemas.push(`${pagina}: la huella de alguna hoja de estilo o script no coincide con su contenido`);
  } else {
    fs.writeFileSync(ruta, despues);
  }
}

if (problemas.length) {
  console.error('Huellas de las hojas de estilo y scripts:\n  ' + problemas.join('\n  '));
  console.error('\nSe arregla con:  node tools/assets.mjs');
  process.exit(1);
}

console.log(comprobar
  ? `OK: los ${enlaces} enlaces a hojas de estilo y scripts llevan la huella de su contenido.`
  : (tocados
      ? `Huella puesta en ${enlaces} enlace(s) de ${tocados} página(s).`
      : `Sin cambios: los ${enlaces} enlaces ya llevan la huella de su contenido.`));
