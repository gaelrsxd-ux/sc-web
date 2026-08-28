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

/* `cuotas` es el número MÁXIMO de mensualidades que se ofrecen en el checkout.
   Sin poner nada es 1: pago de contado.

   ⚠ EL DINERO ESTÁ EN QUIÉN PAGA EL INTERÉS, y el número decide cuál de los
   dos casos toca:

     · 2 cuotas → las financia el BANCO del comprador. Él paga de más, tú
       cobras el total íntegro. No te cuesta nada.
     · 3 o más  → en México eso ya es el catálogo de MESES SIN INTERESES, y el
       interés lo absorbe el VENDEDOR: 4.69 % a tres meses, 27.29 % a
       veinticuatro (los porcentajes del panel de Mercado Pago). Poner un 3
       aquí es regalar el 4.69 % de cada venta de ese paquete.

   Por eso el Worker recorta cualquier valor a 2 aunque esta tabla diga más:
   una errata de un dígito no puede convertirse en una comisión permanente.
   Ver TOPE_CUOTAS en cloudflare/pagos/pagos.js. */

/* Desde qué importe se ofrecen dos mensualidades. Se decidió por importe y no
   por cantidad de placas porque lo que hace dudar a alguien es la cifra, no el
   número de piezas; y porque con veinticinco cantidades, «las dos más caras»
   dejaría fuera a casi todo el catálogo grande. Cuesta cero: a dos cuotas paga
   el interés el banco del comprador. */
/* ═══════════════════════ LOS SERVICIOS ═══════════════════════

   El perfil de Google, que a diferencia de la placa NO se envía: se entrega
   trabajando sobre la ficha del cliente. Por eso llevan `tipo: 'servicio'`, que
   es lo que hace que el Worker no les hable de envíos ni les descuente la
   entrega en mano, y que el resumen del cobro no diga «1 pza».

   ⚠ EL ANTICIPO SÓLO EXISTE CUANDO LA CUENTA LA CREAMOS NOSOTROS, y no es una
   regla comercial caprichosa: es la única que se sostiene. En un perfil de
   Google no se puede retener la entrega —cada foto que se sube es pública y del
   cliente en el mismo segundo—, así que si la cuenta es suya y nos quita de
   administradores, el trabajo hecho no se puede deshacer y el resto no se
   cobra. Cuando la cuenta la creamos nosotros, la entrega final es el correo y
   la contraseña, y eso sí espera al pago. Con cuenta del cliente: de contado.

   Los `resto` no los cobra esta web: no hay base de datos que sepa quién debe
   qué, así que el segundo pago es un enlace de Mercado Pago por WhatsApp. El
   número vive aquí para que la web pueda DECIRLO sin que nadie lo escriba a
   mano en dos sitios. */
const SERVICIOS = [
  {
    id: 'gp-e',
    /* DOS NOMBRES A PROPÓSITO. El largo es el que viaja al cobro y el que
       aparece en el estado de cuenta del comprador, donde «Lo esencial» a secas
       no dice de qué. El corto es el de la página, donde la cabecera ya dice
       que esto es el perfil de Google y repetirlo en las cuatro opciones sólo
       parte los renglones. */
    nombre: 'Perfil de Google · Lo esencial',
    corto: 'Lo esencial',
    precio: 1490,
    anticipo: 750,
    resumen: 'Con las fotos que tú nos mandes',
  },
  {
    id: 'gp-t',
    nombre: 'Perfil de Google · Todo hecho',
    corto: 'Todo hecho',
    precio: 2300,
    anticipo: 1150,
    resumen: 'Vamos a tu negocio y tomamos las fotos',
    /* LA VISITA NO ES NACIONAL Y LA PÁGINA DE COBRO NO PUEDE CALLARLO. Los
       términos la limitan a San Luis Potosí y Soledad desde el primer día; el
       titular de esta cifra vive aquí y va en coche. Sin esta línea, alguien de
       Monterrey pagaba $2,300 leyendo «vamos a tu negocio» y descubría la letra
       pequeña en la página de términos, que es donde nadie mira antes de pagar.
       Va en el mismo bloque que la promesa, no en un enlace. */
    nota: 'La visita es en San Luis Potosí y Soledad. Desde otra ciudad se hace todo '
        + 'lo demás igual y las fotos las mandas tú.',
    /* Y la misma condición, en un dato que pueda leer el Worker. La página ya
       se lo avisa al comprador; el otro extremo —quien prepara el trabajo— no
       se enteraba por ningún lado y tenía que caer en la cuenta leyendo la
       ciudad en mitad de una línea. */
    visita: true,
    destaca: true,
  },
];

