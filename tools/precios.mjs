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
/* ═══ LAS FAMILIAS ═══
   Cada servicio pertenece a una, y la familia decide TRES cosas que antes
   estaban escritas a mano para el único caso que existía: en qué página se
   cobra, a qué página de gracias vuelve el comprador, y con qué palabras se
   promete el resto del anticipo («cuando te entreguemos el acceso» sólo tiene
   sentido en Google). `pregunta` marca a la única familia cuya forma de pago
   depende de una pregunta previa —la ficha—: en las demás el anticipo existe
   siempre, porque son proyectos de días y la entrega sí se puede retener. */
const FAMILIAS = {
  google: { pagina: 'servicio.html',       gracias: 'gracias-servicio.html', pregunta: true,
            entrega: 'el acceso', terminos: 'perfil-google',
            titulo: 'Perfil de Google para tu negocio',
            plazo: 'El primer día analizamos tu mercado y tu ficha; a partir de ahí, la '
              + 'entrega es de *1 a 7 días hábiles* —normalmente 2 o 3— desde que nos das '
              + 'acceso al perfil y el material, no desde el pago.',
            preguntas: [
              ['¿Qué es el perfil de Google?',
               'La ficha de tu negocio que sale en Google y en Google Maps: horarios, teléfono, '
               + 'fotos, reseñas y cómo llegar. Es lo primero que ve quien te busca, antes que tu '
               + 'página web.'],
              ['¿Cuánto cuesta?',
               '«Lo esencial» cuesta {precio@gp-e} MXN y «Todo hecho» {precio@gp-t} MXN. Los dos '
               + 'son precio cerrado y se pueden pagar de contado o con la mitad de anticipo y el '
               + 'resto al entregarte el acceso.'],
              ['¿Cuál es la diferencia entre los dos paquetes?',
               '«Lo esencial» deja la ficha completa y funcionando: tus datos, las fotos que nos '
               + 'mandas y tu enlace de reseñas. «Todo hecho» además la deja llena: vamos a tomar '
               + 'las fotos, cargamos hasta 20 productos o servicios, contestamos las reseñas que ya '
               + 'tienes, dejamos puestas preguntas y publicaciones, y te entregamos un reporte.'],
              ['¿Van a mi negocio?',
               'Con «Todo hecho», sí: en San Luis Potosí y Soledad de Graciano Sánchez vamos a '
               + 'tomar hasta 20 fotos sin costo extra. Desde otra ciudad hacemos todo lo demás '
               + 'igual y las fotos nos las mandas tú.'],
              ['¿La cuenta queda a mi nombre?',
               'Sí. Trabajamos sobre tu cuenta o la creamos a tu nombre, y al terminar te '
               + 'entregamos el acceso. Es tuya.'],
              ['¿Puedo añadir las placas de reseñas?',
               'Sí: hasta {placas} placas por {placa} MXN cada una, con envío o instalación '
               + 'incluidos. Se eligen al contratar, en esta misma página.'],
            ] },
  web:    { pagina: 'web.html',            gracias: 'gracias-paquete.html',
            entrega: 'tu sitio terminado', terminos: 'sitio-web',
            titulo: 'Página web para tu negocio',
            plazo: 'Listo en *15 días hábiles* desde que nos mandes tu material completo '
              + '—logo, fotos e información—, no desde el pago.',
            preguntas: [
              ['¿Cuánto cuesta una página web?',
               '{precio} MXN, precio cerrado. Incluye hasta 5 páginas, el diseño a medida, tu '
               + 'dominio .com y el hospedaje del primer año. Puedes dejar {anticipo} MXN de '
               + 'anticipo y pagar los {resto} MXN cuando te la entreguemos.'],
              ['¿En cuánto tiempo está lista?',
               'En {plazo} días hábiles desde que nos mandes tu material completo: logo, fotos '
               + 'y la información de tu negocio. El plazo corre desde el material, no desde el '
               + 'pago.'],
              ['¿Qué tengo que poner yo?',
               'El logo, las fotos y la información del negocio. Los textos los escribimos '
               + 'nosotros con lo que nos cuentes. Si no tienes logo o fotos, te decimos cómo '
               + 'conseguirlos.'],
              ['¿Qué no incluye?',
               'Tienda en línea con carrito y cobros, más de 5 páginas, reservas o cuentas de '
               + 'usuario: eso se cotiza aparte, por propuesta, antes de empezar. Después del '
               + 'primer año, el dominio y el hospedaje se renuevan por tu cuenta.'],
              ['¿Puedo cambiarla yo después?',
               'Sí. Al entregarla te explicamos cómo cambiar textos y fotos, y antes de '
               + 'publicarla hay dos rondas de cambios incluidas.'],
              ['¿La hacen si no estoy en San Luis Potosí?',
               'Sí. Todo el trabajo es a distancia, para cualquier parte de México.'],
            ] },
  ia:     { pagina: 'ia.html',             gracias: 'gracias-paquete.html',
            entrega: 'el agente funcionando', terminos: 'agente-ia',
            titulo: 'Agente de WhatsApp con IA para tu negocio',
            plazo: 'Funcionando en *10 días hábiles* desde que tengamos tu información y el '
              + 'número; antes de encenderlo lo probamos contigo.',
            preguntas: [
              ['¿Qué hace exactamente?',
               'Contesta el WhatsApp de tu negocio a cualquier hora con tu información —horarios, '
               + 'precios, ubicación y lo que más te preguntan—, agenda citas o toma pedidos y te '
               + 'los pasa. Cuando no sabe algo, te avisa y te pasa la conversación.'],
              ['¿Cuánto cuesta?',
               '{precio} MXN la puesta en marcha, con el primer mes incluido. A partir del '
               + 'segundo mes, {mensual} MXN al mes, que es lo que cuesta mantenerlo contestando. '
               + 'Puedes dejar {anticipo} MXN de anticipo y pagar los {resto} MXN cuando quede '
               + 'funcionando.'],
              ['¿Puedo cancelar la mensualidad?',
               'Sí, cuando quieras: el agente deja de contestar al final del mes pagado. Tu '
               + 'información no se pierde y se puede volver a encender.'],
              ['¿Necesito otro número de WhatsApp?',
               'No. Puede ser el que ya usas para el negocio.'],
              ['¿En cuánto tiempo funciona?',
               'En {plazo} días hábiles desde que tengamos tu información y el número. Antes de '
               + 'encenderlo lo probamos contigo.'],
              ['¿Reemplaza a una persona?',
               'No. Contesta con la información que le das; no toma decisiones por ti, y cuando '
               + 'un caso necesita a alguien, te lo pasa.'],
            ] },
  auto:   { pagina: 'automatizacion.html', gracias: 'gracias-paquete.html',
            entrega: 'la automatización corriendo', terminos: 'automatizacion',
            titulo: 'Automatización de tareas para tu negocio',
            plazo: 'Corriendo en *10 días hábiles* desde la llamada, con los accesos a las '
              + 'herramientas.',
            preguntas: [
              ['¿Qué es una automatización?',
               'Una tarea que hoy haces a mano y que dejamos corriendo sola: pasar los pedidos '
               + 'de WhatsApp a una hoja, mandar recordatorios de citas, armar el reporte de la '
               + 'semana. Conectamos hasta 3 herramientas de las que ya usas.'],
              ['¿Cuánto cuesta?',
               '{precio} MXN por una automatización, precio cerrado. Puedes dejar {anticipo} MXN '
               + 'de anticipo y pagar los {resto} MXN cuando quede corriendo.'],
              ['¿Cómo sé si mi tarea se puede automatizar?',
               'Con una llamada de 30 minutos, incluida: la vemos contigo y elegimos la que más '
               + 'tiempo te quita. Si resulta que necesita más de 3 herramientas o programar algo '
               + 'a medida, te lo decimos ahí mismo y lo cotizamos aparte; si prefieres no seguir, '
               + 'se te devuelve el pago íntegro.'],
              ['¿Qué herramientas conectan?',
               'Las que ya usas: WhatsApp, Excel, Google Sheets, correo, tu agenda. Si alguna '
               + 'tiene suscripción, esa corre por tu cuenta.'],
              ['¿En cuánto tiempo está corriendo?',
               'En {plazo} días hábiles desde la llamada, con los accesos a las herramientas.'],
              ['¿Y si se detiene?',
               'Te dejamos un documento corto de cómo funciona y qué hacer si se para.'],
            ] },
};

/* ⚠ LAS PREGUNTAS SE ESCRIBEN AQUÍ Y NO EN EL HTML, por una razón: llevan
   precios y plazos. Un «¿Cuánto cuesta?» escrito a mano en cuatro páginas es
   cuatro sitios donde un precio se queda viejo el día que cambie la tabla.
   Aquí van con marcadores —{precio}, {anticipo}, {resto}, {mensual}, {plazo},
   {placa}, {placas}, y {campo@id} para un paquete concreto—, la generación los
   rellena, y una guarda revienta si alguien teclea una cifra con «$» a mano.

   `plazo` lleva el número dentro del texto, en asteriscos, y otra guarda exige
   que la lista de «qué incluye» de la familia diga esos mismos días: son dos
   sitios que hablan del plazo y no pueden discrepar. */

