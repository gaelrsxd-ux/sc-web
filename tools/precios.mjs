#!/usr/bin/env node
/* ============================================================================
   PRECIOS DE LA PLACA DE RESEÑAS — UNA SOLA FUENTE

   Para qué está: un precio vivía escrito en TRES sitios dentro de cada fila
   —el texto del mensaje de WhatsApp, la etiqueta accesible y lo que se ve— y
   hay once filas. Cambiar la lista a mano eran treinta y tres ediciones que
   tenían que coincidir entre sí, más el precio de cabecera y la línea de envío.
   La primera vez que una se olvida, la web enseña un precio y WhatsApp manda
   otro, y quien lo descubre es el cliente al pedir.

   Aquí se escribe la tabla UNA vez y este archivo reescribe el HTML entero:
   la lista de paquetes, el precio grande del producto y la línea del envío.

   Cómo se usa:
     node tools/precios.mjs            reescribe app/index.html
     node tools/precios.mjs --check    no toca nada; falla si el HTML no
                                       coincide con la tabla (para el hook y CI)

   Después de tocar el HTML hay que regenerar las huellas de la CSP:
     node tools/csp-hashes.mjs
   (Sólo hace falta si cambia algún <script>. Este archivo no toca scripts, pero
   csp-hashes --check es barato y desambigua.)
   ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const HTML = path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'app', 'index.html');

/* ---------------------------------------------------------------- LA TABLA */

/* El número de WhatsApp al que van todos los pedidos. Si cambia, cambia aquí
   y en el bloque de contacto del HTML —ese no lo genera este archivo—. */
const WHATSAPP = '524423697248';

/* ---------- COBRO EN LÍNEA ----------
   Vacío = apagado, y entonces cada paquete usa su propio enlace `pago` de la
   tabla, que es el modo de los enlaces creados a mano en el panel.

   Con la dirección del Worker puesta, manda ESTE modo y lo hace para los ONCE
   paquetes a la vez: el cobro se crea al vuelo y ya no hacen falta enlaces
   sueltos. Es la diferencia entre crear once enlaces en el móvil cada vez que
   cambie un precio y no crear ninguno nunca más.

   Y es lo único que permite cobrar de contado: los enlaces del panel dejan las
   mensualidades bloqueadas después de crearlos. Ver cloudflare/pagos/. */
const COBRO_EN_LINEA = 'https://pagos.sycsolutions.company/ir';

/* A partir de cuántas placas se habla de «el paquete de N» y no de «N placas»
   en el mensaje de WhatsApp. Es una decisión de REDACCIÓN y por eso vive
   aparte: antes coincidía con el umbral del envío gratis, y al bajar ése a
   cuatro se habría llevado por delante la forma de pedir de medio catálogo sin
   que nadie lo decidiera. */
const PAQUETE_DESDE = 10;

/* Los paquetes, en el orden en que se enseñan. `precio` es el TOTAL del
   paquete en pesos, no el precio por unidad.

   `pago` es el enlace de pago de Mercado Pago de ese paquete, creado en el
   panel. Vacío = ese paquete todavía no se puede pagar en línea y la fila se
   comporta como siempre: sólo pedir por WhatsApp. Así la lista nunca enseña un
   botón de pagar que no lleve a ninguna parte.

   ⚠ El importe del enlace de Mercado Pago debe ser el TOTAL CON ENVÍO, que es
   la columna `total` que imprime `node tools/precios.mjs --tabla`. Si se crea
   el enlace por el precio del paquete a secas, el envío de los paquetes de
   menos de diez piezas se queda sin cobrar. */
const PAQUETES = [
  { piezas:  1, precio:  429, envio: 79, pago: '' },
  { piezas:  2, precio:  699, envio: 69, pago: '' },
  { piezas:  3, precio:  799, envio: 59, pago: '' },
  { piezas:  4, precio:  949, envio:  0, pago: '', destaca: true },
  { piezas:  5, precio: 1099, envio:  0, pago: '' },
  { piezas:  6, precio: 1249, envio:  0, pago: '' },
  { piezas:  8, precio: 1599, envio:  0, pago: '' },
  { piezas: 10, precio: 1899, envio:  0, pago: '' },
  { piezas: 12, precio: 2199, envio:  0, pago: '' },
  { piezas: 15, precio: 2649, envio:  0, pago: '' },
  { piezas: 20, precio: 3399, envio:  0, pago: '' },
];

