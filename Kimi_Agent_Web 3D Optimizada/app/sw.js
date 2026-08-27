/* ============================================================================
   S&C SOLUTIONS — SERVICE WORKER

   Para qué está: que la web abra entera con la red caída. No es un truco de
   demostración; es la prueba física de lo que se vende dos secciones más
   arriba. Un visitante en el metro, en una obra o con datos agotados sigue
   viendo el sitio completo.

   Las dos decisiones que gobiernan todo el archivo:

   1. El HTML va SIEMPRE a la red primero. Servir un documento cacheado sería
      rápido y sería mentira: el visitante vería la versión de la semana pasada
      sin manera de saberlo. La caché del documento es la red de emergencia,
      no la ruta normal.
   2. Los recursos con nombre estable —imágenes, tipografías— van a la caché
      primero, porque si cambian se cambia su nombre.

   Lo que NUNCA se toca: el Worker del diagnóstico. Ese responde un análisis
   distinto para cada dirección y con una fecha concreta; guardarlo en caché
   devolvería el informe de otra web, que es exactamente el peor fallo posible
   en la única herramienta de la página. Se deja pasar sin interceptar.

   Al subir una versión nueva basta con cambiar VERSION: el activate borra
   cualquier caché que no sea la de este número.
   ========================================================================= */

/* Se sube en cada publicación que cambie el HTML. El activate borra cualquier
   caché que no sea de este número, así que la copia vieja no sobrevive.
     · -d  el formulario de contacto conectado al gateway.
     · -e  la clave de Turnstile CORRECTA para ese gateway. Aquí subirla no es
           higiene: la copia guardada lleva incrustada la clave equivocada, y
           quien la conserve seguiría enviando tokens que el gateway rechaza con
           un 403 aunque el sitio publicado ya esté arreglado.
     · -f  fuera el CRM y fuera el precargador.
           Nota honesta sobre esta subida: HOY no cambia nada para nadie, porque
           este archivo NO está registrado —index.html da de baja cualquier
           copia instalada y le vacía las cachés; ver el bloque «FUNCIONAR SIN
           CONEXIÓN: APAGADO MIENTRAS SE CONSTRUYE» al final del HTML—. Se sube
           igual, y por dos motivos: el contrato de este archivo dice que la
           versión sube en toda publicación que cambie el HTML, y el día que se
           vuelva a encender el registro, una caché con número viejo serviría
           como copia de emergencia sin red un documento con el precargador
           dentro. Subirla ahora cuesta un carácter; olvidarla entonces cuesta
           un fallo que nadie sabrá explicar.
     · -r  el precio de la placa de reseñas pasa de $389 a $499 y se añade la
           tabla de precios por mayoreo. Vale aquí lo dicho en -f —el archivo
           sigue sin registrarse—, con un motivo más: de todo lo que este
           documento guarda, un precio es lo peor que puede servirse caducado.
           Una copia vieja enseñaría $389 a alguien que ya no puede comprarlo
           por ese dinero.
     · -s  precios nuevos: la placa pasa a $429 y la lista de mayoreo deja de ser
           por unidad para ser por paquete, con el envío como tercer dato. Vale
           lo dicho en -r y con más razón: una copia caducada no enseñaría un
           precio viejo sino un MODELO de precio viejo —«$469 c/u»—, y quien
           multiplicara por seis pediría un paquete que ya no existe.
     · -t  correcciones de la auditoría de seguridad: textos legales exactos
           (precios, transferencia de IP al sitio analizado, caché de una hora) y
           política de cookies con las cuatro claves reales en vez de dos. Aquí
           la copia caducada no enseñaría un precio viejo sino un AVISO LEGAL
           viejo, que es lo único de este sitio que puede acabar en una queja.
     · -u  fuera la sección «Sobre nosotros» entera y el diagnóstico compactado.
           Aquí la copia caducada no enseñaría un dato viejo sino una PÁGINA que
           ya no existe: una sección retirada, un riel con seis tramos donde hay
           cinco y enlaces a un ancla muerta.
     · -w  el envío deja de ser una tarifa plana de $149 y pasa a bajar con la
           cantidad: $79 una pieza, $69 dos, $59 tres y gratis desde cuatro.
           De todo lo que este archivo guarda, esto es de lo peor que puede
           servirse caducado: una copia vieja cobraría $149 de envío a quien la
           web ya no se los cobra, y anunciaría el envío gratis a partir de diez
           cuando empieza en cuatro.
     · -v  el bloque de datos de contacto, reordenado, y fuera la frase que
           precedía al botón del mejor proyecto. Aquí lo que caducaría son los
           DATOS DE CONTACTO: correo, WhatsApp, horario y base. Es lo último de
           esta página que conviene servir de una copia vieja, porque es por
           donde entra el trabajo. */
const VERSION = 'syc-2026-08-w';
const DOC     = VERSION + '-doc';
const ESTATICO= VERSION + '-est';

/* El mínimo imprescindible para que la página abra sin red. No se precargan
   los fondos pesados: entran solos cuando el visitante los ve, y así la
   primera visita no paga por ellos. */