const SERVICIOS = [
  {
    id: 'gp-e',
    familia: 'google',
    /* Las placas de reseñas se pueden añadir SÓLO a los paquetes de Google:
       el perfil es donde caen las reseñas y la placa lo que hace que las
       dejen. En una web o una automatización no cuentan la misma historia, y
       el titular pidió expresamente no saturar. */
    placas: true,
    /* DOS NOMBRES A PROPÓSITO. El largo es el que viaja al cobro y el que
       aparece en el estado de cuenta del comprador, donde «Lo esencial» a secas
       no dice de qué. El corto es el de la página, donde la cabecera ya dice
       que esto es el perfil de Google y repetirlo en las cuatro opciones sólo
       parte los renglones. */
    nombre: 'Perfil de Google · Lo esencial',
    corto: 'Lo esencial',
    precio: 1490,
    anticipo: 750,
    /* ⚠ EL RESUMEN NO PUEDE SONAR A «ESTO VA DE FOTOS». Decía «Con las fotos
       que tú nos mandes», que es cierto pero es la LETRA PEQUEÑA puesta de
       titular: quien no sabe qué es configurar un perfil de Google leía eso y
       entendía que el paquete son fotos. Lo que compra es la ficha entera
       montada y lista; lo de las fotos es una condición, y va detrás.

       ⚠ Y TAMPOCO PUEDE SONAR A MEDIA ENTREGA. Este decía «completa y lista
       para recibir reseñas» y el otro «lo dejamos funcionando nosotros», que
       leídos uno al lado del otro dicen que el barato NO se deja funcionando.
       Es falso: los dos se entregan funcionando. La diferencia no es el
       resultado, es CUÁNTO PONE CADA UNO — y eso es lo que dicen ahora. */
    resumen: 'Tu ficha de Google queda *completa y funcionando*: tus datos, tus fotos y *tu enlace de reseñas*',
    /* Lo que incluye, en la propia tarjeta y no en la página de términos. Antes
       había que salir a un texto legal con plazos y cancelación mezclados,
       leerlo entero y volver — y eso es un cliente perdido por pereza. Frases
       cortas, sin jerga, y la condición al final.

       ⚠ CADA LÍNEA TIENE QUE SER CIERTA EN LOS DOS CASOS: con una ficha que ya
       existe y con una que creamos de cero. Es la regla que se saltaba la línea
       de las reseñas del otro paquete —«contestamos hasta 30 reseñas que ya te
       dejaron» a quien todavía no aparece en Google—, y la que obliga aquí a que
       la primera diga las tres puertas de entrada en vez de una. */
    incluye: [
      '*Creamos tu ficha de Google*, la reclamamos o entramos a la tuya',
      'Elegimos *tu categoría principal* y las otras con las que te buscan',
      'Ponemos *el mapa* en tu puerta o en la zona que cubres',
      'Ponemos *horarios, teléfono, WhatsApp y sitio web* al día',
      'Escribimos *tu descripción* con las palabras que la gente busca',
      'Subimos y acomodamos *las fotos que nos mandas*',
      '*La cuenta queda a tu nombre*, con tu enlace de reseñas',
    ],
  },
  {
    id: 'gp-t',
    familia: 'google',
    placas: true,
    nombre: 'Perfil de Google · Todo hecho',
    corto: 'Todo hecho',
    precio: 2300,
    anticipo: 1150,
    resumen: 'Todo lo de «Lo esencial», y además *la dejamos llena*: fotos, productos, preguntas y publicaciones',
    /* ⚠ NINGUNA DE ESTAS DIEZ LÍNEAS REPITE UNA DE «LO ESENCIAL», y no es
       elegancia: la tarjeta enseña las dos listas, una debajo de otra, y una
       línea repetida se vería dos veces seguidas. Lo que hereda lo pone la
       plantilla —ver `hereda`—, no una línea escrita a mano que dijera «todo lo
       de Lo esencial» y que habría que acordarse de mantener.

       ⚠ «CONTESTAMOS LAS RESEÑAS QUE TENGAS, HASTA 30» Y NO «LAS QUE YA TE
       DEJARON». Es el arreglo del fallo que encontró el dueño: a la mitad de los
       compradores les estamos creando la ficha de cero y no hay ninguna reseña
       anterior que contestar. Así la línea es cierta con reseñas y sin ellas, y
       la segunda mitad —dejar las respuestas escritas— es trabajo real en los
       dos casos.

       ⚠ NO ESTÁ «ACTIVAMOS LOS MENSAJES DE GOOGLE», y estuvo a punto: Google
       retiró la mensajería del Perfil de Negocio el 31 de julio de 2024. Vender
       hoy algo que ya no existe es una devolución garantizada. */
    incluye: [
      /* ⚠ LA CIUDAD Y EL «SIN COSTO» VAN EN ESTA LÍNEA, aunque el matiz de
         arriba ya diga las dos cosas. Este desplegable se lee SOLO: quien lo
         abre está comparando listas y no vuelve al párrafo de encima, así que
         «vamos a tu negocio» sin ciudad promete una visita a Monterrey, y sin
         «sin costo extra» deja pensando si la visita se cobra aparte. Es la
         línea que justifica los $810 de diferencia: no puede depender de que
         alguien haya leído otro renglón. */
      '*Vamos a tu negocio y tomamos hasta 20 fotos*, sin costo extra (San Luis Potos\u00ed y Soledad)',
      'Cargamos *hasta 20 productos o servicios* con su precio',
      'Marcamos tus *formas de pago, accesibilidad y estacionamiento*',
      /* ⚠ ESTA LÍNEA SÓLO EXISTE SI HAY RESEÑAS QUE CONTESTAR, y la pantalla ya
         sabe si las hay: la primera pregunta del formulario es justo ésa. Decía
         «contestamos las reseñas que tengas, hasta 30», que no es falso —quien
         no tiene ninguna tiene cero— pero es papel mojado para la mitad de los
         compradores: acaban de marcar «todavía no aparece en Google» y dos
         renglones después se les ofrece contestar reseñas que no existen. Se
         turna con la misma regla de CSS que ya turna el párrafo del anticipo,
         y por tanto también sin JavaScript. */
      { solo: 'si', texto: '*Contestamos una por una hasta 30 reseñas* que ya te dejaron' },
      /* Y ésta va SIN condición y en segundo lugar a propósito: es cierta en
         los dos casos, así que es la que queda cuando la de arriba se apaga —y
         la única que se ve en un navegador tan viejo que no entienda `:has()`,
         donde ninguna de las dos condicionales aparecería. */
      'Dejamos escritas *las respuestas* para las reseñas que vayan llegando',
      'Dejamos puestas *las preguntas que más te hacen*, con su respuesta',
      'Publicamos *tus primeros avisos y novedades* con foto',
      'Revisamos qué tienen puesto *los negocios como el tuyo*',
      'Revisamos si tu negocio *sale repetido* y lo reportamos',
      'Te mandamos *tu cartel de papel con QR*, listo para imprimir',
      'Te entregamos *un reporte con capturas* y te explicamos cómo mantenerla',
    ],
    /* De quién hereda la lista. La tarjeta de este paquete enseña ADEMÁS los
       puntos del otro, sin que haya que abrirlo ni volver atrás: «pon que puedan
       ver que tiene lo de esencial por si hay algún huevón», y tiene razón —
       nadie compara dos tarjetas abriendo y cerrando desplegables. */
    hereda: 'gp-e',
    /* LA VISITA NO ES NACIONAL Y LA PÁGINA DE COBRO NO PUEDE CALLARLO. Los
       términos la limitan a San Luis Potosí y Soledad desde el primer día; el
       titular de esta cifra vive aquí y va en coche. Sin esta línea, alguien de
       Monterrey pagaba $2,300 leyendo «vamos a tu negocio» y descubría la letra
       pequeña en la página de términos, que es donde nadie mira antes de pagar.
       Va en el mismo bloque que la promesa, no en un enlace. */
    nota: '*La visita es sólo en San Luis Potosí y Soledad* de Graciano Sánchez; ahí las '
        + 'fotos las tomamos nosotros. Desde otra ciudad hacemos todo lo demás igual y '
        + '*las fotos nos las mandas tú*.',
    /* Y la misma condición, en un dato que pueda leer el Worker. La página ya
       se lo avisa al comprador; el otro extremo —quien prepara el trabajo— no
       se enteraba por ningún lado y tenía que caer en la cuenta leyendo la
       ciudad en mitad de una línea. */
    visita: true,
    destaca: true,
  },

  /* ═══ LOS OTROS TRES SERVICIOS, CON PAQUETE CERRADO ═══
     Hasta aquí «una web para una taquería y una para una clínica no son el
     mismo trabajo» y los tres se cotizaban por WhatsApp. Lo que cambia no es
     esa verdad, es la oferta: lo que se vende en línea es un ALCANCE CERRADO
     —tantas páginas, tantos días, tantas rondas de cambios— que se entrega
     igual a todo el mundo, y lo que se salga de ahí se sigue cotizando aparte,
     y se dice en la propia tarjeta. Los tres precios los puso el titular; el
     anticipo es la mitad redondeada al peso hacia arriba, porque el catálogo
     no acepta centavos. */
  {
    id: 'web-c',
    familia: 'web',
    nombre: 'Sitio web completo',
    corto: 'Sitio web completo',
    precio: 6199,
    anticipo: 3100,
    resumen: 'Tu sitio web *listo y en línea*: hecho para vender, con *tu dominio*, y viéndose bien en el celular',
    incluye: [
      '*Hasta 5 páginas*: inicio, servicios o productos, quiénes son, galería y contacto',
      'Diseño a medida que se ve bien en *celular, tablet y computadora*',
      '*Botón de WhatsApp*, formulario de contacto y mapa de cómo llegar',
      '*Tu dominio .com y el hospedaje* del primer año, incluidos',
      'Lo damos de alta en *Google* para que te encuentren',
      '*Dos rondas de cambios* antes de publicarlo',
      'Te explicamos cómo *cambiar textos y fotos tú mismo*',
      '*Listo en 15 días hábiles* desde que nos mandes tu material',
    ],
    nota: '*Tú pones* el logo, las fotos y la información de tu negocio; *los textos los '
        + 'escribimos nosotros* con lo que nos cuentes. Después del primer año, el dominio '
        + 'y el hospedaje *se renuevan aparte*.',
  },
  {
    id: 'ia-w',
    familia: 'ia',
    nombre: 'Agente de WhatsApp con IA',
    corto: 'Agente de WhatsApp',
    precio: 4459,
    anticipo: 2230,
    /* ⚠ LA MENSUALIDAD ES PARTE DEL PRECIO Y SE DICE ANTES DE PAGAR. Un agente
       cuesta dinero cada mes mientras contesta, y venderlo como un pago único
       es una devolución garantizada al segundo mes. El número vive aquí y la
       tarjeta lo escribe sola desde este campo, para que el precio de la
       página y el de los términos —que tienen una guarda— no puedan separarse.
       NO la cobra esta web: es un enlace de suscripción del panel de Mercado
       Pago que se manda por WhatsApp al terminar el primer mes. */
    mensual: 990,
    resumen: 'Un agente que *contesta tu WhatsApp las 24 horas* con la información de tu negocio, y *agenda citas o toma pedidos*',
    incluye: [
      'Contesta *al momento*, de día y de noche, también en fin de semana',
      'Responde con *tu información*: horarios, precios, ubicación y lo que más te preguntan',
      '*Agenda citas o toma pedidos* y te los pasa por WhatsApp',
      'Cuando no sabe algo, *te avisa y te pasa la conversación*',
      'Lo *entrenamos con tu negocio* y lo probamos contigo antes de encenderlo',
      '*Primer mes* de funcionamiento incluido',
      '*Funcionando en 10 días hábiles* desde que nos mandes tu información',
    ],
  },
  {
    id: 'au-1',
    familia: 'auto',
    nombre: 'Una automatización concreta',
    corto: 'Una automatización',
    precio: 3749,
    anticipo: 1875,
    resumen: 'Elegimos *una tarea que hoy haces a mano* y la dejamos *corriendo sola*, conectando lo que ya usas',
    incluye: [
      '*Una llamada de 30 minutos* para ver la tarea contigo y elegir la que más tiempo te quita',
      'La dejamos *corriendo sola*: pasar pedidos a una hoja, mandar recordatorios, armar el reporte semanal',
      'Conectamos *hasta 3 herramientas* de las que ya usas: WhatsApp, Excel, Google Sheets, correo, tu agenda',
      'La *probamos contigo* con datos reales antes de darla por buena',
      'Te dejamos *un documento corto* de cómo funciona y qué hacer si se detiene',
      '*Corriendo en 10 días hábiles* desde la llamada',
    ],
    nota: 'Es *una automatización, no un sistema entero*: si la tarea necesita más de 3 '
        + 'herramientas o programar algo a medida, te lo decimos en la llamada y *lo '
        + 'cotizamos aparte antes de empezar*.',
  },
];