/* ------------------------------------------------------------- HERRAMIENTAS */

/* El HTML de este sitio escribe los acentos como entidades numéricas. Se
   respeta: mezclar UTF-8 crudo con entidades en el mismo archivo funciona pero
   deja un diff sucio cada vez que alguien edita a mano. */
const ent = t => [...t].map(c => c.charCodeAt(0) > 126 ? `&#${c.charCodeAt(0)};` : c).join('');

/* Miles con coma: $1,899. Es como se enseñan los precios en el sitio. */
const miles = n => n.toLocaleString('en-US');

const gratis = p => p.envio === 0;
const total  = p => p.precio + p.envio;
const piezas = p => p.piezas === 1 ? '1 pieza' : `${p.piezas} piezas`;
const placas = p => p.piezas === 1 ? '1 placa' : `${p.piezas} placas`;

/* Desde cuántas piezas sale gratis. Se DEDUCE de la tabla en vez de escribirse:
   si mañana el envío gratis empieza en seis, el texto lo dice solo. */
function desdeGratis() {
  const primera = PAQUETES.find(gratis);
  if (!primera) throw new Error('ningún paquete tiene el envío gratis; revisa la tabla');
  return primera.piezas;
}

/* El mensaje que llega a WhatsApp ya escrito. Los paquetes con envío gratis se
   piden como «el paquete de N placas» y los de menos, como «N placas»: a
   partir de diez lo que se compra es el paquete, y por debajo son piezas
   sueltas. Es el texto que ya estaba; se conserva. */
function mensaje(p) {
  const qué = p.piezas >= PAQUETE_DESDE ? `el paquete de ${placas(p)}` : placas(p);
  const cierre = gratis(p)
    ? `Total: $${miles(p.precio)} MXN con envío gratis.`
    : `Total: $${miles(p.precio)} MXN + $${p.envio} de envío.`;
  return `Hola. Vengo de la web y quiero ${qué} de reseñas de Google (NFC + QR). ${cierre}`;
}

function etiquetaPedir(p) {
  const cierre = gratis(p) ? 'con envío gratis' : `más ${p.envio} de envío`;
  return `Pedir el paquete de ${piezas(p)} por WhatsApp, ${p.precio} pesos ${cierre}`;
}

function etiquetaPagar(p) {
  const cierre = gratis(p) ? 'con envío gratis' : 'con el envío incluido';
  return `Pagar en línea el paquete de ${piezas(p)}, ${total(p)} pesos ${cierre}`;
}

/* ------------------------------------------------------------- EL GENERADOR */

/* encodeURIComponent deja SIN escapar !'()*~, que son «marcas» permitidas en
   una URL. Los mensajes llevan paréntesis —«(NFC + QR)»— y el HTML del sitio
   los tenía escritos como %28 y %29. Ambas formas funcionan, pero si no se
   escapan aquí, regenerar la lista cambia once URLs sin que nadie haya tocado
   un precio, y ese ruido esconde el cambio real en el diff. */