/* El plazo de entrega (1 a 7 días hábiles desde que nos dan acceso) y las 24
   horas de cancelación estuvieron aquí como constantes. No generaban nada: los
   dos números están escritos a mano en terminos.html, en servicio.html y en
   gracias.html, y una constante que nadie lee no es una fuente de verdad, es
   una que parece serlo — que es peor, porque invita a cambiarla y creer que ya
   está hecho. Viven en el texto legal, que es donde obligan.

   Las mismas guardas que la escalera de placas, por el mismo motivo: un dedo
   torpe aquí es dinero real y nadie lo ve desde dentro. */
{
  const vistos = new Set();
  for (const s of SERVICIOS) {
    /* ⚠ SE VALIDA EL ID QUE DE VERDAD SE PUBLICA, no el que está escrito arriba.
       El del anticipo es `s.id + 'a'` y se construye en dos sitios —el bloque
       de la página y la tabla del Worker— sin pasar por aquí. Con un id de 8
       caracteres, que la guarda aceptaba, el anticipo salía de 9: el navegador
       manda los nueve, el Worker recorta a ocho (`.slice(0, 8)`) y acaba
       cobrando el paquete DE CONTADO — o, si el recorte no casa con nada,
       responde «Ese paquete no existe» y la venta se cae. */
    for (const id of s.anticipo ? [s.id, s.id + 'a'] : [s.id]) {
      if (!/^[a-z0-9-]{1,8}$/.test(id))
        throw new Error(`servicio «${s.nombre}»: el id «${id}» no cabe en los 8 caracteres que lee el Worker`);
      if (vistos.has(id)) throw new Error(`servicio: el id «${id}» está repetido`);
      vistos.add(id);
    }
    if (!Number.isInteger(s.precio) || s.precio <= 0)
      throw new Error(`servicio «${s.nombre}»: el precio no es un entero positivo`);
    /* Un anticipo mayor o igual que el precio no es un anticipo, y uno de cero
       cobraría nada. Los dos han pasado por un cambio de tabla a las 2 a.m. */
    if (s.anticipo !== undefined &&
        (!Number.isInteger(s.anticipo) || s.anticipo <= 0 || s.anticipo >= s.precio))
      throw new Error(`servicio «${s.nombre}»: el anticipo ${s.anticipo} no está entre 1 y ${s.precio - 1}`);
  }
}

const CUOTAS_DESDE = 2500;

/* ⚠ EL ENVÍO ESTÁ EN CERO EN TODAS LAS FILAS, Y ES UNA DECISIÓN, NO UN OLVIDO.
   Se cobraba aparte —79, 69 y 59 pesos en los tres primeros paquetes— y el
   resultado era que una placa suelta salía en $508 mientras la competencia
   anunciaba $399 con el envío dentro. La comparación se perdía justo en el
   número más mirado del catálogo. Ahora el envío va dentro del precio: la cifra
   que se ve es la que se paga, en México entero.

   La columna `envio` se queda —no se borra— porque es el mecanismo. El día que
   haya que volver a cobrarlo basta con poner números aquí: el Worker, el
   contador, el aviso de «lleva 4 y no pagas envío» y el descuento por entrega
   en mano siguen escritos para ello y se encienden solos.

   Los paquetes, en el orden en que se enseñan. `precio` es el TOTAL del
   paquete en pesos, no el precio por unidad.

   ⚠ ONCE DE ESTOS PRECIOS SON DECISIONES Y CATORCE SON CONSECUENCIAS.
   Los decididos a mano son 1, 2, 3, 4, 5, 6, 8, 10, 12, 15 y 20 —eran los once
   tramos que existían cuando el catálogo se elegía de una lista—. El resto se
   rellenó al pasar a un contador de uno en uno, interpolando dentro de cada
   tramo y redondeando a que acabaran en 9, que es como está escrito el resto de
   la lista. De 21 a 25 se sigue con el margen del tramo largo: 150 por placa.

   Se escriben los veinticinco a la vista, y no una fórmula, a propósito: así
   cualquiera puede cambiar UNO sin entender un algoritmo, y el archivo enseña
   literalmente lo que se va a cobrar. La interpolación fue un acto de autoría,
   no una regla de ejecución.

   Al tocar cualquiera de estos números hay una propiedad que no se puede
   romper: EL PRECIO POR PIEZA TIENE QUE BAJAR SIEMPRE al subir la cantidad.
   Si en algún escalón sube, comprar más sale peor por unidad y la lista
   pierde el sentido. `node tools/precios.mjs --tabla` la imprime entera. */
const PAQUETES = [
  { piezas:  1, precio:  399, envio:  0 },
  { piezas:  2, precio:  649, envio:  0 },
  { piezas:  3, precio:  799, envio:  0 },
  { piezas:  4, precio:  949, envio:  0, destaca: true },
  { piezas:  5, precio: 1099, envio:  0 },
  { piezas:  6, precio: 1249, envio:  0 },
  { piezas:  7, precio: 1429, envio:  0 },
  { piezas:  8, precio: 1599, envio:  0 },
  { piezas:  9, precio: 1749, envio:  0 },
  { piezas: 10, precio: 1899, envio:  0 },
  { piezas: 11, precio: 2049, envio:  0 },
  { piezas: 12, precio: 2199, envio:  0 },
  { piezas: 13, precio: 2349, envio:  0 },
  { piezas: 14, precio: 2499, envio:  0 },
  { piezas: 15, precio: 2649, envio:  0 },
  { piezas: 16, precio: 2799, envio:  0 },
  { piezas: 17, precio: 2949, envio:  0 },
  { piezas: 18, precio: 3099, envio:  0 },
  { piezas: 19, precio: 3249, envio:  0 },
  { piezas: 20, precio: 3399, envio:  0 },
  { piezas: 21, precio: 3549, envio:  0 },
  { piezas: 22, precio: 3699, envio:  0 },
  { piezas: 23, precio: 3849, envio:  0 },
  { piezas: 24, precio: 3999, envio:  0 },
  { piezas: 25, precio: 4149, envio:  0 },
];