/* ═══════════ LAS PLACAS DENTRO DEL PAQUETE ═══════════

   El titular lo pidió con estas palabras: «que elija una, dos placas de
   reseñas y configurar tu perfil de Google». Y tiene lógica de negocio, no
   sólo de venta: el perfil es DONDE caen las reseñas y la placa es LO QUE
   HACE que las dejen — por separado, cada mitad se queda coja.

   `precio` es lo que cuesta CADA placa dentro del paquete. Es una decisión
   comercial del titular y se cambia tocando este número y regenerando; la
   guarda de más abajo impide que suba tanto que el «descuento» sea mentira.

   `max` está en 2 y no es tacañería: es lo que el titular dijo («una, dos
   placas») y además donde el ahorro frente a la escalera de sueltas se
   sostiene — la de 2 sueltas vale $649, así que 2 aquí ahorran $149; la de
   3 vale $799 y 3 aquí ahorrarían $49, que anunciado como ahorro da
   vergüenza. Quien quiera más placas ya tiene su camino: la ficha del
   producto y el WhatsApp de mayoreo. */
const PLACA_EN_PAQUETE = { precio: 250, max: 2 };

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
    /* Los ids que DE VERDAD se publican son más que los dos de siempre: cada
       combinación con placas es una fila propia del catálogo —el importe nunca
       puede salir del navegador— y su id se construye pegando el número al
       final: gp-t2, gp-ta2. Todos pasan por la misma guarda de 8 caracteres. */
    const publicados = [s.id];
    if (s.anticipo) publicados.push(s.id + 'a');
    if (s.placas) for (let n = 1; n <= PLACA_EN_PAQUETE.max; n++) {
      publicados.push(s.id + n);
      if (s.anticipo) publicados.push(s.id + 'a' + n);
    }
    /* Una familia que no existe no tiene página donde cobrarse: el generador
       escribiría el paquete en ninguna parte y la portada lo anunciaría. */
    if (!FAMILIAS[s.familia])
      throw new Error(`servicio «${s.nombre}»: la familia «${s.familia}» no está en FAMILIAS`);
    if (s.mensual !== undefined && (!Number.isInteger(s.mensual) || s.mensual <= 0))
      throw new Error(`servicio «${s.nombre}»: la mensualidad ${s.mensual} no es un entero positivo`);
    for (const id of publicados) {
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
    /* Heredar de un id que no existe deja la tarjeta del paquete caro SIN la
       lista del barato y sin decir nada: se ve bien, vende menos, y no hay
       forma de notarlo mirando la página. */
    if (s.hereda !== undefined && !SERVICIOS.some(x => x.id === s.hereda))
      throw new Error(`servicio «${s.nombre}»: hereda de «${s.hereda}», que no es ningún paquete`);
    if (s.hereda === s.id)
      throw new Error(`servicio «${s.nombre}»: no puede heredar de sí mismo`);
    /* Una línea repetida entre los dos saldría DOS VECES SEGUIDAS en la misma
       tarjeta, que es justo lo que el dueño pidió que no pasara. */
    /* Un punto con condición se escribe `{ solo: 'si'|'no', texto }`. Un `solo`
       mal escrito no rompe nada visible: la clase que sale no la enciende
       ninguna regla del CSS y la línea desaparece de las dos vistas. */
    for (const x of s.incluye || []) {
      if (typeof x === 'string') { if (x.trim()) continue;
        throw new Error(`servicio «${s.nombre}»: hay un punto vacío en «incluye»`); }
      if (x.solo !== 'si' && x.solo !== 'no')
        throw new Error(`servicio «${s.nombre}»: «solo» vale «si» o «no», no «${x.solo}»`);
      if (!x.texto || !String(x.texto).trim())
        throw new Error(`servicio «${s.nombre}»: un punto con condición se quedó sin texto`);
    }
    if (s.hereda) {
      const otro = SERVICIOS.find(x => x.id === s.hereda);
      const texto = x => typeof x === 'string' ? x : x.texto;
      const suyas = new Set(((otro && otro.incluye) || []).map(texto));
      for (const linea of (s.incluye || []).map(texto))
        if (suyas.has(linea))
          throw new Error(`servicio «${s.nombre}»: «${linea}» ya está en «${otro.corto || otro.nombre}»`);
    }
  }
}

const CUOTAS_DESDE = 2500;

/* ⚠ EL ENVÍO SE COBRA SÓLO EN EL PEDIDO DE UNA PLACA, Y ES UNA DECISIÓN.
   Estuvo cobrándose —79, 69 y 59 pesos en los tres primeros paquetes—, luego
   en cero en todas las filas, y ahora vuelve en una sola: $179 en la de una
   pieza y gratis a partir de dos. Lo que se compra con ese número es el salto
   a dos: quien lleva una paga el envío entero, quien lleva dos no paga
   ninguno, y la diferencia la ve escrita en la propia ficha.

   Y no hizo falta tocar nada más que la columna: el Worker, el contador, el
   aviso de «lleva 2 y no pagas envío», el desglose «$399 + $179 de envío» y el
   descuento por entrega en mano estaban escritos para esto desde el día que se
   puso a cero, y se han encendido solos. Lo único que NO se enciende solo es el
   texto legal, y de eso se ocupa una guarda más abajo.

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
  { piezas:  1, precio:  399, envio:  179 },
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
/* LAS PALABRAS CLAVE VAN ENTRE ASTERISCOS EN LA TABLA: *así*. Quien compara
   paquetes lee en diagonal, y una tarjeta de texto gris uniforme no le deja
   nada a lo que agarrarse; con dos o tres palabras en bronce por línea —las
   que dicen QUÉ se lleva— la lista se entiende sin leerla entera. El titular lo
   pidió con estas palabras: «palabras clave que resalten, con poco pero de
   calidad». Pocas por línea, o no resaltan.
   Se convierten en <b> al escribir el HTML. Un asterisco sin pareja revienta
   la generación: un resalte a medias saldría impreso como asterisco. */
const resalta = t => {
  const partes = String(t).split('*');
  if (partes.length % 2 === 0) throw new Error(`resalte sin cerrar en: «${t}»`);
  return partes.map((x, i) => i % 2 ? `<b>${ent(x)}</b>` : ent(x)).join('');
};

/* Miles con coma: $1,899. Es como se enseñan los precios en el sitio. */
const miles = n => n.toLocaleString('en-US');

const gratis = p => p.envio === 0;
const total  = p => p.precio + p.envio;

/* La escalera de placas sueltas contra la que se anuncia el ahorro del
   paquete. Sale de la MISMA tabla que vende las sueltas: si mañana sube la de
   una placa, el ahorro anunciado cambia solo, sin que nadie lo recuerde. */
const escaleraPlacas = () => Array.from({ length: PLACA_EN_PAQUETE.max },
  (_, i) => {
    const fila = PAQUETES.find(p => p.piezas === i + 1);
    if (!fila) throw new Error(`placas en paquete: no hay fila de ${i + 1} placa(s) en la escalera`);
    return total(fila);
  });