const url = t => encodeURIComponent(t).replace(/[!'()*]/g, c => '%' + c.charCodeAt(0).toString(16).toUpperCase());

function fila(p) {
  const wa = `https://wa.me/${WHATSAPP}?text=${url(mensaje(p))}`;
  const clase = p.destaca ? ' class="pm-destaca"' : '';
  const envío = gratis(p)
    ? '<span class="pm-e gratis">' + ent('Envío gratis') + '</span>'
    : '<span class="pm-e">' + ent(`Envío $${p.envio} MXN`) + '</span>';
  const datos =
    `<span class="pm-q">${piezas(p)}</span>` +
    `<span class="pm-p">$${miles(p.precio)} MXN</span>` +
    envío;

  /* Con el Worker encendido, el botón es un FORMULARIO y no un enlace. Manda
     sólo el identificador del paquete —nunca el importe, que lo pone el
     servidor— y el Worker responde con una redirección al checkout. Sin
     JavaScript: funciona con el JS desactivado, no añade una huella a la CSP y
     no puede quedarse a medias por un fetch fallido. */
  if (COBRO_EN_LINEA) {
    return `              <li${clase} data-pago><a class="pm-pide" href="${wa}" target="_blank" rel="noopener noreferrer"\n` +
           `                     aria-label="${ent(etiquetaPedir(p))}">${datos}</a>` +
           `<form class="pm-form" method="post" action="${COBRO_EN_LINEA}">` +
           `<input type="hidden" name="paquete" value="${p.piezas}">` +
           `<button class="pm-paga" type="submit"\n` +
           `                     aria-label="${ent(etiquetaPagar(p))}">Pagar $${miles(total(p))}</button></form></li>`;
  }

  /* Sin enlace de pago la fila es exactamente lo que era: un solo enlace a
     WhatsApp que envuelve los tres datos. */
  if (!p.pago) {
    return `              <li${clase}><a href="${wa}" target="_blank" rel="noopener noreferrer"\n` +
           `                     aria-label="${ent(etiquetaPedir(p))}">${datos}</a></li>`;
  }

  /* Con enlace de pago la fila pasa a tener DOS acciones, y por eso los datos
     dejan de ir dentro del enlace de WhatsApp: un <a> no puede contener otro
     <a>, así que envolver la fila entera y meter dentro el botón de pagar
     produce un marcado inválido que cada navegador repara a su manera. */
  return `              <li${clase} data-pago><a class="pm-pide" href="${wa}" target="_blank" rel="noopener noreferrer"\n` +
         `                     aria-label="${ent(etiquetaPedir(p))}">${datos}</a>` +
         `<a class="pm-paga" href="${p.pago}" target="_blank" rel="noopener noreferrer"\n` +
         `                     aria-label="${ent(etiquetaPagar(p))}">Pagar $${miles(total(p))}</a></li>`;
}

function lista() {
  return '<ul class="pm-lista">\n' + PAQUETES.map(fila).join('\n') + '\n            </ul>';
}

/* La cifra grande del producto es el precio de una pieza. Se deriva de la tabla
   en vez de escribirse aparte: enseñar $429 arriba y $449 en la lista es
   exactamente el fallo que este archivo existe para impedir. */
function cifra() {
  const una = PAQUETES.find(p => p.piezas === 1);
  if (!una) throw new Error('la tabla no tiene el paquete de 1 pieza, que es de donde sale el precio de cabecera');
  return `<span class="cifra">$${miles(una.precio)}</span>`;
}

/* Va justo debajo de «$429 MXN · una pieza», así que dice el envío DE UNA
   PIEZA y no el más barato del catálogo: quien lee esa cifra está mirando la
   compra de una, y anunciarle los $59 del paquete de tres sería cierto y
   engañoso a la vez. */
function lineaEnvio() {
  const una = PAQUETES.find(x => x.piezas === 1);
  if (!una) throw new Error('la tabla no tiene el paquete de 1 pieza');
  return '<p class="prod-envio">' + ent(`Envío $${una.envio} MXN · gratis desde ${desdeGratis()} piezas`) + '</p>';
}

/* La nota al pie de la lista. Estaba escrita a mano en el HTML con «Envío $149
   MXN, gratis a partir de 10 piezas» dentro, es decir, una copia más del envío
   que este archivo no controlaba: al cambiar la tarifa se habría quedado
   contradiciendo a la lista que tiene tres centímetros encima. Ahora la genera
   él, y por eso no repite importes —los lleva cada fila— sino la regla. */
function notaLista() {
  const texto =
    'Precios totales por paquete, no por pieza. El envío baja con la cantidad y\n' +
    '              es gratis desde ' + desdeGratis() + ' piezas. Pulsa el paquete que necesitas y se abre\n' +
    '              WhatsApp con tu pedido ya escrito.';
  return '<p class="pm-n">' + ent(texto) + '</p>';
}

/* ---------------------------------------------------------- PARA EL WORKER

   El Worker de cobros NO puede fiarse del importe que le mande el navegador:
   si el precio viajara en el formulario, cualquiera editaría el HTML y pagaría
   un peso por veinte placas. Así que el Worker lleva su propia tabla y sólo
   recibe QUÉ paquete se quiere.

   Y esa tabla se escribe desde aquí, no a mano, porque dos tablas de precios
   mantenidas por separado divergen: el día que suba un precio en la web y no en
   el Worker, la página diría una cosa y el cobro sería otra. `--check` compara
   también este archivo, así que no pueden separarse en silencio. */
const JSON_WORKER = path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'cloudflare', 'pagos', 'paquetes.json');

/* El MISMO Worker, en un solo archivo y con la tabla dentro, para pegar tal cual
   en el editor del panel de Cloudflare. Existe porque instalar el Worker con
   `wrangler` exige una terminal, y no todo el mundo tiene por qué pelearse con
   una: desde el panel se pega un archivo y se pulsa un botón.

   Se GENERA a partir de pagos.js, nunca se escribe a mano. Dos copias del mismo
   Worker mantenidas por separado divergen, y la que se acabaría quedando vieja
   es justo la que está desplegada. */
const JS_PEGAR = path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'cloudflare', 'pagos', 'pagos-para-pegar.js');
const JS_FUENTE = path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'cloudflare', 'pagos', 'pagos.js');