/* Las cuotas se derivan del importe en vez de escribirse fila a fila: así
   cambiar CUOTAS_DESDE mueve el corte de golpe y no quedan filas olvidadas. */
for (const p of PAQUETES) if (p.precio + p.envio >= CUOTAS_DESDE) p.cuotas = 2;

/* La comprobación que protege la escalera entera. Corre SIEMPRE, también en
   --check, porque un precio que rompa la monotonía no da ningún síntoma: la web
   se pinta igual, el cobro funciona igual, y lo único que pasa es que a partir
   de cierta cantidad comprar más sale peor por pieza. Eso lo descubre el
   cliente, comparando, y ya no hay quien lo explique. */
(() => {
  for (let i = 1; i < PAQUETES.length; i++) {
    const a = PAQUETES[i - 1], b = PAQUETES[i];
    if (b.piezas !== a.piezas + 1) {
      throw new Error(`la escalera se salta la cantidad ${a.piezas + 1}: el contador va de uno en uno`);
    }
    if (b.precio <= a.precio) {
      throw new Error(`${b.piezas} placas no cuestan más que ${a.piezas}: ${b.precio} vs ${a.precio}`);
    }
    if (b.precio / b.piezas >= a.precio / a.piezas) {
      throw new Error(
        `el precio por pieza NO baja de ${a.piezas} a ${b.piezas} placas ` +
        `(${(a.precio / a.piezas).toFixed(2)} → ${(b.precio / b.piezas).toFixed(2)}). ` +
        `Comprar más saldría peor por unidad.`);
    }
    if (b.envio > a.envio) {
      throw new Error(`el envío SUBE de ${a.piezas} a ${b.piezas} placas: ${a.envio} → ${b.envio}`);
    }
    /* Un envío NEGATIVO haría que la entrega en mano sumara en vez de restar:
       el comprador local pagaría MÁS de lo que la web le enseñó. Cobrar por
       encima del precio exhibido no es un descuadre contable, es un problema
       con PROFECO. Basta un guion de más al editar la fila. */
    if (!Number.isInteger(b.envio) || b.envio < 0 || b.envio >= b.precio) {
      throw new Error(`el envío de ${b.piezas} placas (${b.envio}) tiene que ser un entero entre 0 y ${b.precio - 1}`);
    }
  }
})();

/* ---------- ENTREGA EN MANO, SIN COSTE DE ENVÍO ----------
   El negocio está en San Luis Potosí capital y entrega en mano dentro de su
   ciudad, así que a quien vive ahí no tiene sentido cobrarle paquetería. Pero
   «San Luis Potosí» es también un ESTADO enorme: Ciudad Valles está a más de
   250 km y Río Verde a 130. Regalar el envío a todo el estado sería regalar
   una paquetería de verdad.

   Por eso el corte no es el estado ni la ciudad que alguien escriba, sino el
   CÓDIGO POSTAL: un dato que ya hace falta para el envío y que no se puede
   «elegir» sin cambiar también a dónde llega el paquete.

   ⚠ SÓLO AFECTA A 1, 2 Y 3 PLACAS. De cuatro en adelante el envío ya es gratis
   para todo México, así que aquí no hay nada que descontar.

   ⚠ ESTOS RANGOS VIAJAN A DOS SITIOS y por eso se escriben una sola vez: al
   Worker —que es quien decide el importe de verdad— y al JavaScript de la
   página —que es quien lo enseña—. Escritos por separado, el día que uno
   cambie la web diría «envío gratis» y el cobro saldría con envío. */
