/* ============================================================================
   S&C SOLUTIONS — WORKER DE COBROS (Checkout Pro de Mercado Pago)

   Para qué está: los enlaces de pago del panel de Mercado Pago NO dejan quitar
   las mensualidades. Están bloqueadas después de crear el enlace, la casilla de
   tarjetas no separa crédito de débito, y la fila de «Cuotas sin Tarjeta» es
   obligatoria. La única forma de cobrar en una sola exhibición es crear el
   cobro por API, que es lo que hace este archivo:

       payment_methods.installments = 1     ← el máximo de cuotas es una

   De regalo, y es la mitad del motivo para tenerlo: se acabó crear enlaces a
   mano. Un enlace por paquete eran once creaciones en el móvil, y otras once
   cada vez que cambiara un precio. Aquí el cobro se genera al vuelo desde la
   misma tabla que pinta la web.

   ── LA REGLA QUE NO SE PUEDE ROMPER ────────────────────────────────────────
   EL IMPORTE LO PONE ESTE ARCHIVO, NUNCA EL NAVEGADOR. El formulario manda
   solamente QUÉ paquete se quiere («1», «20»…); el precio sale de paquetes.json.
   Si el importe viajara en el formulario, cualquiera abriría las herramientas
   del navegador, cambiaría 3399 por 1 y pagaría un peso por veinte placas. Es
   el fallo clásico de las pasarelas mal montadas y aquí es imposible por
   construcción: no hay ninguna ruta por la que un número del cliente llegue a
   unit_price.

   ── POR QUÉ ES UN WORKER APARTE ────────────────────────────────────────────
   El del diagnóstico hace peticiones a direcciones que elige quien llama. Meter
   el token de cobros en ese mismo aislado significaría que cualquier fallo que
   permitiera leer el entorno allí entregaría también la llave del dinero. Son
   dos riesgos distintos y viven separados.

   ── SIN JAVASCRIPT ─────────────────────────────────────────────────────────
   El botón de la web es un <form method="post"> normal. Este Worker responde
   con una redirección al checkout. Ni fetch, ni CORS, ni una huella más en la
   CSP, y funciona con el JavaScript desactivado. Si algo falla, en vez de
   dejar al visitante en una pantalla de error se le devuelve una página con el
   enlace de WhatsApp: un cobro roto no puede terminar en un callejón.
   ========================================================================= */

/* Con atributo de importación: es el estándar y lo entienden tanto Node —que
   es donde corren las pruebas— como el empaquetador de wrangler. Sin él, Node
   se niega a importar un JSON y las pruebas no podrían ni cargar el archivo. */
import TABLA from './paquetes.json' with { type: 'json' };

/* El sitio que puede enviar el formulario. Cualquier otro origen se rechaza:
   no impide que alguien haga un POST con curl —eso no lo impide nadie—, pero
   sí que una página ajena monte un formulario que cobre en tu nombre. */
const ORIGEN = 'https://sycsolutions.company';
const ORIGENES_OK = new Set([
  ORIGEN,
  'https://www.sycsolutions.company',
  'https://syc-solutions.pages.dev',
]);

const WHATSAPP = '524423697248';

/* Tope por IP y ventana. No es una barrera contra el fraude —para eso está que
   el importe no venga del cliente— sino contra el bucle: alguien pulsando cien
   veces crearía cien preferencias y cien llamadas a la API de Mercado Pago.

   ⚠ EL NÚMERO TIENE QUE SER MAYOR QUE LA CANTIDAD DE BOTONES DE LA PÁGINA.
   Estuvo en 12 con ONCE paquetes en pantalla, y eso lo tropezó el propio
   titular a los cinco minutos de publicarlo: mirar casi todos los precios ya
   agotaba el cupo y el comprador se topaba con «demasiados intentos» sin haber
   hecho nada raro. Treinta deja recorrer la lista entera dos veces largas y
   sigue cortando un script en seco. */
const TOPE_VENTANA = 30;
const VENTANA_MS = 60000;

/* ------------------------------------------------------------------ APOYOS */

const paquete = id => TABLA.paquetes.find(p => p.id === String(id));

function pesos(n) {
  return '$' + n.toLocaleString('en-US');
}