/* ⚠ EL «TE AHORRAS $X» NO PUEDE SER MENTIRA NI PUEDE SER RIDÍCULO. Si el
   precio del paquete sube por encima de la escalera, el descuento anunciado
   se vuelve un recargo; y un ahorro de veinte pesos anunciado en grande hace
   más daño que no anunciar nada. Las dos cosas revientan aquí, en generación,
   no en la cara de un cliente. */
{
  const { precio, max } = PLACA_EN_PAQUETE;
  if (!Number.isInteger(precio) || precio <= 0)
    throw new Error(`placas en paquete: el precio ${precio} no es un entero positivo`);
  if (!Number.isInteger(max) || max < 1 || max > 3)
    throw new Error(`placas en paquete: max=${max} — entre 1 y 3, y con 3 revisa antes el ahorro`);
  /* ⚠ EL PÁRRAFO DEL COMBO EN LOS TÉRMINOS ESTÁ ESCRITO A MANO, y es el
     documento legal: si el titular sube el precio aquí y regenera, toda la web
     cobra lo nuevo mientras los términos prometen lo viejo — y un comprador
     puede exigir el precio de los términos. Esta guarda revienta la generación
     antes de que esa contradicción exista. */
  /* Se leen los términos con los espacios APLANADOS: en el HTML las frases van
     partidas por saltos de línea y sangría, y sin esto una guarda fallaría por
     dónde cayó el corte —«no incluye el\n    envío»— en vez de por lo que dice
     el documento. Una guarda que se dispara al reflujar un párrafo no protege
     nada; enseña a desactivarla. */
  const terminos = fs.readFileSync(
    path.join(path.dirname(HTML), 'terminos.html'), 'utf8').replace(/\s+/g, ' ');
  if (!terminos.includes(`$${precio} MXN`) || !terminos.includes(`hasta ${max} placas`))
    throw new Error('placas en paquete: terminos.html no dice el precio ' +
      `($${precio} MXN) o el tope (hasta ${max} placas) de esta tabla — ` +
      'actualiza el párrafo «Placas de reseñas dentro del paquete»');
  escaleraPlacas().forEach((suelta, i) => {
    const n = i + 1, dentro = precio * n;
    if (suelta - dentro < 40)
      throw new Error(`placas en paquete: ${n} a $${precio} c/u ahorran $${suelta - dentro} ` +
        `frente a $${suelta} sueltas — eso no es un descuento que se pueda anunciar`);
  });
  /* Y LO MISMO PARA CADA SERVICIO: su precio tiene que estar escrito en los
     términos tal cual se cobra —«$6,199 MXN»— y, si lleva mensualidad, también
     ella. Un paquete que la web vende y los términos no nombran es un contrato
     sin precio; uno que nombran con otra cifra, un contrato con el precio
     equivocado. */
  /* ⚠ EL ENVÍO DE LOS TÉRMINOS TIENE QUE SER EL DE ESTA TABLA. Es el documento
     que obliga: si el titular cambia el importe aquí y regenera, toda la web
     cobra lo nuevo mientras el contrato sigue prometiendo lo viejo — y quien
     compre puede exigir lo que dicen los términos. */
  {
    const uno = PAQUETES[0], desde = desdeGratis();
    if (uno.envio > 0) {
      if (!terminos.includes(`$${miles(uno.envio)} MXN`))
        throw new Error(`envío: terminos.html no dice cuánto cuesta ($${miles(uno.envio)} MXN)`);
      if (desde !== null && !terminos.includes(`a partir de ${desde === 2 ? 'dos' : desde}`))
        throw new Error(`envío: terminos.html no dice desde cuántas placas es gratis (${desde})`);
      /* Y lo más importante de todo, porque es lo que separa un envío bien
         anunciado de una sorpresa en la caja: el contrato tiene que decir que
         la cifra grande NO lo lleva dentro. Mientras el precio anunciado era el
         total, callarlo daba igual; desde que son dos cifras, quien sólo lee la
         grande tiene derecho a que el documento le diga que falta una. */
      if (!terminos.includes('no incluye el envío'))
        throw new Error('envío: terminos.html no dice que el precio anunciado NO lo lleva dentro');
    } else if (!terminos.includes('envío está incluido')) {
      throw new Error('envío: está a cero en la tabla y terminos.html no dice que va incluido');
    }
  }
  for (const s of SERVICIOS) {
    if (!terminos.includes(`$${miles(s.precio)} MXN`))
      throw new Error(`servicio «${s.nombre}»: terminos.html no dice su precio ($${miles(s.precio)} MXN)`);
    if (s.mensual && !terminos.includes(`$${miles(s.mensual)} MXN al mes`))
      throw new Error(`servicio «${s.nombre}»: terminos.html no dice su mensualidad ($${miles(s.mensual)} MXN al mes)`);
  }
}
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
    s: gratis(p) ? 'envío gratis' : `+ $${p.envio} de envío`,
    g: avisoGratis(p),
  }));
  /* `local` viaja para que pedido.html pueda AVISAR de que no se cobrará el
     envío en cuanto se teclee un código postal de casa. Es sólo el aviso: el
     descuento lo aplica el Worker, con esta misma lista generada aquí. */
  const datos = { local: { nombre: ENTREGA_LOCAL_NOMBRE, rangos: ENTREGA_LOCAL }, filas };
  return '<script type="application/json" id="pc-tabla">' + JSON.stringify(datos) + '<\/script>';
}

/* La línea chica bajo la cifra.

   ⚠ LA CIFRA GRANDE ES EL PRECIO DEL PRODUCTO, SIN ENVÍO, y esta línea es la
   que impide que eso sea una trampa: va pegada debajo, dice «$399 + $179 de
   envío» y nombra las dos partes antes de que nadie toque un botón.

   El envío no cabe en la cifra grande porque NO SE SABE todavía. Vale $179 por
   paquetería y $0 si el código postal es de la ciudad —ahí la llevamos nosotros
   en mano—, así que hasta que no hay dirección no existe un total honesto: el
   $578 que salía antes era simplemente el peor de los dos casos anunciado como
   si fuera el único. Se resuelve donde se resuelve de verdad, al escribir el
   código postal, y hasta entonces la portada dice lo que sí sabe.

   Lo que NO puede pasar es que el envío aparezca por sorpresa al final. Por eso
   esta línea existe, por eso la cabecera de pedido.html avisa de que falta, y
   por eso ese aviso se genera aquí y no se escribe a mano en cada sitio.

   Además dice a cómo queda la pieza cuando se llevan varias, que es lo que hace
   subir el contador. Con una sola placa el precio por pieza es el propio
   precio, así que repetirlo sobraría. */
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

/* Las cuatro opciones de compra de servicio.html. Se generan por el mismo
   motivo que todo lo demás: el precio que se lee en pantalla y el que cobra el
   Worker salen de la misma tabla, o antes o después divergen.

   El `value` de cada radio es el id que el Worker busca en su catálogo. Que
   coincidan no es convención ni suerte: los dos los escribe este archivo. */