const ENTREGA_LOCAL = [
  /* Los rangos salen del catálogo oficial de SEPOMEX del estado 24, no de una
     web de terceros. En ese catálogo NINGÚN código postal del estado está
     compartido por dos municipios, así que la prueba por número es determinista.

     ⚠ EL 78394 PARTE LA CAPITAL EN DOS, y por eso hay dos rangos donde parecería
     que basta uno. Ese código es de Villa de Pozos, que dejó de ser parte de la
     capital el 1 de octubre de 2024 al convertirse en el municipio 59 del
     estado. Escribir «78000–78399» de un tirón —que es lo natural— le regala el
     envío a Villa de Pozos entera sin querer. */
  { desde: 78000, hasta: 78393, zona: 'San Luis Potosí capital' },
  { desde: 78395, hasta: 78399, zona: 'San Luis Potosí capital' },

  /* Soledad es municipio aparte pero la misma mancha urbana: el reparto llega
     igual. El 78431 no existe, así que el rango cerrado es seguro. */
  { desde: 78430, hasta: 78439, zona: 'Soledad de Graciano Sánchez' },

  /* ⚠ ESTOS DOS SON UNA DECISIÓN DEL NEGOCIO, NO UN DATO. Son la parte URBANA
     de Villa de Pozos: el sureste de la ciudad, mancha continua, donde el
     repartidor llega igual de fácil que a la Zona Industrial. Eran capital
     hasta hace nada. Quitarlos es legítimo; se quitan borrando estas dos
     líneas y ejecutando `node tools/precios.mjs`. */
  { desde: 78394, hasta: 78394, zona: 'Villa de Pozos (urbano)' },
  { desde: 78421, hasta: 78421, zona: 'Villa de Pozos (urbano)' },

  /* LO QUE NO ESTÁ AQUÍ, Y NO ES UN OLVIDO:
     · 78400–78418 y 78425–78427 son el municipio de la capital pero ZONA RURAL
       —Bocas está a unos 60 km, La Pila a 10-18, Escalerillas a 15 en la
       sierra—. El sobre dirá «municipio de San Luis Potosí» y aun así hay que
       mandarlo por paquetería.
     · 78420, 78423 y 78424 son el cinturón rural de Villa de Pozos.
     · 78440–78448 Cerro de San Pedro, 78460–78486 Mexquitic: municipios
       vecinos, no conurbados.
     · Río Verde (79600–79647), Ciudad Valles (79000–79098 y 79230–79287),
       Matehuala (78700–78827) y Tamazunchale (79960–79998) están a cientos de
       kilómetros. Son el motivo por el que esto se decide por código postal y
       no por el nombre del estado que alguien teclee. */
];

/* Guarda de los rangos. Es la ÚNICA pérdida de este diseño que no está acotada
   en 79 pesos: el abuso máximo de un comprador listo son 79 pesos de una compra
   real, pero un rango mal escrito regala paquetería nacional en silencio y
   nada más lo notaría.

   El caso concreto que esto atrapa: alguien quiere decir «la capital y Soledad»
   y escribe {desde: 78000, hasta: 79999}. Acaba de incluir Ciudad Valles y Río
   Verde, que es exactamente lo que la lista existe para excluir. O un cero de
   más, {desde: 0, hasta: 99999}, y es todo México. En los tres casos el HTML se
   regenera tan contento y las pruebas pasan. */
(() => {
  const BANDA = [78000, 79999];   /* toda la banda de códigos del estado */
  const MAX_ANCHO = 2000;         /* la capital entera son ~400 números */
  let cubiertos = 0;
  for (const r of ENTREGA_LOCAL) {
    const d = Number(r.desde), h = Number(r.hasta);
    if (!Number.isInteger(d) || !Number.isInteger(h)) {
      throw new Error(`rango de entrega local con valores que no son números: ${JSON.stringify(r)}`);
    }
    if (d > h) throw new Error(`rango al revés: desde ${d} es mayor que hasta ${h}`);
    if (d < BANDA[0] || h > BANDA[1]) {
      throw new Error(
        `el rango ${d}–${h} se sale de los códigos de San Luis Potosí (${BANDA[0]}–${BANDA[1]}). ` +
        `Fuera de esa banda no hay nada que entregar en mano.`);
    }
    if (h - d + 1 > MAX_ANCHO) {
      throw new Error(
        `el rango ${d}–${h} cubre ${h - d + 1} códigos postales. La ciudad entera son unos 400: ` +
        `un rango así regala la paquetería de medio estado.`);
    }
    cubiertos += h - d + 1;
  }
  if (cubiertos > MAX_ANCHO) {
    throw new Error(`la entrega en mano cubre ${cubiertos} códigos postales en total, que son demasiados`);
  }
})();

/* Cómo se llama la zona en el texto que ve el comprador. */
const ENTREGA_LOCAL_NOMBRE = 'San Luis Potosí y Soledad';


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
/* Desde cuántas piezas sale gratis el envío, o `null` si sale gratis DESDE LA
   PRIMERA —que es el caso desde que el envío va dentro del precio—. Devolver
   null y no 1 es lo que evita que algún texto acabe diciendo «gratis desde 1
   piezas», que es la clase de frase que sólo se escribe sola. */
function desdeGratis() {
  const primera = PAQUETES.find(gratis);
  if (!primera) throw new Error('ningún paquete tiene el envío gratis; revisa la tabla');
  return primera.piezas === PAQUETES[0].piezas ? null : primera.piezas;
}

/* El mensaje que llega a WhatsApp ya escrito. Los paquetes con envío gratis se
   piden como «el paquete de N placas» y los de menos, como «N placas»: a
   partir de diez lo que se compra es el paquete, y por debajo son piezas
   sueltas. Es el texto que ya estaba; se conserva. */