function paraPegar() {
  const fuente = fs.readFileSync(JS_FUENTE, 'utf8');
  const marca = /\/\* Con atributo de importación[\s\S]*?import TABLA from '\.\/paquetes\.json' with \{ type: 'json' \};/;
  if (!marca.test(fuente)) {
    throw new Error('no encuentro la línea que importa paquetes.json en pagos.js; ¿se renombró?');
  }
  return fuente.replace(marca,
    '/* ⚠ ARCHIVO GENERADO — no editar aquí.\n' +
    '   Es cloudflare/pagos/pagos.js con la tabla de precios metida dentro, para\n' +
    '   poder pegarlo entero en el editor del panel de Cloudflare sin subir un\n' +
    '   segundo archivo. Para cambiarlo se edita pagos.js o la tabla de\n' +
    '   tools/precios.mjs y se ejecuta `node tools/precios.mjs`. */\n' +
    'const TABLA = ' + paquetesJson().trimEnd() + ';');
}

function paquetesJson() {
  return JSON.stringify({
    _aviso: 'GENERADO por tools/precios.mjs. No editar a mano: se sobrescribe.',
    moneda: 'MXN',
    paquetes: PAQUETES.map(p => ({
      id: String(p.piezas),
      piezas: p.piezas,
      titulo: `Placa reseñas Google · ${piezas(p)} · ${gratis(p) ? 'envío gratis' : 'envío incluido'}`,
      total: total(p),
    })),
  }, null, 2) + '\n';
}

/* Cada bloque con el patrón que lo localiza en el HTML. El patrón se ancla en
   marcas que este archivo también escribe, así que si alguien renombra una
   clase, esto falla en voz alta en vez de generar un HTML a medias. */
const BLOQUES = [
  { nombre: 'lista de paquetes', re: /<ul class="pm-lista">[\s\S]*?<\/ul>/,        pinta: lista },
  { nombre: 'precio de cabecera', re: /<span class="cifra">\$[\d,]+<\/span>/,      pinta: cifra },
  { nombre: 'línea de envío',     re: /<p class="prod-envio">[\s\S]*?<\/p>/,       pinta: lineaEnvio },
  { nombre: 'nota de la lista',   re: /<p class="pm-n">[\s\S]*?<\/p>/,             pinta: notaLista },
];