function bloqueServicio(familia) {
  const pesos = n => '$' + miles(n);
  const fam = FAMILIAS[familia];
  if (!fam) throw new Error(`bloqueServicio: familia «${familia}» desconocida`);
  const propios = SERVICIOS.filter(s => s.familia === familia);
  if (!propios.length) throw new Error(`bloqueServicio: la familia «${familia}» no tiene paquetes`);
  /* El paquete del que éste hereda su lista, si es que hereda de alguno. Se
     busca por id y no se copia a mano: así, el día que a «Lo esencial» se le
     añada una línea, aparece sola en la tarjeta del caro. */
  /* Un punto de la lista es una cadena, o un objeto `{ solo, texto }` cuando
     sólo vale en uno de los dos casos de la pregunta de arriba. La clase la
     apaga o la enciende el CSS con `:has()`, igual que al párrafo del anticipo:
     sin JavaScript también. */
  const punto = x => typeof x === 'string'
    ? `<li>${resalta(x)}</li>`
    : `<li class="sv-solo-${x.solo}">${resalta(x.texto)}</li>`;
  const heredado = s => {
    if (!s.hereda) return null;
    const otro = SERVICIOS.find(x => x.id === s.hereda);
    if (!otro) return null;
    return { nombreCorto: otro.corto || otro.nombre, incluye: otro.incluye || [] };
  };
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
    /* El importe del anticipo lleva su gancho: con placas en el paquete, lo
       que se deja HOY crece (anticipo + placas) y esta frase no puede quedarse
       diciendo $750 mientras el radio de abajo dice $1,000 — el titular pidió
       expresamente «no te contradigas en ninguna parte». El resto NO cambia:
       las placas se pagan hoy, no se deben. Sin JavaScript no hay placas y la
       cifra escrita es la verdad completa. */
    const comoNo = s.anticipo
      ? `P&#225;galo <b>de contado</b>, o deja <b data-sv-frase-ant data-base="${s.anticipo}">`
        + `${pesos(s.anticipo)} de anticipo</b> `
        + `y los ${pesos(resto)} restantes cuando te entreguemos ${ent(fam.entrega)}.`
      : 'Un solo pago.';
    /* En castellano llano. Decía «el trabajo se hace sobre una cuenta que ya
       controlas y no hay entrega que reservar», que es exacto y no lo entiende
       nadie que no sepa ya de qué va. Lo que hay que decir es qué le toca a él:
       este paquete se paga entero, y por qué. */
    const comoSi = 'Como tu ficha <b>ya existe</b>, este paquete se paga <b>de contado</b>. '
      + 'El anticipo s&#243;lo existe cuando la cuenta la creamos nosotros.';

    /* DOS ATRIBUTOS PARA EL MISMO IMPORTE, y no es duplicar por gusto.
       `data-tot` es lo que se PINTA en la cifra grande, ya con su coma y su
       peso. `data-num` es el ENTERO, que es lo que se guarda para la página de
       gracias — que lo vuelve a formatear ella. Cuando esto guardaba el texto,
       `Number('$1,490')` daba NaN y el comprador leía «$NaN» en el resumen de
       lo que acababa de pagar. `data-resto` es lo que faltará por cobrar, para
       que esa misma página pueda decirlo en vez de dejarlo a la imaginación. */
    /* `data-id` ES EL ID SIN PLACAS Y `value` EL QUE VIAJA. Con placas, el
       script recompone value = id + número (gp-ta → gp-ta2): así el importe
       sigue saliendo del catálogo del Worker, nunca del navegador. Y si el
       Worker desplegado fuera uno viejo sin los combos, la venta falla EN VOZ
       ALTA con «Ese paquete no existe» en vez de cobrar el paquete sin placas
       — cobrar de menos en silencio es el peor de los dos fallos.

       `data-base` en el <b>: el rótulo «Pagar $750 de anticipo» tiene que
       crecer con las placas o diría un importe y el botón otro. */
    const opcion = (id, importe, titulo, pie, anticipo) =>
      '          <label class="ped-op">\n' +
      `            <input type="radio" name="paquete" value="${id}" data-id="${id}" required\n` +
      `                   data-tot="${pesos(importe)}" data-num="${importe}"` +
      (anticipo ? ` data-resto="${s.precio - s.anticipo}"` : '') + '\n' +
      `                   data-que="${ent(corto + ' · ' + (anticipo ? 'anticipo' : 'de contado'))}"` +
      (anticipo ? ' data-anticipo="1"' : '') + '>\n' +
      `            <b data-sv-op data-base="${importe}">${ent(titulo)}</b>\n` +
      `            <small>${pie}</small>\n` +
      '          </label>';

    const ops = [opcion(s.id, s.precio, `Pagar ${pesos(s.precio)} de contado`,
                        'Un solo pago y listo.', false)];
    /* La condición del anticipo sólo existe donde hay una pregunta que la
       decide (Google). En las demás familias el anticipo está siempre, y una
       coletilla que dijera «sólo si…» sin que nada la sostenga es ruido. */
    if (s.anticipo) ops.push(opcion(s.id + 'a', s.anticipo,
      `Pagar ${pesos(s.anticipo)} de anticipo`,
      `Y ${pesos(resto)} cuando te entreguemos ${ent(fam.entrega)}.` +
      (fam.pregunta ? ' ' + ent('Sólo si creamos la cuenta nosotros.') : ''),
      true));
    /* La mensualidad, escrita desde el número y no a mano: la tarjeta y los
       términos no pueden decir dos cifras distintas para el mismo mes. */
    const nota = [
      s.mensual ? `A partir del *segundo mes* cuesta *${pesos(s.mensual)} al mes*: es lo que `
        + 'cuesta mantenerlo contestando. Se cobra *aparte*, con un enlace de Mercado Pago, '
        + 'y lo puedes *dar de baja cuando quieras*.' : '',
      s.nota || '',
    ].filter(Boolean).join(' ');

    /* ⚠ DOS PAQUETES A LA VISTA, NO CUATRO OPCIONES. Con las cuatro formas de
       pago desplegadas a la vez la pantalla pide dos decisiones al mismo tiempo
       —qué compro y cómo lo pago— y el ojo acaba comparando importes entre
       paquetes distintos. Primero se elige el paquete; sus dos formas de pago
       viven DENTRO y sólo se descubren después.

       El botón «Elegir» nace con `hidden` en el marcado y lo enciende el
       script, que es el único que puede esconder los pagos. Sin JavaScript no
       hay botón y las cuatro opciones se ven a la vez, que es la página de
       siempre: se pierde el orden, no la venta. */
    return '      <div class="sv-plan" role="group" ' +
      `aria-label="${ent(corto + ', ' + pesos(s.precio))}" data-plan="${s.id}">\n` +
      /* ⚠ EL CONTROL CUBRE LA TARJETA ENTERA, no es un rectangulito debajo del
         texto. Un botón de 200 px dentro de una tarjeta de 700 hay que
         buscarlo; la tarjeta no. Va en `position:absolute` sobre todo el bloque
         y su texto sólo lo leen los lectores de pantalla — lo que se ve es la
         tarjeta, que ya dice qué es y cuánto cuesta. Y va PRIMERO en el marcado
         para que al tabular se llegue al control antes que a su contenido. */
      `        <button type="button" class="sv-elige" data-elige="${s.id}" hidden>` +
      `<span class="sr">Elegir ${ent(corto)}, ${pesos(s.precio)}</span></button>\n` +
      `        <p class="sv-nom">${ent(corto)}<span>${pesos(s.precio)}</span></p>\n` +
      `        <p class="sv-que">${resalta(s.resumen)}.</p>\n` +
      (nota ? `        <p class="sv-nota">${resalta(nota)}</p>\n` : '') +
      /* ⚠ QUÉ INCLUYE, AQUÍ MISMO Y PLEGADO. Antes esto sólo vivía en la página
         de términos, mezclado con plazos y cancelación: había que salir, leer un
         texto legal entero y volver. Un <details> nativo lo abre y lo cierra sin
         script, y plegado no roba ni una línea a la decisión de arriba.
         Va por ENCIMA del control que cubre la tarjeta (z-index en el CSS) para
         que abrirlo no sea, además, elegir el paquete. */
      /* ⚠ Y LO QUE HEREDA VA DENTRO DEL MISMO DESPLEGABLE, no en un «todo lo
         de Lo esencial» que obligue a subir a la otra tarjeta y abrir OTRO
         desplegable para saber qué es «todo». Nadie compara dos paquetes así:
         se lee el de arriba, se olvida la mitad y se compra el barato por
         cansancio. Aquí las dos listas caen seguidas, la propia primero
         —que es la que justifica los $810 de diferencia— y la heredada
         debajo, con su rótulo. */
      /* El rótulo lleva la CUENTA de puntos: «8 puntos» dice de un vistazo que
         ahí dentro hay una lista concreta y no dos líneas de relleno, que es
         justo lo que decide si alguien lo abre. Con herencia se cuentan las
         dos listas, que es lo que se ve al abrirlo. */
      (s.incluye && s.incluye.length
        ? '        <details class="sv-mas">\n' +
          `          <summary>${ent('Ver qué incluye')}<span class="sv-mas-n">` +
          `${s.incluye.length + (heredado(s) ? heredado(s).incluye.length : 0)} puntos</span></summary>\n` +
          '          <ul>' + s.incluye.map(punto).join('') + '</ul>\n' +
          (heredado(s)
            ? `          <p class="sv-mas-y">${ent('Y todo lo de «' + heredado(s).nombreCorto + '»:')}</p>\n` +
              '          <ul class="sv-mas-h">' +
              heredado(s).incluye.map(punto).join('') + '</ul>\n'
            : '') +
          '        </details>\n'
        : '') +
      /* DOS PÁRRAFOS HERMANOS Y NO UNO CON DOS ATRIBUTOS. Con un solo <p> que
         el script reescribe, sin JavaScript sólo existe una de las dos verdades
         y la otra no hay quien la enseñe. Siendo hermanos los turna el CSS con
         `:has()` sobre el radio marcado, que funciona sin script.
         Son dos y no tres porque la pregunta de arriba nace respondida: no hay
         estado «sin contestar» que cubrir, y un párrafo que no puede verse
         nunca es peor que no tenerlo — parece que sostiene algo. */
      /* Sin pregunta previa hay UNA verdad y no dos: un solo párrafo, con su
         propia clase, porque las otras dos las enciende el CSS a partir del
         radio de la ficha y sin ese radio se quedarían las dos apagadas. */
      (fam.pregunta
        ? `        <p class="sv-como sv-como-no">${comoNo}</p>\n` +
          `        <p class="sv-como sv-como-si">${comoSi}</p>\n`
        : `        <p class="sv-como sv-como-sola">${comoNo}</p>\n`) +
      /* La pista de que esto se toca, al FINAL: es lo último que se lee antes
         de decidir, y arriba competía con el precio. Sin ella, una tarjeta que
         reacciona al pulsarla no se distingue de un cuadro de texto que no hace
         nada. La enciende el script junto al control, porque sin él no es
         cierta. */
      '        <p class="sv-pista" data-sv-pista hidden>' +
      ent('Toca para elegir este paquete') + '</p>\n' +
      '        <div class="sv-pagos">\n' +
      ops.join('\n') + '\n        </div>\n      </div>';
  };
  /* ⚠ UN SOLO BLOQUE DE PLACAS PARA LOS DOS PAQUETES, fuera de las tarjetas.
     Dentro de cada tarjeta habría DOS contadores que sincronizar —dos fuentes
     para el mismo número— y además volvería a engordar la tarjeta, que el
     titular pidió expresamente no saturar. Aquí abajo aparece cuando hay un
     paquete abierto, igual que el bloque de los datos, y la cuenta sobrevive
     al cambio de paquete: quien decidió dos placas no las re-decide por
     cambiar de «Todo hecho» a «Lo esencial».

     Nace `hidden` porque SIN JavaScript no funciona: sin script nadie puede
     recomponer el id que viaja al cobro, y un contador que se ve pero no suma
     cobraría el paquete sin placas a quien cree que las pidió. Sin script se
     compra el servicio a secas — se pierde el extra, nunca la venta. */
  const placas = () => {
    const { precio, max } = PLACA_EN_PAQUETE;
    return '      <div class="sv-extra" data-sv-placas hidden\n' +
      `           data-precio="${precio}" data-max="${max}" data-esc="${escaleraPlacas().join(',')}"\n` +
      `           data-umbral="${CUOTAS_DESDE}">\n` +
      `        <p class="sv-extra-t">${ent('¿Le añades tus placas de reseñas?')}</p>\n` +
      /* ⚠ NI «EN EL PAQUETE … INCLUIDOS» NI CONFUNDIBLE CON EL CARTEL. La
         primera versión decía «$250 cada una en el paquete, con envío o
         instalación incluidos»: leída en diagonal —que es como lee quien
         compra— las palabras que quedan son «placas… paquete… incluidos», y
         alguien pagaba el paquete convencido de que las placas venían de
         regalo. Y diez líneas arriba «Todo hecho» ya regala un cartel de papel
         con QR: sin distinguirlos, placa y cartel parecen lo mismo. */
      `        <p class="sv-extra-p">${ent('La tocan con el teléfono y les abre tu reseña ' +
        '— es la placa rígida del mostrador, no el cartel de papel. ' +
        `$${miles(precio)} cada una, con envío o instalación.`)}</p>\n` +
      '        <div class="sv-cant" role="group" aria-label="' + ent('Cuántas placas') + '">\n' +
      `          <button type="button" class="sv-pm" data-sv-placa="-1" aria-label="${ent('Quitar una placa')}">&#8722;</button>\n` +
      /* Dos mitades dentro de la región viva: la visible («2 placas», de ancho
         fijo) y una sólo para el lector de pantalla con la consecuencia en
         DINERO. Sin ella, quien no ve la pantalla oía «2 placas» y nada más:
         los $500 que acababa de sumar al pago de hoy no se anunciaban nunca. */
      '          <span class="sv-pn" data-sv-placa-n aria-live="polite">' +
      '<span data-sv-placa-vis>Sin placas</span>' +
      '<span class="sr" data-sv-placa-sr></span></span>\n' +
      `          <button type="button" class="sv-pm" data-sv-placa="1" aria-label="${ent('Añadir una placa')}">+</button>\n` +
      '        </div>\n' +
      '        <p class="sv-extra-a" data-sv-ahorro hidden></p>\n' +
      '      </div>\n' +
      /* Va FUERA del div (que nace hidden y sin script nadie destapa): dentro,
         un noscript escondido no dice nada. La portada promete el combo en
         marcado estático, así que sin script alguien llega buscándolo — y se
         le da el canal que sí funciona sin script. */
      '      <noscript><p class="sv-extra-p">' +
      `${ent('¿Placas de reseñas con tu paquete? ')}` +
      '<a href="https://wa.me/524423697248?text=Hola.%20Quiero%20un%20paquete%20de%20Google%20con%20placas%20de%20rese%C3%B1as." ' +
      'target="_blank" rel="noopener noreferrer">' +
      `${ent('Escríbenos por WhatsApp')}</a>${ent(' y te lo cobramos junto.')}</p></noscript>`;
  };
  /* El bloque de placas sólo en la familia que las admite; en las demás no hay
     contador que enseñar ni WhatsApp de combo que ofrecer. */
  return '<!-- servicio:opciones -->\n' + propios.map(bloque).join('\n') + '\n' +
         (propios.some(s => s.placas) ? placas() + '\n' : '') +
         '      <!-- /servicio:opciones -->';
}