function tablaContador() {
  const filas = PAQUETES.map(p => ({
    n: p.piezas,
    t: placas(p),
    tot: total(p),
    e: p.envio,
    u: Number((p.precio / p.piezas).toFixed(2)),
    d: detalle(p),
    /* Versión corta para la cabecera de pedido.html, donde el desglose no cabe.
       Es el mismo texto que lleva el título del cobro en Mercado Pago, así que
       lo que el comprador lee en la web y lo que ve en el checkout coinciden
       palabra por palabra. */
    s: gratis(p) ? 'envío gratis' : 'envío incluido',
    g: avisoGratis(p),
  }));
  /* `local` viaja para que pedido.html pueda AVISAR de que no se cobrará el
     envío en cuanto se teclee un código postal de casa. Es sólo el aviso: el
     descuento lo aplica el Worker, con esta misma lista generada aquí. */
  const datos = { local: { nombre: ENTREGA_LOCAL_NOMBRE, rangos: ENTREGA_LOCAL }, filas };
  return '<script type="application/json" id="pc-tabla">' + JSON.stringify(datos) + '<\/script>';
}

/* La línea chica bajo la cifra.

   ⚠ LA CIFRA GRANDE ES EL TOTAL CON ENVÍO, porque es EXACTAMENTE lo que va a
   cobrar el botón de al lado. Mientras el botón abría WhatsApp tenía sentido
   enseñar $429 y el envío aparte —eran dos conceptos y una conversación por
   delante para aclararlos—; con un cobro real detrás, enseñar una cifra y
   cobrar otra es la sorpresa clásica del carrito, y la que hace abandonar.

   Por eso esta línea DESGLOSA en vez de sumar: dice de dónde sale el total, y
   a cómo queda la pieza cuando se llevan varias, que es lo que hace subir el
   contador. Con una sola placa el precio por pieza es el propio precio, así que
   repetirlo sobraría. */
/* El precio por pieza, con céntimos y sin ceros de adorno: $237.25, $167.35,
   $207. Redondeado a peso entero, 23 placas (3849/23 = 167.35) y 24 placas
   (3999/24 = 166.63) enseñaban las DOS «$167»: subir la cantidad cobraba 150
   pesos más y dejaba el precio por pieza clavado, que se lee como un error.
   Y todo el tramo de 20 a 25 recorre sólo cuatro pesos de precio unitario, así
   que con enteros SIEMPRE choca alguna pareja, se redondee como se redondee.

   De paso arregla otra cosa: redondeando a la baja, quien multiplicaba el
   precio por pieza por la cantidad le salía MENOS de lo que iba a pagar. */
function porPieza(p) {
  const u = p.precio / p.piezas;
  const texto = u.toFixed(2).replace(/\.00$/, '');
  return '$' + Number(texto).toLocaleString('en-US', { minimumFractionDigits: texto.includes('.') ? 2 : 0 });
}

function detalle(p) {
  const unitario = p.piezas === 1 ? '' : ` · ${porPieza(p)} por pieza`;
  return gratis(p)
    ? `Envío gratis${unitario}`
    : `$${miles(p.precio)} + $${p.envio} de envío${unitario}`;
}

/* La lista entera de tramos, SIEMPRE en el HTML. No es un <noscript>, y la
   diferencia importa: el contenido de un <noscript> desaparece del documento en
   cuanto hay JavaScript, también AL IMPRIMIR. La versión anterior de esta ficha
   se imprimía con toda la tabla de mayoreo a propósito —en papel, un precio por
   volumen no puede quedarse detrás de un control que no responde—, y meterla en
   un <noscript> habría tirado eso por la borda sin que nadie lo notara hasta
   ver una hoja impresa.

   Así que la lista está siempre: el script la oculta EN PANTALLA marcando el
   documento con la clase `js`, y la hoja de impresión la devuelve. Sin
   JavaScript nunca se oculta, que es el otro caso que había que cubrir. */
/* --------------------------------------------------- LA PÁGINA DE PEDIDO ----
   pedido.html elige la cantidad con un <select> y necesita los mismos once
   importes. Se generan desde aquí por el mismo motivo que todo lo demás: dos
   listas de precios mantenidas por separado divergen, y el día que diverjan la
   ficha diría un precio, el pedido otro y el cobro un tercero. */
const PEDIDO = path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'app', 'pedido.html');
const SERVICIO = path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'app', 'servicio.html');

/* Las cuatro opciones de compra de servicio.html. Se generan por el mismo
   motivo que todo lo demás: el precio que se lee en pantalla y el que cobra el
   Worker salen de la misma tabla, o antes o después divergen.

   El `value` de cada radio es el id que el Worker busca en su catálogo. Que
   coincidan no es convención ni suerte: los dos los escribe este archivo. */