/* Página de salida cuando algo va mal. Dice qué pasó en una línea y ofrece el
   camino que sigue funcionando siempre: escribir por WhatsApp. Sin estilos
   externos ni scripts, para que se sirva igual con la CSP más estricta. */
function pagina(mensaje, p, estado = 502) {
  const texto = p
    ? `Hola. Intenté pagar en línea ${p.titulo} (${pesos(p.total)} MXN) y el cobro no se abrió.`
    : 'Hola. Intenté pagar en línea desde la web y el cobro no se abrió.';
  const wa = `https://wa.me/${WHATSAPP}?text=${encodeURIComponent(texto)}`;
  return new Response(
    '<!doctype html><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1">' +
    '<meta name="robots" content="noindex">' +
    '<title>No se pudo abrir el pago</title>' +
    '<body style="background:#0A0B0E;color:#F4F1EA;font:300 16px/1.7 system-ui,sans-serif;' +
    'margin:0;min-height:100vh;display:flex;align-items:center;justify-content:center;' +
    'text-align:center;padding:24px">' +
    '<main style="max-width:34rem">' +
    '<h1 style="font-weight:400;font-size:22px;margin:0 0 12px">No se pudo abrir el pago</h1>' +
    '<p style="color:#9A9A93;margin:0 0 26px">' + mensaje + '</p>' +
    '<p><a href="' + wa + '" style="display:inline-block;padding:14px 26px;' +
    'background:#C8A96A;color:#0A0B0E;text-decoration:none;letter-spacing:2px;' +
    'text-transform:uppercase;font-size:12px">Escríbenos por WhatsApp</a></p>' +
    '<p style="margin-top:26px"><a href="' + ORIGEN + '" style="color:#9A9A93;font-size:13px">' +
    'Volver a la web</a></p></main>',
    { status: estado, headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' } }
  );
}

/* Contador por IP sobre la Cache API. No es atómico —dos peticiones a la vez
   pueden leer el mismo valor—, y aquí es suficiente: lo que acota es el
   martilleo sostenido, no una ráfaga simultánea de dos. El limitador atómico
   del otro Worker existe porque allí cada petición cuesta subpeticiones a
   sitios ajenos; aquí cuesta una llamada a Mercado Pago. */
async function dentroDelTope(ip) {
  try {
    const clave = new Request('https://limite.interno/pagos/' + encodeURIComponent(ip));
    const cache = caches.default;
    const ahora = Date.now();
    let n = 0, inicio = ahora;

    const previo = await cache.match(clave);
    if (previo) {
      const d = await previo.json().catch(() => null);
      /* Sólo se arrastra la cuenta si la ventana SIGUE viva. Antes no se
         guardaba cuándo empezó y el reloj era el max-age de la caché, que cada
         `put` renovaba: la cuenta no se reiniciaba a los 60 s sino 60 s después
         del ÚLTIMO toque. Es decir, no era un tope por minuto sino por sesión
         de clics, y recorrer la lista despacio chocaba igual. Ahora la ventana
         la marca su propia hora de inicio y vence sola. */
      if (d && typeof d.inicio === 'number' && ahora - d.inicio < VENTANA_MS) {
        n = d.n;
        inicio = d.inicio;
      }
    }

    if (n >= TOPE_VENTANA) return false;
    /* max-age holgado a propósito: quien caduca la ventana es la marca de
       tiempo de dentro, no la caché. Si la entrada desapareciera antes, la
       cuenta se reiniciaría sola, que es el lado seguro para el comprador. */
    await cache.put(clave, new Response(JSON.stringify({ n: n + 1, inicio }), {
      headers: { 'Cache-Control': 'max-age=180', 'Content-Type': 'application/json' },
    }));
    return true;
  } catch (_) {
    /* Falla ABIERTO a propósito: quedarse sin caché no puede dejar sin cobrar.
       La barrera que de verdad importa —el precio del servidor— sigue en pie. */
    return true;
  }
}

/* --------------------------------------------------------------- EL COBRO */

async function creaPreferencia(p, env, origen) {
  const cuerpo = {
    items: [{
      id: 'placa-resenas-' + p.id,
      title: p.titulo,
      quantity: 1,
      unit_price: p.total,            /* ← de la tabla, jamás del navegador */
      currency_id: TABLA.moneda,
    }],
    /* EL CAMPO POR EL QUE EXISTE TODO ESTO. `installments` es el número MÁXIMO
       de cuotas que se ofrecen; con 1, el checkout sólo puede cobrar en una
       sola exhibición. Es lo que el panel de enlaces no deja tocar. */
    payment_methods: {
      installments: 1,
      default_installments: 1,
    },
    back_urls: {
      success: origen + '/?pago=listo',
      pending: origen + '/?pago=pendiente',
      failure: origen + '/?pago=cancelado',
    },
    auto_return: 'approved',
    /* Lo que el comprador ve en el estado de cuenta de su tarjeta. Sin esto
       aparece un nombre que no reconoce y acaba en una contracargo. */
    statement_descriptor: 'SYC SOLUTIONS',
    /* Para reconocer el cobro en el aviso sin tener que deducirlo del importe. */
    external_reference: 'paquete-' + p.id,
    binary_mode: true,
  };

  const r = await fetch('https://api.mercadopago.com/checkout/preferences', {
    method: 'POST',
    headers: {
      'Authorization': 'Bearer ' + env.MP_ACCESS_TOKEN,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(cuerpo),
    signal: AbortSignal.timeout(10000),
  });

  if (!r.ok) {
    /* El cuerpo del error de Mercado Pago NO se le enseña al visitante: puede
       traer detalles de la cuenta. Va al log, que es donde sirve. */
    console.log('mp-error', r.status, (await r.text()).slice(0, 400));
    return null;
  }
  const d = await r.json();
  return d && typeof d.init_point === 'string' ? d.init_point : null;
}

/* ------------------------------------------------------------------ RUTAS */

export default {
  async fetch(peticion, env) {
    const url = new URL(peticion.url);

    /* Prueba de vida. Dice si el secreto está puesto SIN revelar nada de él:
       sólo si existe. Sirve para comprobar un despliegue de un vistazo. */
    if (url.pathname === '/estado') {
      return Response.json({
        ok: true,
        secreto: Boolean(env.MP_ACCESS_TOKEN),
        paquetes: TABLA.paquetes.length,
      }, { headers: { 'Cache-Control': 'no-store' } });
    }

    if (url.pathname !== '/ir') {
      return new Response('No encontrado', { status: 404 });
    }
    if (peticion.method !== 'POST') {
      /* 405 y no 404: quien llegue aquí de una redirección o pegando la
         dirección en la barra debe entender que esto no se visita, se envía. */
      return pagina('Esta dirección no se abre directamente: el pago se inicia desde el botón de la web.', null, 405);
    }

    if (!env.MP_ACCESS_TOKEN) {
      console.log('sin-secreto');
      return pagina('El cobro en línea no está configurado todavía.', null, 503);
    }

    /* El origen del formulario. Un POST desde otra web no cobra en tu nombre. */
    const origen = peticion.headers.get('Origin');
    if (origen && !ORIGENES_OK.has(origen)) {
      console.log('origen-ajeno', origen.slice(0, 80));
      return pagina('El pago debe iniciarse desde la web de S&C Solutions.', null, 403);
    }

    const ip = peticion.headers.get('CF-Connecting-IP') || 'sin-ip';
    if (!(await dentroDelTope(ip))) {
      return pagina('Demasiados intentos seguidos. Espera un minuto y vuelve a probarlo.', null, 429);
    }

    let id = null;
    try {
      const form = await peticion.formData();
      id = String(form.get('paquete') || '').slice(0, 8);
    } catch (_) {
      return pagina('No se entendió la petición.', null, 400);
    }

    const p = paquete(id);
    if (!p) {
      console.log('paquete-desconocido', id.slice(0, 8));
      return pagina('Ese paquete no existe.', null, 404);
    }

    const destino = await creaPreferencia(p, env, ORIGEN);
    if (!destino) {
      return pagina('Mercado Pago no respondió. No se te ha cobrado nada.', p);
    }

    return new Response(null, {
      status: 303,                    /* 303 y no 302: tras un POST, el destino se abre con GET */
      headers: { 'Location': destino, 'Cache-Control': 'no-store' },
    });
  },
};