/* ---------------------------------------------- EL CONTENIDO DE CADA PÁGINA

   Las páginas de servicio eran sólo pantallas de cobro, y por eso iban con
   `noindex`. Pasan a ser también la página que responde a quien pregunta —a
   Google o a una IA— «cuánto cuesta una página web», «qué hace un agente de
   WhatsApp». Lo que responde lleva precio y plazo, así que lo genera este
   archivo: tres bloques por página, entre marcadores, igual que las opciones
   de cobro. El texto que no lleva cifras —qué es, para quién, cómo funciona—
   va escrito en cada HTML. */
const URL_SITIO = 'https://sycsolutions.company/';
const urlPagina = f => URL_SITIO + f.pagina.replace(/\.html$/, '');
const llano = t => String(t).replace(/\*/g, '');

/* Rellena los marcadores de una pregunta. `{precio}` mira el primer paquete
   de la familia; `{precio@gp-t}` uno concreto. Revienta con un marcador que no
   conozca, para que un dedazo no llegue a la web como «{precoi}». */
function rellena(texto, familia) {
  const propios = SERVICIOS.filter(x => x.familia === familia);
  const campos = (s, campo) => {
    if (campo === 'precio')   return '$' + miles(s.precio);
    if (campo === 'anticipo') return '$' + miles(s.anticipo);
    if (campo === 'resto')    return '$' + miles(s.precio - s.anticipo);
    if (campo === 'mensual')  return '$' + miles(s.mensual);
    if (campo === 'nombre')   return s.nombre;
    if (campo === 'corto')    return s.corto || s.nombre;
    if (campo === 'plazo') {
      const pl = FAMILIAS[familia].plazo || '';
      const m = /(\d+) días hábiles/.exec(pl);
      if (!m || /\d+ a \d+ días hábiles/.test(pl))
        throw new Error(`familia «${familia}»: {plazo} pide un solo número y su plazo no lo tiene`);
      return m[1];
    }
    if (campo === 'placa')  return '$' + miles(PLACA_EN_PAQUETE.precio);
    if (campo === 'placas') return String(PLACA_EN_PAQUETE.max);
    throw new Error(`familia «${familia}»: marcador desconocido {${campo}}`);
  };
  return texto.replace(/\{([a-z]+)(?:@([a-z0-9-]+))?\}/g, (_, campo, id) => {
    const s = id ? SERVICIOS.find(x => x.id === id) : propios[0];
    if (!s) throw new Error(`familia «${familia}»: {${campo}@${id}} no es ningún paquete`);
    const v = campos(s, campo);
    if (v === '$NaN' || v === 'undefined') throw new Error(`familia «${familia}»: {${campo}} no tiene valor en «${s.nombre}»`);
    return v;
  });
}

/* Guardas del contenido. Corren al cargar, con las demás. */
for (const [familia, f] of Object.entries(FAMILIAS)) {
  const propios = SERVICIOS.filter(x => x.familia === familia);
  if (!f.preguntas || f.preguntas.length < 3)
    throw new Error(`familia «${familia}»: hacen falta al menos tres preguntas`);
  for (const [q, r] of f.preguntas) {
    if (/\$\s?\d/.test(q + r))
      throw new Error(`familia «${familia}»: «${q}» lleva un precio tecleado a mano; usa {precio}, {anticipo}…`);
    if (/\b\d+ días hábiles/.test(q + r))
      throw new Error(`familia «${familia}»: «${q}» lleva un plazo tecleado a mano; usa {plazo}`);
    rellena(r, familia);   // revienta con un marcador desconocido
  }
  /* El plazo de la familia y el de la lista de «qué incluye» tienen que decir
     los mismos días. Sólo aplica cuando el plazo es un número: el de Google
     es un intervalo y su lista no lo repite. */
  const m = /(\d+) días hábiles/.exec(f.plazo || '');
  const intervalo = /\d+ a \d+ días hábiles/.test(f.plazo || '');
  if (m && !intervalo) {
    const lista = propios.flatMap(s => (s.incluye || []).map(x => typeof x === 'string' ? x : x.texto)).join(' ');
    if (!lista.includes(`${m[1]} días hábiles`))
      throw new Error(`familia «${familia}»: el plazo dice ${m[1]} días hábiles y la lista de «qué incluye» no`);
  }
  if (!f.terminos) throw new Error(`familia «${familia}»: falta la ancla de sus términos`);
  if (!f.titulo)   throw new Error(`familia «${familia}»: falta el título de su página`);
}

/* Precio, pago y plazo: la sección que una IA cita entera. */
function bloqueHechos(familia) {
  const f = FAMILIAS[familia];
  const pesos = n => '$' + miles(n);
  const propios = SERVICIOS.filter(x => x.familia === familia);
  const parrafos = propios.map(s => {
    let t = `<b>${ent(s.nombre)}</b> cuesta <b>${pesos(s.precio)} MXN</b>`;
    if (s.mensual) t += ` y, a partir del segundo mes, <b>${pesos(s.mensual)} MXN al mes</b>`;
    t += '. ';
    t += s.anticipo
      ? `De contado, o ${pesos(s.anticipo)} MXN de anticipo y ${pesos(s.precio - s.anticipo)} MXN al entregarte ${ent(f.entrega)}.`
      : 'Un solo pago.';
    return `      <p>${t}</p>`;
  });
  return '<!-- servicio:hechos -->\n' +
    '      <h2 id="precio">Precio, pago y plazo</h2>\n' +
    parrafos.join('\n') + '\n' +
    `      <p>${resalta(ent(f.plazo))}</p>\n` +
    `      <p>Todo se contrata y se paga en esta página, con Mercado Pago. Los plazos, límites y la cancelación están en los <a href="terminos.html#${f.terminos}">términos de este paquete</a>.</p>\n` +
    '      <!-- /servicio:hechos -->';
}

/* Las preguntas, y su esquema FAQPage EN EL MISMO BLOQUE: así no pueden decir
   cosas distintas, que es lo que Google penaliza. */
function bloquePreguntas(familia) {
  const f = FAMILIAS[familia];
  const lista = f.preguntas.map(([q, r]) => [q, rellena(r, familia)]);
  const html = lista.map(([q, r]) =>
    '        <details>\n' +
    `          <summary>${ent(q)}</summary>\n` +
    `          <p class="faq-r">${ent(r)}</p>\n` +
    '        </details>').join('\n');
  const esquema = {
    '@context': 'https://schema.org', '@type': 'FAQPage',
    mainEntity: lista.map(([q, r]) => ({
      '@type': 'Question', name: q,
      acceptedAnswer: { '@type': 'Answer', text: r },
    })),
  };
  return '<!-- servicio:preguntas -->\n' +
    '      <h2 id="preguntas">Preguntas frecuentes</h2>\n' +
    '      <div class="faq">\n' + html + '\n      </div>\n' +
    '      <script type="application/ld+json">' + JSON.stringify(esquema) + '</script>\n' +
    '      <!-- /servicio:preguntas -->';
}

/* El servicio y su oferta, para el buscador: nombre, qué es, quién lo da,
   dónde y a cuánto. El precio sale de la tabla, como todo. */
function bloqueEsquema(familia) {
  const f = FAMILIAS[familia];
  const propios = SERVICIOS.filter(x => x.familia === familia);
  const nodos = propios.map(s => ({
    '@type': 'Service',
    name: s.nombre,
    description: llano(s.resumen) + '.',
    serviceType: f.titulo,
    provider: { '@type': 'Organization', name: 'S&C Solutions', url: URL_SITIO },
    areaServed: { '@type': 'Country', name: 'México' },
    url: urlPagina(f),
    offers: {
      '@type': 'Offer', price: String(s.precio), priceCurrency: 'MXN',
      url: urlPagina(f), availability: 'https://schema.org/InStock',
    },
  }));
  return '<!-- servicio:esquema -->\n' +
    '<script type="application/ld+json">' +
    JSON.stringify({ '@context': 'https://schema.org', '@graph': nodos }) +
    '</script>\n<!-- /servicio:esquema -->';
}

/* Una página de cobro por familia, cada una con su propio bloque de opciones.
   Las cuatro comparten esqueleto y script; lo que cambia es qué paquetes
   caben dentro, y eso lo decide la familia. */
const PAGINAS_SERVICIO = Object.entries(FAMILIAS).map(([familia, f]) => ({
  familia,
  archivo: f.pagina,
  ruta: path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'app', f.pagina),
  bloques: [
    { nombre: `opciones de ${f.pagina}`,
      re: /<!-- servicio:opciones -->[\s\S]*?<!-- \/servicio:opciones -->/,
      pinta: () => bloqueServicio(familia) },
    { nombre: `hechos de ${f.pagina}`,
      re: /<!-- servicio:hechos -->[\s\S]*?<!-- \/servicio:hechos -->/,
      pinta: () => bloqueHechos(familia) },
    { nombre: `preguntas de ${f.pagina}`,
      re: /<!-- servicio:preguntas -->[\s\S]*?<!-- \/servicio:preguntas -->/,
      pinta: () => bloquePreguntas(familia) },
    { nombre: `esquema de ${f.pagina}`,
      re: /<!-- servicio:esquema -->[\s\S]*?<!-- \/servicio:esquema -->/,
      pinta: () => bloqueEsquema(familia) },
  ],
}));