function bloqueServicio() {
  const pesos = n => '$' + miles(n);
  const bloque = s => {
    const corto = s.corto || s.nombre;
    const resto = s.anticipo ? s.precio - s.anticipo : 0;

    /* EL AVISO DE CÓMO SE PAGA VA ANTES DE ELEGIR, no después. Quien llega a
       una pantalla de cobro y ve una sola cifra grande decide ahí mismo si
       sigue; enterarse de que había otra forma de pagar DESPUÉS de haber
       decidido que no puede es un cliente perdido por no haberlo dicho a
       tiempo.

       Y hay dos textos porque hay dos verdades. Con ficha propia el anticipo no
       existe —no hay entrega que retener— y el script cambia la frase entera en
       vez de dejar una que se contradice con las opciones de debajo. */
    const comoNo = s.anticipo
      ? `P&#225;galo <b>de contado</b>, o deja <b>${pesos(s.anticipo)} de anticipo</b> `
        + `y los ${pesos(resto)} restantes cuando te entreguemos el acceso.`
      : 'Un solo pago.';
    const comoSi = 'Como tu ficha <b>ya existe</b>, este paquete va <b>de contado</b>: '
      + 'el trabajo se hace sobre una cuenta que ya controlas y no hay entrega que reservar.';

    /* DOS ATRIBUTOS PARA EL MISMO IMPORTE, y no es duplicar por gusto.
       `data-tot` es lo que se PINTA en la cifra grande, ya con su coma y su
       peso. `data-num` es el ENTERO, que es lo que se guarda para la página de
       gracias — que lo vuelve a formatear ella. Cuando esto guardaba el texto,
       `Number('$1,490')` daba NaN y el comprador leía «$NaN» en el resumen de
       lo que acababa de pagar. `data-resto` es lo que faltará por cobrar, para
       que esa misma página pueda decirlo en vez de dejarlo a la imaginación. */
    const opcion = (id, importe, titulo, pie, anticipo) =>
      '        <label class="ped-op">\n' +
      `          <input type="radio" name="paquete" value="${id}" required\n` +
      `                 data-tot="${pesos(importe)}" data-num="${importe}"` +
      (anticipo ? ` data-resto="${s.precio - s.anticipo}"` : '') + '\n' +
      `                 data-que="${ent(corto + ' · ' + (anticipo ? 'anticipo' : 'de contado'))}"` +
      (anticipo ? ' data-anticipo="1"' : '') + '>\n' +
      `          <b>${ent(titulo)}</b>\n` +
      `          <small>${pie}</small>\n` +
      '        </label>';

    const ops = [opcion(s.id, s.precio, `Pagar ${pesos(s.precio)} de contado`,
                        'Un solo pago y listo.', false)];
    if (s.anticipo) ops.push(opcion(s.id + 'a', s.anticipo,
      `Pagar ${pesos(s.anticipo)} de anticipo`,
      `Y ${pesos(resto)} cuando te entreguemos el acceso. ` + ent('Sólo si creamos la cuenta nosotros.'),
      true));

    return '      <div class="sv-plan" role="group" ' +
      `aria-label="${ent(corto + ', ' + pesos(s.precio))}">\n` +
      `        <p class="sv-nom">${ent(corto)}<span>${pesos(s.precio)}</span></p>\n` +
      `        <p class="sv-que">${ent(s.resumen)}.</p>\n` +
      (s.nota ? `        <p class="sv-nota">${ent(s.nota)}</p>\n` : '') +
      /* DOS PÁRRAFOS HERMANOS Y NO UNO CON DOS ATRIBUTOS. Con un solo <p> que
         el script reescribe, sin JavaScript sólo existe una de las dos verdades
         y la otra no hay quien la enseñe. Siendo hermanos los turna el CSS con
         `:has()` sobre el radio marcado, que funciona sin script.
         Son dos y no tres porque la pregunta de arriba nace respondida: no hay
         estado «sin contestar» que cubrir, y un párrafo que no puede verse
         nunca es peor que no tenerlo — parece que sostiene algo. */
      `        <p class="sv-como sv-como-no">${comoNo}</p>\n` +
      `        <p class="sv-como sv-como-si">${comoSi}</p>\n` +
      ops.join('\n') + '\n      </div>';
  };
  return '<!-- servicio:opciones -->\n' + SERVICIOS.map(bloque).join('\n') +
         '\n      <!-- /servicio:opciones -->';
}

const BLOQUES_SERVICIO = [
  { nombre: 'opciones del servicio',
    re: /<!-- servicio:opciones -->[\s\S]*?<!-- \/servicio:opciones -->/,
    pinta: bloqueServicio },
];

function bloquePedido() {
  const ops = PAQUETES.map(p =>
    `<option value="${p.piezas}">${placas(p)} &#8212; $${miles(total(p))}</option>`).join('');
  return '<!-- pedido:cantidad -->\n' +
    '      <label class="ped-campo" for="ped-cant"><span>Cantidad</span>' +
    '<select id="ped-cant" name="paquete">' + ops + '</select></label>\n' +
    '      ' + tablaContador() + '\n' +
    '      <!-- /pedido:cantidad -->';
}

/* El aviso que empuja al tramo del envío gratis. Sólo tiene sentido mientras
   NO se llega: a partir de ahí la línea del precio ya dice «Envío gratis» y
   repetirlo sería ruido.

   Dice lo que se ahorra HOY, no una regla abstracta: «te ahorras $79» mueve
   más que «desde 4 piezas el envío es gratis», y las dos cosas son la misma
   frase. El umbral y el importe salen de la tabla, así que si mañana el envío
   gratis empieza en seis, el texto lo dice solo. */