const BASE = [
  './',
  './index.html',
  './404.html',
  './assets/logo.svg',
  './aviso-de-privacidad.html',
  './terminos.html',
  './cookies.html',
  './assets/legal.css'
];

self.addEventListener('install', e => {
  /* Cada archivo se guarda por separado y con su propio catch: con addAll, un
     solo recurso que faltara tumbaba la instalación entera y el sitio se
     quedaba sin funcionamiento sin conexión sin decir por qué. */
  e.waitUntil((async () => {
    const c = await caches.open(ESTATICO);
    await Promise.all(BASE.map(u => c.add(u).catch(() => {})));
  })());
  /* Sin skipWaiting a propósito: la versión nueva toma el mando en la próxima
     visita. Cambiar los recursos por debajo de una pestaña que ya está abierta
     mezcla dos versiones del sitio en la misma pantalla. */
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const viejas = (await caches.keys()).filter(k => !k.startsWith(VERSION));
    await Promise.all(viejas.map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

/* Guardar sin romper: si la caché está llena o el navegador la ha desalojado,
   el visitante no tiene por qué enterarse. */
async function guarda(nombre, pedido, respuesta) {
  try {
    const c = await caches.open(nombre);
    await c.put(pedido, respuesta);
  } catch (_) {}
}

self.addEventListener('fetch', e => {
  const req = e.request;

  /* Sólo lecturas. Un POST no se cachea nunca y además puede ser un envío. */
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  const propio = url.origin === self.location.origin;
  const tipografia = /^https:\/\/fonts\.(googleapis|gstatic)\.com$/.test(url.origin);

  /* Todo lo demás ajeno —empezando por el Worker del diagnóstico— pasa de
     largo sin que este archivo intervenga. */
  if (!propio && !tipografia) return;

  /* ---- Documentos: red primero ----
     La clave se normaliza a origen + ruta, sin fragmento ni parámetros: si no,
     entrar por "/#contacto" y por "/?aud=x" guardaba tres copias del mismo
     documento y ninguna respondía a las otras al quedarse sin red. */
  if (req.mode === 'navigate') {
    const clave = url.origin + url.pathname;
    e.respondWith((async () => {
      try {
        /* no-cache, y no el fetch normal: el navegador tiene su propia caché
           HTTP por debajo de este archivo, y con ella "ir a la red" devolvía
           igualmente el documento guardado. Así se obliga a revalidar contra el
           servidor —una petición condicional, barata— y el visitante nunca ve
           una versión vieja mientras haya conexión. */
        const r = await fetch(req, { cache: 'no-cache' });
        /* Sólo se guarda una respuesta buena: cachear un 404 o un 500 dejaría
           el error congelado para las siguientes visitas sin red. */
        if (r && r.ok) guarda(DOC, clave, r.clone());
        return r;
      } catch (_) {
        return (await caches.match(clave)) ||
               (await caches.match('./index.html')) ||
               (await caches.match('./')) ||
               new Response(
                 '<!doctype html><meta charset="utf-8">' +
                 '<title>Sin conexión</title>' +
                 '<body style="background:#0A0B0E;color:#F4F1EA;font:300 16px system-ui;' +
                 'display:flex;align-items:center;justify-content:center;height:100vh;' +
                 'margin:0;text-align:center;padding:24px">' +
                 '<p>Sin conexión. Vuelve a intentarlo cuando tengas red.</p>',
                 { headers: { 'Content-Type': 'text/html; charset=utf-8' } }
               );
      }
    })());
    return;
  }

  /* ---- Recursos: caché primero ----
     Con una excepción: los documentos. Un .html pedido sin ser una navegación
     —por fetch, o al precargarlo— seguía la ruta de caché primero y devolvía la
     copia guardada. Cualquier cosa que sea documento pasa por la misma regla de
     red primero que las navegaciones: el contenido no se sirve viejo nunca. */
  const esDocumento = req.destination === 'document' || /\.html?$/i.test(url.pathname);
  if (esDocumento) {
    e.respondWith((async () => {
      try {
        const r = await fetch(req, { cache: 'no-cache' });
        if (r && r.ok) guarda(DOC, url.origin + url.pathname, r.clone());
        return r;
      } catch (_) {
        return (await caches.match(url.origin + url.pathname)) ||
               new Response('', { status: 504, statusText: 'Sin conexión' });
      }
    })());
    return;
  }

  e.respondWith((async () => {
    const guardado = await caches.match(req);
    if (guardado) return guardado;
    try {
      const r = await fetch(req);
      /* Las tipografías de Google responden en modo opaco: no se puede leer si
         fueron bien, pero guardarlas es justo lo que evita que el sitio pierda
         su letra al quedarse sin red. Lo demás sólo se guarda si respondió bien. */
      if (r && (r.ok || r.type === 'opaque')) guarda(ESTATICO, req, r.clone());
      return r;
    } catch (_) {
      /* Sin red y sin copia: se devuelve un fallo silencioso en vez de una
         excepción, para que una imagen que falta no rompa la página entera. */
      return new Response('', { status: 504, statusText: 'Sin conexión' });
    }
  })());
});