function bloquePedido() {
  /* El precio SIN envío, igual que la ficha de la portada: este desplegable
     elige producto, no destino. Poner aquí el total con envío lo dejaría
     contradiciendo a la cabecera de arriba en cuanto el código postal decide
     que la entrega es en mano, y dos cifras distintas en la misma pantalla se
     leen como un error aunque las dos sean ciertas. */
  const ops = PAQUETES.map(p =>
    `<option value="${p.piezas}">${placas(p)} &#8212; $${miles(p.precio)}</option>`).join('');
  /* AQUÍ NO VAN EL «−» NI EL «+»: van en la portada, que es donde se ve el
     producto y donde nace la pregunta de cuántas quiero. Estuvieron aquí un
     rato y sobraban — a esta pantalla se llega con la cantidad ya elegida y
     puesta en `?n=`, y el desplegable es para corregirla, no para recorrerla de
     uno en uno. Es además lo que permite elegir sin JavaScript. */
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
   para que no pueda volver a pasar.

   Va SIN envío, igual que la cifra grande de la ficha. Las dos tienen que decir
   lo mismo: si el buscador anuncia $578 y quien entra lee $399, el que se
   equivocó parece el buscador, y Google penaliza justamente ese desfase. El
   envío es un dato de destino y su sitio en el esquema es `shippingDetails`,
   no `price`. */
function precioEsquema() {
  return '"price":"' + PAQUETES[0].precio + '"';
}

/* LA FICHA CORTA DE LA PORTADA — CON SU CONTADOR.
   El «−» y el «+» estuvieron aquí, se fueron a la página de pedido y vuelven:
   la cantidad se elige DONDE se ve el producto, que es donde nace la pregunta
   —cuánto me cuestan las que yo quiero—, y no un toque después.

   Lo que NO vuelve es la lista de los 25 tramos que había debajo. Ésa costaba
   tres pantallas de móvil para decir lo mismo que dice el contador moviéndolo,
   y quien necesite más de 25 tiene su enlace. La ficha sigue cabiendo en una
   pantalla.

   El botón se lleva la cantidad elegida en `?n=`, así que la página de pedido
   abre ya con ella puesta: elegir dos veces lo mismo es el fallo que separó
   estas dos pantallas en su día, y con el enlace parametrizado no ocurre.

   Todo esto se genera desde la tabla y no a mano, porque el fallo que este
   archivo existe para impedir —la web diciendo un precio y el cobro siendo
   otro— no depende de cuántas cifras se enseñen, sino de que salgan de aquí. */
/* El mensaje ya escrito para pedir más de lo que cubre la escalera. Es el
   mismo que lleva pedido.html; vive aquí para que la portada no tenga que
   repetirlo a mano. */
const WA_MAS = 'https://wa.me/524423697248?text=Hola.%20Vengo%20de%20la%20web%20y%20'
  + 'necesito%20m%C3%A1s%20de%2025%20placas%20de%20rese%C3%B1as%20de%20Google%20'
  + '%28NFC%20%2B%20QR%29.%20%C2%BFQu%C3%A9%20precio%20me%20pueden%20hacer%3F';

function bloqueCompra() {
  const una = PAQUETES[0];
  if (!una || una.piezas !== 1) throw new Error('la escalera no empieza en 1 placa');
  const max = PAQUETES[PAQUETES.length - 1].piezas;

  return '<!-- portada:compra -->\n' +
    '          <div class="prod-compra">\n' +
    /* ⚠ EL CONTADOR NACE ESCONDIDO Y LO ENSEÑA EL SCRIPT. Sin JavaScript, el
       «+» no sumaría, el campo aceptaría un número que nadie leería y el precio
       de al lado seguiría diciendo el de una placa: tres controles mintiendo a
       la vez. Escondido, la ficha dice lo que siempre dijo —una placa, $399, y
       el botón— y la cantidad se elige un toque después, en el desplegable de
       la página de pedido, que sí funciona sin script. */
    '            <p class="pc-rot" data-pc-solo-js hidden>' + ent('Cantidad') + '</p>\n' +
    '            <div class="pc-cab">\n' +
    '              <div class="pc-cant" data-pc-solo-js hidden>\n' +
    '                <button class="pc-b" type="button" data-pc="-1" aria-label="' +
    ent('Quitar una placa') + '">&#8722;</button>\n' +
    '                <input class="pc-n" type="number" inputmode="numeric" step="1"\n' +
    `                       min="1" max="${max}" value="1" data-pc-n\n` +
    '                       aria-label="' + ent('Cantidad de placas') + '">\n' +
    '                <span class="pc-w" data-pc-w>' + ent('placa') + '</span>\n' +
    '                <button class="pc-b" type="button" data-pc="1" aria-label="' +
    ent('Añadir una placa') + '">+</button>\n' +
    '              </div>\n' +
    '              <p class="pc-precio" aria-live="polite">' +
    '<span class="cifra" data-pc-total>$' + miles(una.precio) + '</span>' +
    '<span class="u">MXN</span></p>\n' +
    '            </div>\n' +
    '            <p class="pc-detalle" data-pc-detalle>' + ent(detalle(una)) + '</p>\n' +
    '            <p class="pc-gratis" data-pc-gratis hidden></p>\n' +
    '            <a class="svc-btn pc-ir" href="pedido.html?n=1" data-pc-ir>' +
    '<span class="dia"></span>' + ent('Ver precios y comprar') + '</a>\n' +
    /* La salida para quien necesita más de lo que hay en la escalera. Sin ella
       el «+» se apaga en el tope y no dice por qué, que en un móvil se lee como
       una web rota. Es el mismo enlace que ya vive en la página de pedido. */
    `            <p class="pc-mas"><a href="${WA_MAS}" target="_blank" rel="noopener noreferrer">` +
    ent(`¿Necesitas más de ${max}? Hablemos el precio`) + '</a></p>\n' +
    '            ' + tablaContador() + '\n' +
    '          </div>\n' +
    '          <!-- /portada:compra -->'
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
      /* Las mensualidades siguen la misma regla que las placas sueltas: dos
         cuotas desde CUOTAS_DESDE, que las financia el banco del comprador y
         al vendedor le cuestan cero. Nunca sobre un anticipo: un anticipo a
         plazos es un absurdo que además liaría el «resto». Hoy sólo cruzan el
         umbral los combos de «Todo hecho» — un ticket más alto que a la vez se
         vuelve más fácil de decir que sí. */
      /* `familia` viaja en la fila para que el Worker sepa a qué página de
         gracias devolver al comprador y qué preguntas hacerse en el resumen
         de la venta: la de la ficha de Google no tiene sentido en una web. */
      const fila = (id, base, total, resto) => ({
        id, tipo: 'servicio', familia: s.familia, piezas: 1, base, total, envio: 0,
        cuotas: (!resto && total >= CUOTAS_DESDE) ? 2 : 1,
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
      /* Y una fila por cada número de placas, contado y anticipo. Son filas
         de verdad y no un recargo que calcule el Worker: el importe NUNCA
         puede salir de una suma hecha en dos sitios distintos, y menos aún de
         lo que mande el navegador. ⚠ CON ANTICIPO, LAS PLACAS SE PAGAN HOY:
         el `total` de gp-ta2 es anticipo + placas y el `resto` queda igual —
         una placa es un objeto que se entrega, no un trabajo que retener. */
      if (s.placas) for (let n = 1; n <= PLACA_EN_PAQUETE.max; n++) {
        const extra = n * PLACA_EN_PAQUETE.precio;
        const apellido = ` + ${n} placa${n > 1 ? 's' : ''} de reseñas`;
        filas.push({ ...fila(s.id + n, s.nombre + apellido, s.precio + extra), placas: n });
        if (s.anticipo) filas.push({
          ...fila(s.id + 'a' + n, s.nombre + ' · anticipo' + apellido,
                  s.anticipo + extra, s.precio - s.anticipo),
          placas: n });
      }
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
function desdeServicio(familia) {
  /* ⚠ LOS DOS PRECIOS, NO UN «desde». «Desde $1,490» esconde el paquete de
     arriba justo donde se decide si vale la pena entrar: quien sólo puede pagar
     lo básico no sabe que existe algo más, y quien busca lo completo no sabe si
     su presupuesto alcanza. Enseñando los dos, la tarjeta responde la pregunta
     entera —cuánto cuesta y cuántas opciones hay— sin un toque de más.
     Salen ordenados de menor a mayor y de la misma tabla que el cobro. */
  const orden = SERVICIOS.filter(s => s.familia === familia).sort((a, b) => a.precio - b.precio);
  if (!orden.length) throw new Error(`desdeServicio: la familia «${familia}» no tiene paquetes`);
  const cifras = orden.map(x =>
    `<b>$${miles(x.precio)}</b> <i>${ent(x.corto || x.nombre)}</i>`).join('<em>o</em>');
  return `<span data-svc-desde="${familia}">${cifras}</span>`;
}

const BLOQUES = [
  { nombre: 'precio del esquema', re: /"price":"\d+"/, pinta: precioEsquema },
  /* ⚠ `[\s\S]*?` Y NO `[^<]*`. El patrón exigía que dentro del <span> no hubiera
     ni una etiqueta, y en cuanto el contenido pasó de «Desde $1,490» a dos
     cifras con su nombre en <b> y <i>, dejó de encontrarse a sí mismo: la
     segunda pasada del generador decía «esperaba 1 coincidencia y hay 0». Un
     patrón que describe el CONTENIDO se rompe al cambiar el contenido; éste
     describe sólo sus extremos, que es lo que este archivo controla. */
  /* Una tarjeta por familia en la portada, cada una con su cifra. El atributo
     lleva el nombre de la familia para que cada patrón encuentre la suya y
     sólo la suya. */
  ...Object.keys(FAMILIAS).map(f => ({
    nombre: `precio de «${f}» en la portada`,
    re: new RegExp(`<span data-svc-desde="${f}">[\\s\\S]*?</span>`),
    pinta: () => desdeServicio(f),
  })),
  /* ⚠ CON MARCAS Y NO CON UN `</a>` FINAL. El patrón anterior terminaba en el
     cierre del enlace, y al cambiar el marcado —el contador acaba en su tabla
     de datos, no en un enlace— dejó de encontrar su final y en la segunda pasada
     se llevó por delante el bloque de al lado, el «desde» del servicio. Las
     marcas las escribe este mismo archivo, así que el final no depende de cómo
     acabe el contenido. */
  { nombre: 'bloque de compra',
    re: /<!-- portada:compra -->[\s\S]*?<!-- \/portada:compra -->/,
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

/* Las páginas de cobro de los servicios, una por familia: las mismas opciones
   que el Worker tiene en su catálogo. Si se separan, la página enseña un
   precio y el cobro sale por otro — que es exactamente el fallo que este
   archivo entero existe para impedir. */
const paginasServicio = PAGINAS_SERVICIO.map(pg => {
  if (!fs.existsSync(pg.ruta)) {
    console.error(`\n  Falta app/${pg.archivo}: la familia «${pg.familia}» no tiene dónde cobrarse.\n`);
    process.exit(1);
  }
  const original = fs.readFileSync(pg.ruta, 'utf8');
  if (COBRO_EN_LINEA && !original.includes(`action="${COBRO_EN_LINEA}"`)) {
    console.error(`\n  ${pg.archivo} no manda el formulario a ${COBRO_EN_LINEA}.`);
    console.error('  Con la dirección mal, el botón de pagar no lleva a ninguna parte.\n');
    process.exit(1);
  }
  return { ...pg, original, generado: aplica(original, pg.bloques) };
});

/* Las dos guías del Worker enseñan la respuesta de /estado como ejemplo, y ahí
   dentro va el número de paquetes del catálogo. Ese número se quedó viejo una
   vez: las guías decían 11 cuando ya eran 43, y el titular vio 43 en su panel y
   creyó que algo se había roto. Un susto por una cifra copiada a mano.

   Así que se comprueba. No se reescribe sola —el resto de la frase es prosa y
   la escribe una persona—, pero si el catálogo crece y la guía no se entera,
   esto revienta y dice dónde. */
const GUIAS_WORKER = ['README.md', 'INSTALAR-SIN-TERMINAL.md'].map(archivo => ({
  archivo,
  ruta: path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'cloudflare', 'pagos', archivo),
}));
{
  const cuantos = JSON.parse(paquetesJson()).paquetes.length;
  for (const g of GUIAS_WORKER) {
    const texto = fs.readFileSync(g.ruta, 'utf8');
    const dicen = [...texto.matchAll(/"paquetes":(\d+)/g)].map(m => Number(m[1]));
    if (!dicen.length) {
      console.error(`\n  ${g.archivo} ya no enseña la respuesta de /estado.`);
      console.error('  Sin ese ejemplo, quien siga la guía no sabe si el Worker quedó bien.\n');
      process.exit(1);
    }
    const malas = dicen.filter(n => n !== cuantos);
    if (malas.length) {
      console.error(`\n  ${g.archivo} dice "paquetes":${malas[0]} y el catálogo tiene ${cuantos}.`);
      console.error('  Cambia esa cifra en la guía; quien la siga va a ver la del catálogo.\n');
      process.exit(1);
    }
  }
}

/* ---------------------------------------------------------- PARA LAS IAs

   app/llms.txt es una tarjeta de presentación en texto llano para los
   asistentes que buscan en la web —ChatGPT, Claude, Perplexity, Gemini— y
   para cualquier robot que prefiera hechos a maquetación. Sigue la convención
   llms.txt: un H1 con el nombre, una cita con el resumen, secciones cortas.

   ⚠ SE GENERA DESDE AQUÍ Y NO SE ESCRIBE A MANO, por la misma razón que todo
   lo demás en este archivo: un precio escrito a mano en un archivo que nadie
   abre es el que se queda viejo. El día que suba un paquete, este texto sube
   con él y `--check` se queja si alguien lo tocó por su cuenta.

   Lo que dice es SÓLO lo que ya dice la web: los mismos paquetes, las mismas
   listas de «qué incluye», los mismos plazos y condiciones. Nada que no esté
   en las tarjetas o en los términos, porque una IA lo va a citar tal cual. */
const LLMS = path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'app', 'llms.txt');

function paraLlms() {
  const pesos = n => '$' + miles(n);
  /* Los asteriscos son el subrayado de las tarjetas (ver resalta()); aquí no
     hay negrita que pintar y sólo estorbarían a quien lo lea. */
  const llano = t => String(t).replace(/\*/g, '');
  const punto = x => typeof x === 'string'
    ? llano(x)
    : `${llano(x.texto)} (sólo si tu ficha de Google ya existe)`;
  const TITULO = {
    google: 'Perfil de Empresa en Google (ficha de Google Maps)',
    web: 'Sitio web',
    ia: 'Atención al cliente por WhatsApp con IA',
    auto: 'Automatización de tareas',
  };
  const L = [];
  L.push('# S&C Solutions');
  L.push('');
  L.push('> Hacemos sitios web, dejamos funcionando el perfil de Google de tu negocio, '
    + 'ponemos un agente de WhatsApp con inteligencia artificial y automatizamos tareas '
    + 'que hoy se hacen a mano. Precio cerrado, pago en línea con Mercado Pago. '
    + 'Estamos en San Luis Potosí, México, y trabajamos a distancia para todo el país.');
  L.push('');
  L.push('- Sitio: https://sycsolutions.company/');
  L.push('- Ciudad: San Luis Potosí, S.L.P., México');
  L.push('- Cobertura: todo México a distancia; en ' + ENTREGA_LOCAL_NOMBRE + ' también en persona');
  L.push('- WhatsApp: +52 442 369 7248');
  L.push('- Correo: hola@sycsolutions.company');
  L.push('- Idioma: español');
  L.push('- Moneda de todos los precios: pesos mexicanos (MXN)');
  L.push('');
  L.push('## Servicios y precios');
  L.push('');
  for (const familia of Object.keys(FAMILIAS)) {
    const propios = SERVICIOS.filter(x => x.familia === familia);
    L.push('### ' + TITULO[familia]);
    L.push('');
    for (const sv of propios) {
      const corto = sv.corto || sv.nombre;
      let linea = `**${sv.nombre}** — ${pesos(sv.precio)} MXN`;
      if (sv.mensual) linea += ` y, a partir del segundo mes, ${pesos(sv.mensual)} MXN al mes`;
      L.push(linea);
      L.push('');
      L.push(llano(sv.resumen) + '.');
      if (sv.anticipo) L.push(`Se puede pagar de contado o con ${pesos(sv.anticipo)} MXN de anticipo `
        + `y ${pesos(sv.precio - sv.anticipo)} MXN al entregar ${FAMILIAS[familia].entrega}.`);
      L.push('');
      L.push('Incluye:');
      for (const x of sv.incluye || []) L.push('- ' + punto(x));
      if (sv.hereda) {
        const otro = SERVICIOS.find(x => x.id === sv.hereda);
        if (otro) L.push(`- Y todo lo del paquete «${otro.corto || otro.nombre}»`);
      }
      if (sv.nota) { L.push(''); L.push('Condición: ' + llano(sv.nota)); }
      L.push('');
    }
  }
  const uno = PAQUETES[0], desde = desdeGratis();
  L.push('### Placa de reseñas para Google (NFC + QR)');
  L.push('');
  L.push('Una placa rígida para el mostrador: el cliente acerca el teléfono o escanea el '
    + 'código y le abre directamente la pantalla para dejar reseña en Google. No hay que '
    + 'instalar nada. Dura de 5 a 10 años.');
  L.push('');
  L.push(`- 1 placa: ${pesos(uno.precio)} MXN` + (uno.envio > 0 ? ` más ${pesos(uno.envio)} MXN de envío` : ''));
  for (const p of PAQUETES.slice(1, 5))
    L.push(`- ${p.piezas} placas: ${pesos(p.precio)} MXN` + (gratis(p) ? ' con envío gratis' : ''));
  const ultima = PAQUETES[PAQUETES.length - 1];
  L.push(`- Hasta ${ultima.piezas} placas en línea (${pesos(ultima.precio)} MXN las ${ultima.piezas}); más de ${ultima.piezas}, por WhatsApp`);
  if (desde !== null) L.push(`- El envío es gratis a partir de ${desde} placas, a cualquier parte de México`);
  L.push(`- En ${ENTREGA_LOCAL_NOMBRE} no se cobra envío: se entrega e instala en persona`);
  L.push(`- Dentro de los paquetes de perfil de Google, cada placa cuesta ${pesos(PLACA_EN_PAQUETE.precio)} MXN (hasta ${PLACA_EN_PAQUETE.max})`);
  L.push('');
  L.push('## Cómo se contrata');
  L.push('');
  /* Sin lista de métodos: los que aparezcan los decide la cuenta de Mercado
     Pago en el momento del cobro, y prometer aquí uno que ese día no esté es
     la clase de frase que una IA repite con toda seguridad. */
  L.push('- Todo se contrata y se paga en línea, en el sitio, con Mercado Pago.');
  L.push('- Los precios son cerrados: lo que dice la página es lo que se cobra.');
  L.push('- Revisión gratuita de tu página web: https://sycsolutions.company/#diagnostico');
  L.push('- Contacto: https://sycsolutions.company/#contacto');
  L.push('');
  L.push('## Páginas');
  L.push('');
  L.push('- [Portada](https://sycsolutions.company/): servicios, la placa, clientes, preguntas frecuentes y contacto');
  for (const f of Object.values(FAMILIAS))
    L.push(`- [${f.titulo}](${urlPagina(f)}): qué es, qué incluye, precio, plazo, preguntas frecuentes y contratación`);
  L.push('- [Términos y condiciones](https://sycsolutions.company/terminos): alcance, plazos y condiciones de cada paquete');
  L.push('- [Aviso de privacidad](https://sycsolutions.company/aviso-de-privacidad)');
  L.push('');
  return L.join('\n') + '\n';
}

const llmsEsperado = paraLlms();
const llmsActual = fs.existsSync(LLMS) ? fs.readFileSync(LLMS, 'utf8') : null;

const pegarEsperado = paraPegar();
const pegarActual = fs.existsSync(JS_PEGAR) ? fs.readFileSync(JS_PEGAR, 'utf8') : null;

if (args.includes('--check')) {
  if (llmsActual !== llmsEsperado) {
    console.error('\n  app/llms.txt no coincide con tools/precios.mjs.');
    console.error('  Las IAs citarían precios o condiciones que la web ya no dice.');
    console.error('  Arréglalo con:  node tools/precios.mjs\n');
    process.exit(1);
  }
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
  for (const pg of paginasServicio) if (pg.original !== pg.generado) {
    console.error(`\n  Los paquetes de app/${pg.archivo} no coinciden con la tabla.`);
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

if (llmsActual !== llmsEsperado) {
  fs.writeFileSync(LLMS, llmsEsperado);
  console.log('Reescrita la tarjeta para las IAs (app/llms.txt).');
}

if (pegarActual !== pegarEsperado) {
  fs.writeFileSync(JS_PEGAR, pegarEsperado);
  console.log('Reescrito el Worker de un solo archivo (cloudflare/pagos/pagos-para-pegar.js).');
}

if (pedidoOriginal !== pedidoGenerado) {
  fs.writeFileSync(PEDIDO, pedidoGenerado);
  console.log('Reescritas las cantidades de app/pedido.html.');
}

for (const pg of paginasServicio) if (pg.original !== pg.generado) {
  fs.writeFileSync(pg.ruta, pg.generado);
  console.log(`Reescritos los paquetes de app/${pg.archivo}.`);
}

if (original === generado) {
  console.log('Sin cambios: el HTML ya coincide con la tabla.');
} else {
  fs.writeFileSync(HTML, generado);
  console.log('Reescrito app/index.html desde la tabla de precios.');
  console.log('Recuerda:  node tools/csp-hashes.mjs --check');
}