function avisoGratis(p) {
  const desde = desdeGratis();
  /* Sin umbral no hay nada que empujar: el envío ya es gratis desde una placa.
     La línea se queda vacía y el contador la esconde sola. */
  if (desde === null || gratis(p)) return '';
  return `Lleva ${desde} y no pagas env\u00edo: te ahorras $${p.envio}.`;
}

/* El precio del producto en los datos estructurados de la cabecera. Es la cifra
   que Google puede enseñar en su resultado de búsqueda, así que si se queda
   vieja el buscador anuncia un precio que la web ya no cobra — y ese es un
   desfase que no ve nadie desde dentro, porque en la página se lee bien.

   Estaba escrito a mano y se quedó en 429 al bajar la entrada a 399. Se genera
   para que no pueda volver a pasar. */
function precioEsquema() {
  return '"price":"' + total(PAQUETES[0]) + '"';
}

/* LA FICHA CORTA DE LA PORTADA.
   Antes esto generaba el contador entero: campo de cantidad, precio en vivo,
   la lista de las 25 cantidades y su tabla JSON. Todo eso vive ahora en
   pedido.html, que ya elegía cantidad con un <select> de 25 opciones y ya
   llevaba el WhatsApp de «más de 25». Duplicarlo en la portada costaba tres
   pantallas de móvil para responder una pregunta —cuánto cuestan las que yo
   quiero— que se responde igual de bien un toque después, y con el flujo de
   compra entero delante.

   Lo que queda en la portada es lo que decide si sigues: desde cuánto y a
   dónde se va. Sigue generándose desde la tabla y no a mano, porque el fallo
   que este archivo existe para impedir —la web diciendo un precio y el cobro
   siendo otro— no depende de cuántas cifras se enseñen, sino de que la que se
   enseñe salga de aquí. */
function bloqueCompra() {
  const una = PAQUETES[0];
  if (!una || una.piezas !== 1) throw new Error('la escalera no empieza en 1 placa');

  /* «Envío incluido» y no «envío gratis»: en la portada no hay ninguna otra
     cifra al lado con la que contrastar, y «gratis» junto a un precio invita a
     buscar el coste escondido que no existe. */
  const envio = gratis(una) ? ent(' · envío incluido') : '';

  return '<div class="prod-compra">\n' +
    '            <p class="pc-desde"><span class="pc-et">' + ent('Desde') + '</span>' +
    '<span class="cifra" data-pc-total>$' + miles(total(una)) + '</span>' +
    '<span class="u">MXN' + envio + '</span></p>\n' +
    '            <a class="svc-btn pc-ir" href="pedido.html?n=1" data-pc-ir>' +
    '<span class="dia"></span>' + ent('Ver precios y comprar') + '</a>\n' +
    '          </div>'
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
    /* Los códigos postales donde se entrega en mano. El Worker los usa para
       descontar el envío ÉL MISMO: el navegador nunca manda una bandera de
       «soy local», sólo el código postal, que ya tiene que mandar para que
       llegue el paquete. */
    entregaLocal: { nombre: ENTREGA_LOCAL_NOMBRE, rangos: ENTREGA_LOCAL },
    paquetes: PAQUETES.map(p => ({
      id: String(p.piezas),
      piezas: p.piezas,
      /* El concepto SIN la parte del envío. Antes aquí venía el título entero y
         el Worker le hacía un `replace` buscando «· envío incluido» para
         cambiarlo cuando la entrega era en mano. Eso se rompía en silencio si
         alguien retocaba esta línea: el replace no encontraba nada, devolvía el
         título original, y el comprador de la ciudad veía «envío incluido»
         junto a un importe 79 pesos menor.

         Ahora viaja sólo la base y el Worker compone el final según lo que de
         verdad pase con el envío. No hay ninguna cadena que buscar. */
      base: `Placa reseñas Google · ${piezas(p)}`,
      /* `total` es CON envío; `envio` es lo que de ese total es paquetería. El
         Worker resta lo segundo cuando el código postal es de los de casa. Van
         los dos y no uno calculado: el importe que se cobra no puede depender
         de una resta hecha en dos sitios distintos. */
      total: total(p),
      envio: p.envio,
      cuotas: p.cuotas || 1,
    })).concat(SERVICIOS.flatMap(s => {
      /* Dos filas por servicio: el de contado y el del anticipo. Son dos
         paquetes distintos para el Worker porque son dos importes distintos, y
         el importe NUNCA puede salir de lo que mande el navegador. */
      const fila = (id, base, total, resto) => ({
        id, tipo: 'servicio', piezas: 1, base, total, envio: 0, cuotas: 1,
        ...(resto ? { resto } : {}),
        ...(s.visita ? { visita: true } : {}),
      });
      const filas = [fila(s.id, s.nombre, s.precio)];
      /* `resto` es lo que queda por cobrar después del anticipo. Va EN LA TABLA
         y no sólo en el navegador: hasta ahora ese número existía únicamente en
         el sessionStorage del comprador, así que el aviso de la venta que le
         llega al titular no lo traía por ningún lado — y cualquiera podía
         cambiarlo desde las herramientas del navegador y el vendedor vería lo
         que el comprador quisiera. Con esto el importe autoritativo llega por
         el mismo canal que el cobro. */
      if (s.anticipo) filas.push(
        fila(s.id + 'a', s.nombre + ' · anticipo', s.anticipo, s.precio - s.anticipo));
      return filas;
    })),
  }, null, 2) + '\n';
}