function aplica(html) {
  let salida = html;
  for (const b of BLOQUES) {
    const encontrados = salida.match(new RegExp(b.re.source, 'g')) || [];
    if (encontrados.length !== 1) {
      throw new Error(`«${b.nombre}»: esperaba 1 coincidencia en el HTML y hay ${encontrados.length}`);
    }
    salida = salida.replace(b.re, () => b.pinta());
  }
  return salida;
}

/* ------------------------------------------------------------------- MANDOS */

const args = process.argv.slice(2);

if (args.includes('--tabla')) {
  console.log('\n  piezas   paquete      envío      TOTAL A COBRAR     pago en línea');
  console.log('  ' + '-'.repeat(68));
  for (const p of PAQUETES) {
    console.log(
      '  ' + String(p.piezas).padStart(6) +
      ('  $' + miles(p.precio)).padEnd(13) +
      (gratis(p) ? '  gratis' : '  $' + p.envio).padEnd(11) +
      ('  $' + miles(total(p))).padEnd(19) +
      /* Con el Worker encendido lo cubre para TODOS, y el enlace suelto de cada
         fila deja de usarse. Leer sólo `p.pago` decía «todavía no» de los once
         paquetes cuando los once ya se pueden pagar: una salida que miente es
         peor que no tenerla. */
      (COBRO_EN_LINEA ? 'sí (Worker)' : p.pago ? 'sí (enlace)' : 'todavía no')
    );
  }
  console.log('\n  El importe del enlace de Mercado Pago es la columna TOTAL A COBRAR.\n');
  process.exit(0);
}

const original = fs.readFileSync(HTML, 'utf8');
const generado = aplica(original);

const jsonEsperado = paquetesJson();
const jsonActual = fs.existsSync(JSON_WORKER) ? fs.readFileSync(JSON_WORKER, 'utf8') : null;
const pegarEsperado = paraPegar();
const pegarActual = fs.existsSync(JS_PEGAR) ? fs.readFileSync(JS_PEGAR, 'utf8') : null;

if (args.includes('--check')) {
  if (pegarActual !== pegarEsperado) {
    console.error('\n  cloudflare/pagos/pagos-para-pegar.js está desfasado respecto a pagos.js.');
    console.error('  Quien lo pegue en Cloudflare desplegaría una versión vieja del Worker.');
    console.error('  Arréglalo con:  node tools/precios.mjs\n');
    process.exit(1);
  }
  if (jsonActual !== jsonEsperado) {
    console.error('\n  La tabla del Worker de cobros no coincide con tools/precios.mjs.');
    console.error('  Publicar así cobraría un importe distinto del que enseña la web.');
    console.error('  Arréglalo con:  node tools/precios.mjs\n');
    process.exit(1);
  }
  if (original === generado) {
    console.log('OK: la lista de precios del HTML coincide con tools/precios.mjs.');
    process.exit(0);
  }
  console.error('\n  El HTML NO coincide con la tabla de tools/precios.mjs.');
  console.error('  Alguien editó los precios a mano, o se cambió la tabla y no se regeneró.');
  console.error('  Arréglalo con:  node tools/precios.mjs\n');
  process.exit(1);
}

if (jsonActual !== jsonEsperado) {
  fs.mkdirSync(path.dirname(JSON_WORKER), { recursive: true });
  fs.writeFileSync(JSON_WORKER, jsonEsperado);
  console.log('Reescrita la tabla del Worker de cobros (cloudflare/pagos/paquetes.json).');
}

if (pegarActual !== pegarEsperado) {
  fs.writeFileSync(JS_PEGAR, pegarEsperado);
  console.log('Reescrito el Worker de un solo archivo (cloudflare/pagos/pagos-para-pegar.js).');
}

if (original === generado) {
  console.log('Sin cambios: el HTML ya coincide con la tabla.');
} else {
  fs.writeFileSync(HTML, generado);
  console.log('Reescrito app/index.html desde la tabla de precios.');
  console.log('Recuerda:  node tools/csp-hashes.mjs --check');
}