/* Cada bloque con el patrón que lo localiza en el HTML. El patrón se ancla en
   marcas que este archivo también escribe, así que si alguien renombra una
   clase, esto falla en voz alta en vez de generar un HTML a medias. */
/* El «Desde $X» de la ficha del perfil de Google en la portada. Sale de la
   misma tabla que el catálogo del Worker por el motivo de siempre: una cifra
   escrita a mano en la portada y otra en el cobro divergen el día que suba el
   precio, y nadie lo ve desde dentro porque las dos se leen bien por separado. */
function desdeServicio() {
  const barato = SERVICIOS.reduce((a, b) => (b.precio < a.precio ? b : a));
  return `<span data-svc-desde>Desde $${miles(barato.precio)}</span>`;
}

const BLOQUES = [
  { nombre: 'precio del esquema', re: /"price":"\d+"/, pinta: precioEsquema },
  { nombre: 'desde del servicio', re: /<span data-svc-desde>[^<]*<\/span>/, pinta: desdeServicio },
  { nombre: 'bloque de compra',
    re: /<div class="prod-compra">[\s\S]*?<\/a>\n {10}<\/div>/,
    pinta: bloqueCompra },
];

/* Los de pedido.html, en su propio archivo. */
const BLOQUES_PEDIDO = [
  { nombre: 'cantidad del pedido',
    re: /<!-- pedido:cantidad -->[\s\S]*?<!-- \/pedido:cantidad -->/,
    pinta: bloquePedido },
];

function aplica(html, bloques = BLOQUES) {
  let salida = html;
  for (const b of bloques) {
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
/* pedido.html manda el formulario al Worker. Si esa dirección y COBRO_EN_LINEA
   se separan, el botón de la ficha y el del pedido acabarían en sitios
   distintos —o en ninguno— sin que nada avisara. Se comprueba aquí porque este
   archivo es el que ya sabe cuál es la buena. */
const pedidoOriginal = fs.readFileSync(PEDIDO, 'utf8');
const pedidoGenerado = aplica(pedidoOriginal, BLOQUES_PEDIDO);
if (COBRO_EN_LINEA && !pedidoOriginal.includes(`action="${COBRO_EN_LINEA}"`)) {
  console.error(`\n  pedido.html no manda el formulario a ${COBRO_EN_LINEA}.`);
  console.error('  Con la dirección mal, el botón de pagar no lleva a ninguna parte.\n');
  process.exit(1);
}

/* servicio.html: las mismas cuatro opciones que el Worker tiene en su catálogo.
   Si se separan, la página enseña un precio y el cobro sale por otro — que es
   exactamente el fallo que este archivo entero existe para impedir. */
const servicioOriginal = fs.readFileSync(SERVICIO, 'utf8');
const servicioGenerado = aplica(servicioOriginal, BLOQUES_SERVICIO);
if (COBRO_EN_LINEA && !servicioOriginal.includes(`action="${COBRO_EN_LINEA}"`)) {
  console.error(`\n  servicio.html no manda el formulario a ${COBRO_EN_LINEA}.`);
  console.error('  Con la dirección mal, el botón de pagar no lleva a ninguna parte.\n');
  process.exit(1);
}

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
  if (pedidoOriginal !== pedidoGenerado) {
    console.error('\n  Las cantidades de app/pedido.html no coinciden con la tabla.');
    console.error('  El pedido enseñaría un precio y el cobro sería otro.');
    console.error('  Arréglalo con:  node tools/precios.mjs\n');
    process.exit(1);
  }
  if (servicioOriginal !== servicioGenerado) {
    console.error('\n  Los paquetes de app/servicio.html no coinciden con la tabla.');
    console.error('  La página enseñaría un precio y el cobro sería otro.');
    console.error('  Arréglalo con:  node tools/precios.mjs\n');
    process.exit(1);
  }
  if (original === generado) {
    console.log('OK: la lista de precios del HTML y de pedido.html coincide con tools/precios.mjs.');
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

if (pedidoOriginal !== pedidoGenerado) {
  fs.writeFileSync(PEDIDO, pedidoGenerado);
  console.log('Reescritas las cantidades de app/pedido.html.');
}

if (servicioOriginal !== servicioGenerado) {
  fs.writeFileSync(SERVICIO, servicioGenerado);
  console.log('Reescritos los paquetes de app/servicio.html.');
}

if (original === generado) {
  console.log('Sin cambios: el HTML ya coincide con la tabla.');
} else {
  fs.writeFileSync(HTML, generado);
  console.log('Reescrito app/index.html desde la tabla de precios.');
  console.log('Recuerda:  node tools/csp-hashes.mjs --check');
}
