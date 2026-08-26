/**
 * Diagnóstico SEO — Worker de Cloudflare
 *
 * Lee la página pública que le indiquen y devuelve una nota de 0 a 100 con los
 * hallazgos concretos. Existe porque el navegador no puede leer otro dominio:
 * la política de origen cruzado lo impide, así que cualquier auditor que se
 * anuncie como "100% en el navegador" o miente o no analiza nada.
 *
 * Despliegue:  npx wrangler deploy
 * La URL resultante se pega en la constante AUDITOR de app/index.html.
 */

/* Orígenes que pueden llamar al Worker.
   AVISO IMPORTANTE, porque el comentario anterior afirmaba lo contrario: CORS
   NO es control de acceso. Solo impide que un navegador de otro origen LEA la
   respuesta; curl, un script de servidor o un bot la obtienen igual. Quien
   protege de verdad el gasto de la cuenta es el limitador de tasa de más abajo,
   no esta lista. */
const ORIGENES = [
  /* El sitio en su dominio propio. `www` redirige aquí con 301, pero se deja
     listado: la redirección la sigue el navegador ANTES de la petición al
     Worker en la navegación normal, aunque un enlace directo con www podría
     llegar todavía con ese Origin. */
  'https://sycsolutions.company',
  'https://www.sycsolutions.company',
  /* Se conserva porque el sitio SIGUE publicándose en este proyecto de Pages y
     su dominio por defecto continúa activo y sirviendo la misma web: quitarlo
     rompería el diagnóstico para quien llegue por ahí, sin ganar nada. Es
     además la dirección donde se comprueba un despliegue antes de que el
     dominio propio propague.
     Las URLs de previsualización con hash NO están aquí a propósito: cambian
     en cada `wrangler pages deploy` y no pueden fijarse de antemano. */
  'https://syc-solutions.pages.dev'
];

/* Solo en desarrollo. Tener localhost en la lista de producción deja que
   cualquier página servida en el equipo de un visitante lea el Worker desde su
   navegador: superficie que no pinta nada en producción.
   Uso local:  npx wrangler dev --var ENTORNO:dev */
const ORIGENES_DEV = ['http://localhost:8080', 'http://127.0.0.1:8080'];

const LIMITE_BYTES = 1_500_000;   /* deja de leer al superar millón y medio */
const ESPERA_MS    = 12_000;      /* un sitio que tarda más ya suspende solo */
const ESPERA_AUX_MS = 5_000;      /* presupuesto propio de robots.txt/sitemap */
const SALTOS_MAX   = 3;           /* redirecciones que seguimos a mano */
const CACHE_OK_S   = 3600;        /* informes correctos: una hora */
const CACHE_ERR_S  = 300;         /* errores: cinco minutos, ver nota abajo */

const VENTANA_MS = 60_000;        /* ventana del limitador atómico */

/* Única ruta que ejecuta el análisis. Tiene que coincidir con la que llama el
   frontend (`window.SYC_AUDITOR` + '?url=' en app/index.html). Todo lo demás
   responde 404 sin mirar siquiera el parámetro. */
const RUTA_DIAGNOSTICO = '/';

/* ---------- Turnstile ---------- */

const TURNSTILE_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/* El token viaja en cabecera, NUNCA en la URL: en la query acabaría en los logs
   de acceso, en la cabecera Referer y en la clave de caché. */
const TURNSTILE_CABECERA = 'X-Turnstile-Token';

/* 2048 es el máximo documentado por Cloudflare ("Maximum length: 2048
   characters"), y su propio ejemplo canónico rechaza por encima de ahí antes de
   llamar a siteverify. Se usa igual: un token que no puede ser válido no merece
   gastar una subpetición de red. */
const TURNSTILE_MAX = 2048;
/* Techo del parámetro `url`. Ver el uso, en la puerta de entrada. */
const MAX_LARGO_URL = 2048;

const TURNSTILE_ACCION = 'diagnostico-seo';
const TURNSTILE_ESPERA_MS = 5_000;

/* Claves de prueba públicas de Cloudflare, documentadas en la página "Testing".
   Se reconocen aquí por una razón concreta: con ellas siteverify NO devuelve el
   campo `action`, así que exigirlo haría imposible probar el camino feliz sin un
   navegador. Detectarlas permite relajar ESA comprobación sólo en desarrollo,
   sin tocar el camino de producción. Y sirve de red: una clave de prueba en
   producción se rechaza en vez de convertir Turnstile en un adorno. */
const TURNSTILE_SECRETOS_DE_PRUEBA = new Set([
  '1x0000000000000000000000000000000AA',   /* siempre pasa */
  '2x0000000000000000000000000000000AA',   /* siempre falla */
  '3x0000000000000000000000000000000AA'    /* token ya gastado */
]);

/* Presupuesto para la consulta al Durable Object. Existe porque el modo de
   fallo dominante de un Durable Object no es el error, es la LENTITUD: cuando
   un objeto está saturado el runtime encola las peticiones antes de devolver
   error, y durante todo ese rato no hay ninguna excepción que capturar.
   Superarlo NO abre: falla cerrado, así que quedarse corto no es un agujero,
   es indisponibilidad. Por eso el valor se elige por arriba.

   Medido en local (test/medir.mjs): el limitador tarda 7 ms en p99 con el
   objeto caliente y 30 ms con el objeto recién creado. El caso caro no es ese,
   es la cola: 100 peticiones simultáneas contra la MISMA identidad se
   serializan en el objeto y dan p99 de 1108 ms. Con el presupuesto en 800 ms
   —el valor inicial— esas peticiones excedidas devolvían 503 en vez del 429
   que les corresponde. En producción hay que sumar además el viaje hasta el
   centro de datos donde viva el objeto, que puede estar en otro continente.
   1500 ms cubre cola, arranque en frío y travesía con margen, y sigue siendo
   una octava parte del presupuesto del análisis (12 s). */
const PRESUPUESTO_DO_MS = 1500;

/* La clase la registra el runtime por el nombre exportado, así que este
   reexport es obligatorio y no puede ser condicional: si limitador-do.js no
   carga, no falla el limitador, falla el Worker entero. Por eso la suite de
   pruebas carga ESTE archivo y no un doble. */
export { LimitadorIP } from './limitador-do.js';

export default {
  async fetch(peticion, env, ctx) {
    const dev = env && env.ENTORNO === 'dev';
    const permitidos = dev ? [...ORIGENES, ...ORIGENES_DEV] : ORIGENES;
    const origen = peticion.headers.get('Origin') || '';
    /* NO "ARREGLES" ESTE `permitidos[0]` OMITIENDO LA CABECERA. Parece el fallo
       clásico y es justo lo contrario: es lo único que hoy impide un fallo de
       verdad. Medido sobre una copia de este Worker:

         si a un origen no permitido se le responde SIN cabecera, la respuesta
         guardada en la Cache API conserva la ACAO del primer origen que pobló
         esa entrada, porque `Headers.set` no borra lo que no se le pasa. A
         partir de ahí, durante una hora, todos reciben la ACAO de otro. Un
         visitante que llegue por `www` recibiría la del dominio raíz y su
         navegador le cortaría el diagnóstico.

       Devolver siempre un origen de la lista mantiene la respuesta uniforme y
       deja que sea el navegador quien deniegue: no coincide con su origen y
       corta la lectura. Si algún día hay que cambiarlo, hay que borrar
       explícitamente la ACAO de la copia cacheada en el mismo commit.

       Y no se toca `Access-Control-Allow-Credentials`: sin él, ni cookies ni
       cabeceras de autenticación viajan, que es lo que se quiere. */
    const cors = {
      'Access-Control-Allow-Origin': permitidos.includes(origen) ? origen : permitidos[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      /* Sin esto el navegador ni siquiera intenta la petición: mandar una
         cabecera propia obliga a preflight, y el preflight sólo pasa si el
         servidor la declara aquí. */
      'Access-Control-Allow-Headers': TURNSTILE_CABECERA,
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    const url = new URL(peticion.url);
    const ruta = url.pathname;

    /* Lista blanca de rutas. Hasta ahora el Worker ignoraba el path y analizaba
       con cualquier ruta que llevara ?url=, y eso se explotó de verdad: una
       regla de la zona que salta la fase de bots para /robots.txt y
       /sitemap.xml no filtraba por hostname, así que
       `audit.sycsolutions.company/robots.txt?url=…` devolvía el informe entero
       saltándose Super Bot Fight Mode.

       La regla de la zona hay que arreglarla igual, pero esta comprobación
       existe para que ese fallo no vuelva a depender de una sola capa: aunque
       alguien vuelva a abrir el skip por error, aquí ya no hay nada que abrir.
       Ninguna ruta que no sea la canónica ejecuta el análisis. */
    if (ruta === '/robots.txt') {
      /* Propio y restrictivo: esto es una API, no tiene nada que indexar. Se
         responde igual lleve query o no, y en ningún caso analiza nada. */
      if (peticion.method !== 'GET' && peticion.method !== 'HEAD') {
        return json({ error: 'método no permitido' }, 405, { ...cors, 'Allow': 'GET, HEAD' });
      }
      return new Response('User-agent: *\nDisallow: /\n', {
        status: 200,
        headers: {
          'Content-Type': 'text/plain; charset=utf-8',
          'Cache-Control': 'public, max-age=86400',
          'X-Content-Type-Options': 'nosniff'
        }
      });
    }

    if (ruta !== RUTA_DIAGNOSTICO) return json({ error: 'no encontrado' }, 404, cors);

    if (peticion.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (peticion.method !== 'GET') {
      return json({ error: 'método no permitido' }, 405, { ...cors, 'Allow': 'GET, OPTIONS' });
    }

    const cruda = url.searchParams.get('url');
    if (!cruda) return json({ error: 'falta el parámetro url' }, 400, cors);

    /* TOPE DE LONGITUD, Y VA LO PRIMERO. Sin él, `new URL()` y sobre todo el
       `replace(/\.+$/, '')` de `inseguro()` trabajaban sobre una cadena de
       longitud arbitraria: medido, 16.000 puntos costaban 191 ms de CPU —cerca
       del 20 % del presupuesto de la invocación— y la petición acababa
       rechazada igual, pero DESPUÉS de gastarlos. Era el único vector de coste
       que no exigía ni token ni cuota, porque esta comprobación ocurre antes
       que Turnstile y antes que el limitador.
       2048 es el techo práctico de una URL real; los navegadores rondan ese
       orden y ningún sitio auditable se publica por encima. */
    if (cruda.length > MAX_LARGO_URL) {
      return json({ error: 'la dirección es demasiado larga' }, 414, cors);
    }

    /* Solo se antepone https cuando NO hay esquema alguno. Comprobar únicamente
       http/https convertía "ftp://sitio.com" en "https://ftp://sitio.com", una
       URL válida con host "ftp" que se colaba hasta el fetch en lugar de ser
       rechazada por protocolo. */
    let destino;
    try {
      const conEsquema = /^[a-z][a-z0-9+.-]*:/i.test(cruda);
      destino = new URL(conEsquema ? cruda : 'https://' + cruda);
    } catch {
      return json({ error: 'dirección no válida' }, 400, cors);
    }

    /* Credenciales incrustadas: se descartan antes de tocar la red. Reenviar
       usuario:clave@destino convertiría al Worker en un repartidor de
       credenciales ajenas hacia donde diga quien llama. */
    destino.username = '';
    destino.password = '';

    const veto = inseguro(destino);
    if (veto) return json({ error: veto }, 400, cors);

    /* Turnstile, y va ANTES del limitador a propósito. El orden importa: si el
       token se validara después, cualquiera podría gastar la cuota de una IP
       compartida mandando basura, sin resolver un solo desafío. Así un token
       ausente o inválido no cuesta ni una plaza del contador.
       Va después de validar la URL porque esa comprobación es local y gratis:
       no tiene sentido gastar una subpetición contra siteverify para acabar
       rechazando la petición por una dirección mal escrita. */
    const prechequeo = prechequeaToken(peticion.headers.get(TURNSTILE_CABECERA));
    if (prechequeo) {
      cors['X-Limitador'] = 'turnstile-precheck';
      return json(
        { error: 'verificación anti-bots ausente o no válida', renovar: true },
        403,
        cors
      );
    }

    const ts = await verificaTurnstile(env, peticion.headers.get(TURNSTILE_CABECERA).trim());
    if (!ts.ok) {
      cors['X-Limitador'] = ts.estado;
      /* Sólo se registran los fallos de configuración o de plataforma. Un token
         rechazado es funcionamiento normal y ruido en el log. */
      if (ts.codigo !== 403) registra('turnstile-degradado', { estado: ts.estado });
      if (ts.codigo === 403) {
        return json(
          { error: 'verificación anti-bots ausente o no válida', renovar: true },
          403,
          cors
        );
      }
      return json(
        { error: 'el diagnóstico no está disponible en este momento; inténtalo en un minuto' },
        503,
        { ...cors, 'Retry-After': '60' }
      );
    }

    const ip = peticion.headers.get('CF-Connecting-IP') || 'desconocida';
    /* La IP no vuelve a aparecer a partir de aquí: lo que circula es su
       seudónimo. Es null si no hay sal configurada o si no había cabecera. */
    const seudo = await seudonimo(ip, env);

    /* Limitador atómico, y va ANTES de la caché a propósito.
       Antes el orden era el contrario, con este razonamiento: servir un informe
       ya calculado no cuesta peticiones salientes, así que no había que
       penalizarlo. Sigue siendo verdad, pero deja un agujero que importa más:
       una ráfaga simultánea contra una URL YA CACHEADA se serviría entera sin
       tocar ningún limitador, que es justo el pico que había que cerrar.
       Ponerlo delante no endurece nada que no estuviera ya endurecido: la regla
       de Rate Limiting del WAF cuenta desde hace un rato TODAS las peticiones a
       este host, aciertos de caché incluidos, con el mismo tope de 20/60s. Esto
       sólo hace exacto lo que aquella capa ya intenta hacer. */
    const lim = await topeAtomico(env, seudo);
    cors['X-Limitador'] = lim.estado;

    if (!lim.permitido) {
      /* Dos negativas distintas y no conviene mezclarlas. `limite` es el
         funcionamiento normal: has gastado tu cuota, vuelve en un minuto. Todo
         lo demás es que el limitador NO PUDO decidir, y entonces el diagnóstico
         no se ejecuta —falla cerrado— porque es la operación cara. Decirle 429
         a alguien que no ha gastado nada sería mentirle, y además invitaría a
         reintentar contra un sistema que ya está mal. */
      if (lim.estado === 'limite') {
        return json(
          { error: 'demasiados análisis seguidos; espera un minuto e inténtalo de nuevo' },
          429,
          { ...cors, 'Retry-After': String(esperaRedondeada(lim.esperaS)) }
        );
      }
      registra('limitador-cerrado', { estado: lim.estado });
      return json(
        { error: 'el diagnóstico no está disponible en este momento; inténtalo en un minuto' },
        503,
        { ...cors, 'Retry-After': '60' }
      );
    }

    /* La caché va antes del limitador POR CACHE API: servir un informe ya
       calculado no cuesta peticiones salientes, así que no tiene sentido
       penalizarlo dos veces.

       Esta consulta a la Cache API sólo tiene efecto sirviendo desde el dominio
       propio (ver `dentroDelTope`). Se complementa con la cabecera
       Cache-Control de la respuesta, que la respeta la caché de borde estándar
       y funciona en cualquier caso. */
    const clave = new Request(
      'https://cache.local/seo?u=' + encodeURIComponent(destino.href),
      { method: 'GET' }
    );
    const guardado = await caches.default.match(clave);
    if (guardado) {
      const copia = new Response(guardado.body, guardado);
      Object.entries(cors).forEach(([k, v]) => copia.headers.set(k, v));
      return copia;
    }

    /* Tercera capa. Con el Durable Object sano esta ya no puede rechazar nada:
       aquí sólo llegan peticiones que el limitador atómico admitió, y admite 20
       como mucho por ventana, que es el mismo tope que mira esta.
       Se conserva por dos motivos, y ninguno es el que decía este comentario
       antes —que el limitador atómico fallaba abierto; ya no, falla cerrado—:
       cubre el caso de que alguien apague el limitador con LIMITE_ATOMICO=off,
       y cubre el hostname *.workers.dev, donde no llega la regla del WAF.
       Es una red, no una capa activa. */
    let permitido = true;

    /* Binding nativo de Rate Limiting. Se conserva la llamada porque cuando
       funciona es lo correcto —cuenta en el borde, sin coste—, pero NO se
       confía solo en él: en esta cuenta devuelve success:true siempre, incluso
       con 40 peticiones en paralelo desde una IP y un tope de 20/60s.
       Comprobado con `wrangler tail`: el binding está presente y limit() se
       invoca con la IP correcta; simplemente no cuenta. */
    if (env && env.LIMITADOR) {
      const { success } = await env.LIMITADOR.limit({ key: ip });
      permitido = success;
    }

    /* Limitador propio sobre la caché de borde. Existe porque el de arriba no
       aplica aquí y dejar el endpoint sin ningún tope era el agujero principal.
       No es exacto y no pretende serlo: la lectura y la escritura no son
       atómicas, así que una ráfaga simultánea lee el mismo contador y pasa
       entera. Lo que sí acota es el abuso SOSTENIDO, que es la forma real de
       explotarlo —recorrer miles de dominios lleva tiempo—. El tope exacto
       importa menos que el hecho de que exista. */
    if (permitido) permitido = await dentroDelTope(seudo || ip, ctx);

    if (!permitido) {
      return json(
        { error: 'demasiados análisis seguidos; espera un minuto e inténtalo de nuevo' },
        429,
        { ...cors, 'Retry-After': '60' }
      );
    }

    let informe;
    try {
      /* El techo global va antes que la resolución y que el análisis: es lo
         más barato de comprobar de todo lo que queda y lo que corta un ataque
         distribuido en seco. Detrás de la caché a propósito, para que un
         informe ya calculado no gaste presupuesto de nadie. */
      const glob = await topeGlobal(env);
      if (!glob.permitido) {
        cors['X-Limitador'] = glob.estado;
        registra('techo-global', { esperaS: glob.esperaS });
        return json(
          { error: 'el diagnóstico está recibiendo mucho tráfico; inténtalo en un minuto' },
          503,
          /* Redondeada, como el resto de los 503: devolver el segundo exacto
             sincroniza a todos los rechazados en el mismo instante y provoca la
             estampida que el 503 venía a evitar. */
          { ...cors, 'Retry-After': String(esperaRedondeada(glob.esperaS || 60)) }
        );
      }

      /* La comprobación tras resolver va AQUÍ y no arriba con `inseguro()`: es
         la única del camino que gasta subpeticiones, así que se paga sólo
         cuando la petición ya demostró token válido y cuota disponible. Una
         petición anónima nunca la dispara. */
      const vetoIP = await ipDeDestinoProhibida(destino.hostname);
      if (vetoIP) {
        registra('destino-interno', { host: destino.hostname });
        const rechazo = json({ error: vetoIP }, 400, cors);
        rechazo.headers.set('Cache-Control', 'public, max-age=' + CACHE_ERR_S);
        if (ctx) ctx.waitUntil(caches.default.put(clave, rechazo.clone()));
        return rechazo;
      }
      informe = await analiza(destino);
    } catch (e) {
      /* Los errores TAMBIÉN se cachean. Antes no, y ese era el agujero: apuntar
         a dominios inexistentes o que no devuelven HTML nunca tocaba caché, así
         que cada intento provocaba peticiones salientes reales. Amplificación
         de 1 entrante a 3 salientes, indefinidamente. */
      /* Del destino sólo el host: sirve para ver si un dominio concreto está
         dando guerra y no arrastra ruta ni parámetros. */
      registra('analisis-fallido', { host: destino.hostname, motivo: mensaje(e) });
      const fallo = json({ error: mensaje(e) }, 502, cors);
      fallo.headers.set('Cache-Control', 'public, max-age=' + CACHE_ERR_S);
      if (ctx) ctx.waitUntil(caches.default.put(clave, fallo.clone()));
      return fallo;
    }

    /* Hasta aquí sólo se registraban los FALLOS, y por eso un ataque que
       funcionaba no dejaba ni una línea: quien saturase el servicio con
       análisis válidos era invisible en los logs propios, y el aviso llegaba
       por correo de Cloudflare. Ahora el camino feliz también escribe, con el
       host del destino —nunca la ruta ni los parámetros, igual que el fallo— y
       el estado del limitador, que es lo que permite ver una ráfaga en la
       consola sin esperar a la factura. */
    registra('analisis-ok', { host: destino.hostname, limitador: cors['X-Limitador'] });

    const salida = json(informe, 200, cors);
    salida.headers.set('Cache-Control', 'public, max-age=' + CACHE_OK_S);
    /* waitUntil en vez de await: guardar en caché no debe retrasar la respuesta
       que ya está lista. */
    if (ctx) ctx.waitUntil(caches.default.put(clave, salida.clone()));
    else await caches.default.put(clave, salida.clone());
    return salida;
  }
};

/**
 * Comprobación local del token, ANTES de gastar una subpetición de red.
 *
 * Devuelve null si el token es plausible, o el motivo del rechazo. No dice si el
 * token es válido —eso sólo lo sabe siteverify—, sólo descarta lo que no puede
 * serlo. Es el mismo criterio que publica Cloudflare como canónico.
 */
function prechequeaToken(token) {
  if (typeof token !== 'string') return 'ausente';
  const t = token.trim();
  if (!t) return 'ausente';
  if (t.length > TURNSTILE_MAX) return 'demasiado largo';
  /* Base64 y base64url, más el punto que separa las partes del token. Cualquier
     otra cosa —espacios, control, unicode— no puede venir del widget. */
  if (!/^[A-Za-z0-9._~+/=-]+$/.test(t)) return 'caracteres no válidos';
  return null;
}

/** Hostnames donde puede haberse renderizado el widget. Es el hostname del
 *  SITIO, no el de esta API: el widget vive en la web pública. */
function hostnamesTurnstile(env) {
  const config = env && env.TURNSTILE_HOSTNAMES;
  if (config) return String(config).split(',').map(s => s.trim().toLowerCase()).filter(Boolean);
  return ORIGENES.map(o => new URL(o).hostname.toLowerCase());
}

/**
 * Valida el token contra siteverify.
 *
 * Falla CERRADO en todos los caminos: un problema de red o una respuesta que no
 * se entiende NO deja pasar. Devuelve { ok } o { ok:false, codigo, estado }.
 *
 * Sobre el anti-replay: no hay almacén propio de nonces a propósito. Los tokens
 * de Turnstile ya son de un solo uso en siteverify —un segundo intento devuelve
 * `timeout-or-duplicate`— y caducan a los 300 s. Montar un registro propio
 * duplicaría ese trabajo, añadiría estado que mantener y no cerraría nada que
 * Cloudflare no cierre ya.
 */
async function verificaTurnstile(env, token) {
  const secreto = env && env.TURNSTILE_SECRET;
  if (!secreto) return { ok: false, codigo: 503, estado: 'turnstile-sin-secreto' };

  const dev = env && env.ENTORNO === 'dev';
  const dePrueba = TURNSTILE_SECRETOS_DE_PRUEBA.has(secreto);

  /* Sólo se admite redirigir siteverify en desarrollo. Es lo que permite probar
     los caminos que no se pueden provocar contra el servicio real —caído, 5xx,
     cuerpo que no es JSON, cuelgue— que son justo los que deben fallar cerrado.
     En producción la constante es la única dirección posible: aunque alguien
     defina la variable, se ignora. */
  const destino = (dev && env.TURNSTILE_URL) ? env.TURNSTILE_URL : TURNSTILE_URL;

  /* Una clave de prueba fuera de desarrollo convierte el control en un adorno
     —la que "siempre pasa" acepta cualquier cosa—, así que se trata como avería
     de configuración, no como un rechazo del visitante. */
  if (dePrueba && !dev) return { ok: false, codigo: 503, estado: 'turnstile-claves-de-prueba' };

  let datos;
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), TURNSTILE_ESPERA_MS);
  try {
    const r = await fetch(destino, {
      method: 'POST',
      body: new URLSearchParams({ secret: secreto, response: token }),
      signal: ctl.signal
    });
    /* Se distingue "contestó algo que no es 200" de "no contestó". Las dos
       cierran igual, pero en el log son problemas distintos: la primera apunta
       a la configuración o al servicio, la segunda a la red. */
    if (!r.ok) return { ok: false, codigo: 503, estado: 'turnstile-http-' + r.status };
    datos = await r.json();
  } catch {
    /* Red caída, tiempo agotado o cuerpo que no es JSON. */
    return { ok: false, codigo: 503, estado: 'turnstile-inalcanzable' };
  } finally {
    clearTimeout(reloj);
  }

  if (!datos || typeof datos !== 'object') {
    return { ok: false, codigo: 503, estado: 'turnstile-respuesta-invalida' };
  }

  /* REFUERZO, no mecanismo principal. El que decide es la comparación del
     secreto contra los tres valores públicos, unas líneas más arriba: eso es
     determinista y sólo depende de nuestra configuración. Esto de aquí sale de
     un campo que Cloudflare NO documenta, así que puede desaparecer sin aviso;
     mientras exista, atrapa el caso de un secreto de prueba que no estuviera en
     nuestra lista. Si desapareciera, no se pierde la protección. */
  const marcadaComoPrueba = !!(datos.metadata && datos.metadata.result_with_testing_key === true);
  if (marcadaComoPrueba && !dev) {
    return { ok: false, codigo: 503, estado: 'turnstile-claves-de-prueba' };
  }

  /* Con un secreto VÁLIDO, siteverify responde 200 aunque rechace el token, así
     que el veredicto se toma por `success` y no por el estado HTTP.
     El estado sí importa en un caso, y está resuelto arriba: si el secreto es
     inválido devuelve 400 —medido— y eso es una avería nuestra, no una culpa
     del visitante, así que sale por la rama de 503 y no por este 403. */
  if (datos.success !== true) {
    return { ok: false, codigo: 403, estado: 'turnstile-rechazado', renovar: true };
  }

  const host = String(datos.hostname || '').toLowerCase();
  if (!hostnamesTurnstile(env).includes(host)) {
    return { ok: false, codigo: 403, estado: 'turnstile-hostname', renovar: true };
  }

  /* Con claves de prueba el campo `action` no llega —comprobado contra el
     servicio real—, así que exigirlo dejaría el camino feliz sin poder probarse.
     Se omite SÓLO en ese caso.
     La condición mira `dePrueba`, que compara el secreto configurado con los
     tres valores públicos documentados, y NO `marcadaComoPrueba`, que sale de
     un campo que Cloudflare no documenta. La diferencia importa: si ese campo
     desapareciera, usarlo aquí haría que la comprobación se aplicara o se
     saltara según lo que devuelva un tercero. Con `dePrueba` la decisión sólo
     depende de nuestra configuración, y en producción —donde el secreto es real
     y `dePrueba` es falso— la comprobación se exige siempre. */
  if (!dePrueba && datos.action !== TURNSTILE_ACCION) {
    return { ok: false, codigo: 403, estado: 'turnstile-accion', renovar: true };
  }

  return { ok: true };
}

/* ---------- límite de uso ---------- */

const TOPE_POR_VENTANA = 20;   /* análisis nuevos por IP y minuto */

/**
 * TECHO GLOBAL DEL SERVICIO.
 *
 * Las cuatro capas que había contaban todas por identidad derivada de la IP: la
 * regla del WAF por ip.src, el Durable Object por idFromName(seudónimo), el
 * binding nativo por limit({key: ip}) y el contador de caché por el mismo
 * seudónimo. Ninguna agregaba tráfico ENTRE identidades, y esa es una diferencia
 * aritmética, no de matiz: el tope no era 20 por minuto, era 20 por minuto POR
 * IP. Con 5.000 direcciones el techo del sistema eran 100.000 análisis por
 * minuto, y nada en el diseño lo detenía en 100.000 en vez de en 100 millones.
 *
 * Turnstile encarece mucho ese ataque —exige un navegador real por token— pero
 * no lo impide, y encarecer no es lo mismo que acotar. Esto sí acota: es el
 * único contador del sistema que no depende de quién llame.
 *
 * Reutiliza la MISMA clase del Durable Object con un nombre constante, así que
 * no hace falta binding nuevo ni migración. Serializa el tráfico admitido en un
 * solo objeto; con el volumen de este servicio sobra de largo, y si algún día
 * no sobrara, el arreglo es repartir por franjas, no quitar el techo.
 *
 * ⚠ EL VALOR ESTÁ ATADO A `FILAS_MAX` DEL DURABLE OBJECT, Y NO ES NEGOCIABLE.
 * `consume()` recorta en silencio cualquier tope mayor que FILAS_MAX (hoy 100)
 * y lo sustituye por 20 —limitador-do.js:79—, porque con un tope por encima del
 * techo de filas la purga de cinturón deja siempre las 100 más nuevas y el
 * contador nunca alcanza el límite: el limitador se volvía ILIMITADO. El
 * recorte es correcto, pero es SILENCIOSO: pedir 600 aquí no habría dado un
 * error, habría dejado TODO EL SERVICIO en 20 análisis por minuto y roto el
 * diagnóstico para gente real. Comprobado leyendo limitador-do.js:64-81.
 *
 * Así que 100, que es el máximo que el mecanismo sostiene de verdad: cinco
 * veces el tope de una sola IP y muy por encima de cualquier pico legítimo de
 * este sitio, y a la vez un suelo firme por debajo del cual la factura no puede
 * dispararse. Para subirlo hay que subir antes FILAS_MAX y volver a medir la
 * purga; cambiar sólo este número no hace nada bueno y sí algo malo.
 */
const TOPE_GLOBAL_VENTANA = 100;
const NOMBRE_GLOBAL = '__global__';

/**
 * Igual que `topeAtomico` pero sobre el objeto único del servicio.
 *
 * Falla ABIERTO, y aquí sí es lo correcto: esta capa protege la factura, no los
 * datos. Si el objeto global no responde, las cuatro capas por IP siguen todas
 * en pie —el ataque distribuido que esto acota necesita miles de identidades
 * distintas, no es el caso normal— y cerrar dejaría el servicio caído para todo
 * el mundo por un fallo de una capa que es un tope, no un guardián.
 */
async function topeGlobal(env) {
  if (!env || !env.LIMITADOR_DO || env.LIMITE_ATOMICO === 'off') return { permitido: true, estado: 'global-inactivo' };
  let reloj;
  try {
    const objeto = env.LIMITADOR_DO.get(env.LIMITADOR_DO.idFromName(NOMBRE_GLOBAL));
    const r = await Promise.race([
      objeto.consume(TOPE_GLOBAL_VENTANA, VENTANA_MS),
      new Promise((_, falla) => {
        reloj = setTimeout(() => falla(new Error('presupuesto agotado')), PRESUPUESTO_DO_MS);
      })
    ]);
    if (!r || r.ok !== true || typeof r.permitido !== 'boolean') {
      /* El techo que acota la factura puede estar caído indefinidamente. Si
         además calla, nadie se entera hasta que llega el recibo: la cabecera
         X-Limitador no sirve de nada aquí porque no hay
         Access-Control-Expose-Headers, así que el JS del navegador no la lee
         nunca; el único canal real es el log. */
      registra('techo-global-degradado', { motivo: 'respuesta-invalida' });
      return { permitido: true, estado: 'global-degradado' };
    }
    return r.permitido
      ? { permitido: true, estado: 'global-ok' }
      : { permitido: false, estado: 'global-limite', esperaS: r.esperaS };
  } catch (e) {
    registra('techo-global-degradado', { motivo: e && e.overloaded ? 'saturado' : 'error' });
    return { permitido: true, estado: 'global-degradado' };
  } finally {
    clearTimeout(reloj);
  }
}

/* Longitud mínima de SAL_LIMITE. 43 caracteres es lo que ocupan 32 bytes en
   base64 sin relleno, así que por debajo de ahí es imposible que haya 256 bits
   de entropía y no hace falta discutirlo. Por encima no se puede medir la
   entropía real desde aquí —un valor largo y repetitivo la pasaría—, así que
   esto descarta el descuido, no al adversario. Ver LIMITADOR.md. */
const SAL_MIN_LARGO = 43;

/* Cachea la clave HMAC importada durante la vida del isolate. Importarla en
   cada petición es trabajo criptográfico repetido en el camino crítico para
   obtener siempre lo mismo. */
let claveHmac = null;
let salDeLaClave = null;

/** ¿Sirve esta sal? Se comprueba en cada petición porque es barato y porque el
 *  precio de equivocarse es un seudónimo predecible. */
function salValida(sal) {
  if (typeof sal !== 'string') return false;
  const s = sal.trim();
  if (s.length < SAL_MIN_LARGO) return false;
  /* Un valor con muy pocos caracteres distintos no es aleatorio por largo que
     sea: descarta rellenos tipo "aaaa..." o "0000...". */
  if (new Set(s).size < 16) return false;
  return true;
}

/**
 * Normaliza la IP antes de derivar la identidad.
 *
 * Sin esto, dos escrituras de la misma dirección serían dos identidades con
 * cuota propia. Y hay una que importa mucho más que las demás: en IPv6 lo
 * habitual es que a un solo cliente le asignen un /64 entero —millones de
 * billones de direcciones—, así que limitar por dirección completa regala
 * cuota infinita a cualquiera con IPv6. Se trunca a /64, que es lo que hace el
 * propio Cloudflare en sus reglas de rate limiting.
 *
 * Devuelve null si no hay nada de lo que fiarse: eso acaba en fallo cerrado.
 */
function identidad(ip) {
  if (typeof ip !== 'string') return null;
  let s = ip.trim().toLowerCase();
  if (!s) return null;

  /* Forma con corchetes y/o puerto, e identificador de zona (fe80::1%eth0). */
  if (s.startsWith('[')) s = s.slice(1, s.indexOf(']') === -1 ? undefined : s.indexOf(']'));
  const zona = s.indexOf('%');
  if (zona !== -1) s = s.slice(0, zona);
  s = s.replace(/\.$/, '');
  if (!s) return null;

  /* IPv4 mapeada dentro de IPv6: ::ffff:1.2.3.4 es la misma máquina que
     1.2.3.4 y tiene que compartir contador con ella. */
  const mapeada = s.match(/^::ffff:(\d{1,3}(?:\.\d{1,3}){3})$/);
  if (mapeada) s = mapeada[1];

  if (/^\d{1,3}(\.\d{1,3}){3}$/.test(s)) {
    const partes = s.split('.').map(Number);
    if (partes.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    return 'v4:' + partes.join('.');
  }

  if (s.includes(':')) {
    const bloques = expandeIPv6(s);
    if (!bloques) return null;
    /* /64: los cuatro primeros grupos. Todo lo que hay debajo lo controla el
       mismo abonado, así que es una sola identidad. */
    return 'v6:' + bloques.slice(0, 4).join(':');
  }

  return null;
}

/** Expande un IPv6 a sus ocho grupos de cuatro dígitos. null si no lo es. */
function expandeIPv6(s) {
  const dobles = s.split('::');
  if (dobles.length > 2) return null;
  const trozo = t => (t ? t.split(':') : []);
  let izq = trozo(dobles[0]);
  let der = dobles.length === 2 ? trozo(dobles[1]) : [];

  /* Cola IPv4 (::ffff:192.0.2.1 ya se resolvió antes; esto cubre el resto). */
  const cola = der.length ? der[der.length - 1] : (izq.length ? izq[izq.length - 1] : '');
  if (cola && cola.includes('.')) {
    const p = cola.split('.').map(Number);
    if (p.length !== 4 || p.some(n => !Number.isInteger(n) || n < 0 || n > 255)) return null;
    const a = ((p[0] << 8) | p[1]).toString(16);
    const b = ((p[2] << 8) | p[3]).toString(16);
    if (der.length) der = [...der.slice(0, -1), a, b];
    else izq = [...izq.slice(0, -1), a, b];
  }

  if (dobles.length === 1) {
    if (izq.length !== 8) return null;
  } else if (izq.length + der.length > 7) return null;

  const huecos = 8 - izq.length - der.length;
  const todos = [...izq, ...Array(huecos).fill('0'), ...der];
  if (todos.length !== 8) return null;
  for (const g of todos) {
    if (!/^[0-9a-f]{1,4}$/.test(g)) return null;
  }
  return todos.map(g => g.padStart(4, '0'));
}

/**
 * Deriva el nombre del Durable Object a partir de la IP.
 *
 * Usa HMAC-SHA256 con la sal como CLAVE, no un hash de sal+IP concatenados: en
 * un HMAC la clave entra por un camino distinto al mensaje, así que no hay
 * forma de jugar con los límites entre ambos.
 *
 * Es SEUDONIMIZACIÓN, no anonimización, y la diferencia importa: sólo hay 2^32
 * direcciones IPv4, así que quien tenga la sal las recorre todas en segundos y
 * revierte cualquier seudónimo. La sal es el único secreto que lo sostiene.
 * Lo que sí garantiza: la IP en claro no sale de esta función.
 *
 * Devuelve null ante cualquier problema. Ese null acaba en 503, nunca en pasar.
 */
async function seudonimo(ip, env) {
  const sal = env && env.SAL_LIMITE;
  if (!salValida(sal)) return null;

  const ident = identidad(ip);
  if (!ident) return null;

  try {
    if (claveHmac === null || salDeLaClave !== sal) {
      claveHmac = await crypto.subtle.importKey(
        'raw', new TextEncoder().encode(sal),
        { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']
      );
      salDeLaClave = sal;
    }
    const firma = await crypto.subtle.sign('HMAC', claveHmac, new TextEncoder().encode(ident));
    /* 16 bytes bastan de sobra para no colisionar. */
    return [...new Uint8Array(firma).slice(0, 16)]
      .map(b => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    return null;
  }
}

/**
 * Consulta el limitador atómico.
 *
 * FALLA CERRADO. Si el limitador no puede garantizar que la petición cabe en la
 * cuota, el diagnóstico no se ejecuta y se responde 503.
 *
 * Es una decisión deliberada y tiene un precio: cualquier problema del Durable
 * Object deja el diagnóstico temporalmente indisponible. Se acepta porque la
 * operación que hay detrás es cara —abre conexiones salientes a terceros y se
 * factura a nuestra cuenta— y porque un limitador que se desactiva solo justo
 * cuando falla algo es exactamente el que un atacante querría. El sitio público
 * no se ve afectado: vive en Pages, en otro hostname, y no pasa por aquí.
 *
 * El `estado` viaja en la cabecera X-Limitador. Sin él, un limitador vivo y uno
 * apagado producirían la misma salida observable y no habría forma de saber
 * cuál está corriendo en producción. No lleva información sobre quién pide.
 */
async function topeAtomico(env, seudo) {
  /* El interruptor de retirada es lo ÚNICO que abre, y sólo porque es una
     decisión humana y explícita, no un fallo. */
  if (env && env.LIMITE_ATOMICO === 'off') return { permitido: true, estado: 'apagado' };

  if (!env || !env.LIMITADOR_DO) return { permitido: false, estado: 'sin-binding' };
  if (!seudo) return { permitido: false, estado: 'sin-identidad' };

  let reloj;
  try {
    const objeto = env.LIMITADOR_DO.get(env.LIMITADOR_DO.idFromName(seudo));
    const r = await Promise.race([
      objeto.consume(TOPE_POR_VENTANA, VENTANA_MS),
      new Promise((_, falla) => {
        reloj = setTimeout(() => falla(new Error('presupuesto agotado')), PRESUPUESTO_DO_MS);
      })
    ]);

    /* Se valida la FORMA de la respuesta, no sólo que no haya excepción. Un
       objeto raro, un undefined o un null por un fallo de la plataforma no
       pueden interpretarse como permiso: sin este `ok` explícito, `r.permitido`
       sobre un undefined daría el mismo falsy que un rechazo legítimo, y sobre
       un objeto inesperado podría dar truthy. */
    if (!r || r.ok !== true || typeof r.permitido !== 'boolean') {
      return { permitido: false, estado: 'respuesta-invalida' };
    }

    return r.permitido
      ? { permitido: true, estado: 'ok' }
      : { permitido: false, estado: 'limite', esperaS: r.esperaS };
  } catch (e) {
    /* Sin reintentos: si el objeto está saturado, insistir es empujar. La
       distinción sólo sirve para el diagnóstico de la cabecera; las dos ramas
       cierran igual. */
    return { permitido: false, estado: e && e.overloaded ? 'saturado' : 'error' };
  } finally {
    clearTimeout(reloj);
  }
}

/**
 * Cuenta peticiones por IP en ventanas de un minuto usando la caché de borde.
 *
 * FUNCIONA desde que el Worker se sirve en `audit.sycsolutions.company`.
 * Medido en producción sobre ese dominio: la petición 21 recibe 429, y de 35
 * seguidas pasan 20 y se bloquean 15. Es exactamente el tope de abajo.
 *
 * Conviene saber por qué antes no funcionaba, para no repetir el error: la
 * Cache API **sólo opera en dominios propios**. Mientras el Worker vivió en
 * `*.workers.dev`, `match()` siempre fallaba y `put()` no guardaba nada, así
 * que el contador leía cero en cada petición y dejaba pasar todo. El mismo
 * código, sin tocar una línea, empezó a proteger al cambiar de dominio.
 *
 * Limitación que se mantiene: leer y escribir no es atómico, así que una
 * ráfaga simultánea lee el mismo valor y pasa entera —40 en paralelo siguen
 * pasando—. Frena el abuso sostenido, que es la forma real de explotar esto:
 * recorrer miles de dominios lleva tiempo. Para cortar también los picos hace
 * falta una regla de Rate Limiting del WAF en la zona, que ya es posible ahora
 * que hay dominio propio, o un contador atómico con Durable Objects.
 *
 * El binding nativo de Rate Limiting sigue declarado y se invoca antes que
 * esto, pero en esta cuenta devuelve success:true siempre (comprobado con
 * `wrangler tail`). Se conserva por si empieza a contar; no se depende de él.
 */
async function dentroDelTope(quien, ctx) {
  try {
    const ventana = Math.floor(Date.now() / 60000);
    /* `quien` es el seudónimo cuando hay sal configurada, y la IP en claro sólo
       como último recurso. Merecía el cambio: no hay motivo para que una IP
       viaje en una clave de caché pudiendo viajar su seudónimo. */
    const clave = new Request(
      'https://cache.local/rl?q=' + encodeURIComponent(quien) + '&v=' + ventana
    );
    const previo = await caches.default.match(clave);
    const usados = previo ? Number(await previo.text()) || 0 : 0;
    if (usados >= TOPE_POR_VENTANA) return false;

    const nuevo = new Response(String(usados + 1), {
      headers: { 'Cache-Control': 'max-age=60' }
    });
    if (ctx) ctx.waitUntil(caches.default.put(clave, nuevo));
    else await caches.default.put(clave, nuevo);
    return true;
  } catch {
    /* Si la caché falla, se deja pasar. Un limitador roto no debe tumbar el
       servicio: el fallo aquí es de disponibilidad, no de seguridad, y ya hay
       otras barreras (validación, SSRF, caché de resultados). */
    return true;
  }
}

/* ---------- red ---------- */

/* Se exporta sólo para poder probarla como función pura: es el filtro que
   sostiene toda la defensa contra SSRF y merece una batería de cientos de
   vectores que no puede pagarse a golpe de petición HTTP. El runtime de Workers
   únicamente usa el export por defecto y las clases de Durable Object, así que
   exportarla no cambia nada del Worker desplegado.
   Ver test/ssrf.test.mjs. */
/* `rangoProhibido` e `ipv6Prohibida` salen aquí para que las pruebas puedan
   cubrirlas SIN RED. Es justo lo que le faltaba a la suite anterior: sus 190
   vectores eran todos sintácticos porque lo único exportado era `inseguro`. */
export { inseguro, rangoProhibido, ipv6Prohibida };

/** Rechaza destinos que no deben alcanzarse desde el borde.
 *
 *  Nota sobre codificaciones alternativas (http://2130706433/, 0x7f000001,
 *  127.1): no son un bypass porque el parser de `new URL()` normaliza IPv4 a
 *  cuádruple con puntos en los esquemas especiales antes de que la expresión
 *  regular de abajo lo vea. Se documenta porque es una dependencia implícita
 *  del parser: si esta función se reutiliza sobre un string crudo, o en un
 *  runtime con otro parser, deja de ser cierto. Valida siempre sobre
 *  `url.hostname` ya normalizado, nunca sobre el texto original. */
/**
 * ¿El primer par de octetos cae en un rango que no se debe alcanzar?
 *
 * Estaba en línea dentro de `inseguro()`. Se extrae porque ahora tiene un
 * segundo consumidor —la comprobación de la IP REALMENTE resuelta— y dos copias
 * de esta tabla se desincronizan el día que se añada un rango a una sola.
 */
function rangoProhibido(a, b, c) {
  return a === 0 || a === 10 || a === 127 || a >= 224 ||
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 169 && b === 254) ||
    (a === 100 && b >= 64 && b <= 127) ||
    (a === 198 && b >= 18 && b <= 19) ||   /* benchmarking, 198.18/15 */
    /* ⚠ ESTOS CINCO SON /24 Y HAY QUE COMPARAR EL TERCER OCTETO.
       Estaban escritos como /16 y durante mucho tiempo dio igual: la tabla sólo
       veía direcciones que el visitante ESCRIBÍA a mano, y nadie audita su web
       poniendo una IP. Desde que la comprobación tras resolver pasa por aquí
       CADA registro A de CADA dominio, un /16 de más deja de ser inocuo: son
       ~65.000 direcciones PÚBLICAS por regla —espacio real de ARIN y APNIC— a
       cuyos dueños se les respondería «no se pueden analizar direcciones
       internas», acusándoles de estar en una red interna, y con el rechazo
       cacheado cinco minutos para todo el mundo.
       Un cliente en 203.0.50.7 es un cliente perdido por un paréntesis. */
    (a === 192 && b === 0 && c === 0) ||     /* IETF protocol assignments */
    (a === 192 && b === 0 && c === 2) ||     /* TEST-NET-1 */
    (a === 198 && b === 51 && c === 100) ||  /* TEST-NET-2 */
    (a === 203 && b === 0 && c === 113) ||   /* TEST-NET-3 */
    (a === 192 && b === 88 && c === 99);     /* relé anycast 6to4 */
}

/**
 * Rangos IPv6 que no se deben alcanzar.
 *
 * Fuera de `ipDeDestinoProhibida` y por el mismo motivo que `rangoProhibido`:
 * un predicado suelto se puede probar sin red, y esta lista va a crecer.
 *
 * ⚠ DEPENDE DE QUE EL RESOLVEDOR DEVUELVA FORMA CANÓNICA COMPRIMIDA, que es lo
 * que hace cloudflare-dns.com. `0:0:0:0:0:0:0:1` no casaría con nada de esto.
 * Es la misma clase de dependencia implícita que `inseguro()` tiene con el
 * parser de URL, y conviene que esté escrita en vez de descubrirse.
 */
function ipv6Prohibida(v6) {
  const h = String(v6 || '').toLowerCase();
  return h === '::1' || h === '::' ||
    /^f[cd]/.test(h) ||        /* fc00::/7  únicas locales */
    /^fe[89ab]/.test(h) ||     /* fe80::/10 enlace local */
    /^fe[c-f]/.test(h) ||      /* fec0::/10 site-local, deprecado pero enrutado */
    /^ff/.test(h) ||           /* ff00::/8  multicast — en IPv4 sí se bloqueaba
                                  (a >= 224) y aquí faltaba: misma amenaza, misma
                                  respuesta */
    /^64:ff9b:/.test(h) ||     /* NAT64: traduce a IPv4 en una pasarela */
    /^2002:/.test(h) ||        /* 6to4: lleva la IPv4 incrustada */
    /* Las dos formas de meter una IPv4 dentro de una IPv6. `::ffff:` es la
       mapeada de siempre; `::` seguido de más de un grupo es la "compatible",
       deprecada, y por ahí entraba ::7f00:1 = ::127.0.0.1. */
    h.startsWith('::ffff:') ||
    (h.startsWith('::') && h.length > 2 && !/^::[0-9a-f]{0,4}$/.test(h));
}

/* Resolvedor público de Cloudflare, en su interfaz JSON. Se consulta desde el
   propio borde de Cloudflare, así que la latencia es despreciable. */
const DOH_URL = 'https://cloudflare-dns.com/dns-query';
const DOH_ESPERA_MS = 2_000;

/**
 * Comprueba la IP a la que el nombre REALMENTE resuelve.
 *
 * POR QUÉ EXISTE. `inseguro()` decide mirando la CADENA del hostname, y esa es
 * toda su fuerza y todo su límite: caza `127.0.0.1`, `2130706433` y `127.1`
 * —el parser de URL los normaliza a la forma con puntos antes de que la función
 * los vea—, pero no puede saber a dónde apunta un nombre. Un dominio cualquiera
 * con un registro A hacia 169.254.169.254 atravesaba el filtro entero. Es un
 * TOCTOU de manual: se valida un nombre y se conecta a una dirección.
 *
 * ⚠ ESTO NO CIERRA EL TOCTOU, Y NO DEBE PRESENTARSE COMO SI LO HICIERA.
 * Hay dos agujeros que quedan abiertos por construcción y conviene tenerlos
 * escritos, porque el día que alguien quiera relajar `inseguro()` o la lista
 * léxica de comodines "porque ya está la comprobación de DNS", la respuesta
 * está aquí:
 *   1. Quien controla el dominio controla también su servidor autoritativo, así
 *      que puede retrasar la respuesta por encima de DOH_ESPERA_MS y forzar el
 *      fallo abierto. Este control caza al atacante que no se molesta.
 *   2. Se resuelve por cloudflare-dns.com y después `fetch()` vuelve a resolver
 *      por su cuenta: un nombre con TTL 0 que conteste una IP pública a la
 *      consulta y una privada a la conexión lo atraviesa entero. Conectar por IP
 *      con el nombre en la cabecera Host —la única forma de cerrarlo de verdad—
 *      no es posible en Workers.
 * Es defensa en profundidad contra destinos mal configurados y contra el uso
 * casual de los servicios de DNS comodín. La barrera que sí aguanta sola es la
 * léxica de `inseguro()`.
 *
 * CÓMO FALLA, que es lo que importa en un control de seguridad:
 *   · resuelve a un rango prohibido  -> CIERRA. Es el caso que se viene a cerrar.
 *   · el resolvedor no contesta, tarda o devuelve basura -> ABRE, y lo registra.
 *     Cerrar aquí convertiría cualquier hipo de DNS en una caída del diagnóstico,
 *     y el riesgo que se cubre es de por sí residual —desde el borde de
 *     Cloudflare los rangos privados no suelen ser enrutables—. Se prefiere un
 *     servicio que sigue en pie con una defensa en profundidad menos.
 *   · el nombre no existe -> ABRE. El `fetch` fallará solo, con su mensaje.
 *
 * Se consultan A y AAAA a la vez: un nombre sólo con AAAA hacia ::1 se saltaba
 * la comprobación si sólo se miraba A.
 */
async function ipDeDestinoProhibida(hostname, señalExterna = null) {
  const pide = async tipo => {
    const ctl = new AbortController();
    const reloj = setTimeout(() => ctl.abort(), DOH_ESPERA_MS);
    /* La señal del análisis se encadena con la propia. Sin esto, el peor caso
       sumaba los 2 s de cada consulta POR ENCIMA del techo de 12 s del análisis
       y el total se iba por encima de los 20 s a los que el navegador aborta:
       el visitante veía un error de red en vez de un informe. */
    const corta = () => { try { ctl.abort(); } catch (_) {} };
    if (señalExterna) {
      if (señalExterna.aborted) { clearTimeout(reloj); return null; }
      señalExterna.addEventListener('abort', corta, { once: true });
    }
    try {
      const r = await fetch(
        DOH_URL + '?name=' + encodeURIComponent(hostname) + '&type=' + tipo,
        { headers: { 'Accept': 'application/dns-json' }, signal: ctl.signal }
      );
      if (!r.ok) return null;
      const d = await r.json();
      /* EL ESTADO DNS, QUE ES LO QUE FALTABA. La interfaz JSON responde HTTP 200
         también cuando la resolución fracasa: SERVFAIL (2) y REFUSED (5) llegan
         con `ok` y sin `Answer`. Sin mirar `Status`, «el resolvedor no pudo» y
         «resuelve limpio» eran el mismo camino, y el primero abría en silencio.
         0 = todo bien, 3 = NXDOMAIN (respuesta legítima: el nombre no existe).
         Cualquier otro valor es «no se pudo saber». */
      const est = d && typeof d.Status === 'number' ? d.Status : 0;
      if (est !== 0 && est !== 3) return null;
      return Array.isArray(d && d.Answer) ? d.Answer : [];
    } catch (_) {
      return null;               /* nulo = no se pudo saber, no = está limpio */
    } finally {
      clearTimeout(reloj);
      if (señalExterna) { try { señalExterna.removeEventListener('abort', corta); } catch (_) {} }
    }
  };

  const [a4, a6] = await Promise.all([pide('A'), pide('AAAA')]);

  /* Registra si falló CUALQUIERA de las dos, no sólo si fallaron ambas.
     Con la condición anterior (`a4 === null && a6 === null`), un fallo parcial
     abría sin dejar rastro: bastaba retrasar la consulta A —la que llevaría la
     IP privada— y contestar rápido la AAAA para que la función devolviera
     «limpio» sin haber mirado ni un registro A y sin escribir una línea.
     Se sigue abriendo, que es la política; lo que no puede pasar es que no se
     sepa que se abrió a ciegas. */
  if (a4 === null || a6 === null) {
    registra('dns-sin-respuesta', { host: hostname, a: a4 !== null, aaaa: a6 !== null });
  }
  if (a4 === null && a6 === null) return null;

  for (const reg of (a4 || [])) {
    if (reg.type !== 1) continue;               /* 1 = A; los CNAME no traen IP */
    const m = String(reg.data || '').match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
    if (m && rangoProhibido(+m[1], +m[2], +m[3])) return 'no se pueden analizar direcciones internas';
  }
  for (const reg of (a6 || [])) {
    if (reg.type !== 28) continue;              /* 28 = AAAA */
    if (ipv6Prohibida(reg.data)) return 'no se pueden analizar direcciones internas';
  }
  return null;
}

function inseguro(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return 'solo se admiten direcciones http y https';

  /* El puerto se compara con el que corresponde a ESTE esquema, no con la
     pareja 80/443 indistintamente: http://host:443 y https://host:80 son
     sondas de puerto disfrazadas de tráfico normal. Sin esta comprobación el
     Worker responde de forma distinguible según el destino esté abierto,
     cerrado o no devuelva HTML —y además publica `tiempoMs`—, lo que lo
     convierte en un escáner de puertos semiciego contra cualquier host. */
  if (u.port !== '' && u.port !== (u.protocol === 'https:' ? '443' : '80'))
    return 'solo se analizan sitios publicados en los puertos web habituales';

  /* Credenciales: se cortan AQUÍ y no sólo en la puerta de entrada, porque a
     esta función llegan también los destinos de las redirecciones, y por ahí un
     sitio hostil colaba un usuario:clave que el Worker acababa enviando —y
     publicando en el informe, que se cachea una hora—. */
  if (u.username || u.password)
    return 'no se admiten direcciones con usuario y contraseña incrustados';

  /* Se quitan TODOS los puntos finales, no uno. Con `\.$` la dirección
     "127.0.0.1.." quedaba en "127.0.0.1.", que ya no casa con la regex de IPv4
     de abajo ni cae en la rama de etiqueta única: se saltaba el filtro entero,
     localhost y redes privadas incluidas. */
  const h = u.hostname.toLowerCase().replace(/\.+$/, '');

  /* Etiqueta vacía en medio: ninguna resolución legítima la usa, y es la otra
     mitad del truco anterior. */
  if (h === '' || h.includes('..')) return 'eso no parece un dominio público';

  if (h === 'localhost' || h.endsWith('.localhost') ||
      h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa') ||
      /* Sufijos de red interna que colaban por tener puntos: el descubrimiento
         de servicios de Kubernetes y de Consul son destinos de primera. */
      h.endsWith('.svc') || h.endsWith('.consul') || h.endsWith('.lan') ||
      h.endsWith('.intranet') || h.endsWith('.corp') || h.endsWith('.private'))
    return 'no se pueden analizar direcciones internas';

  /* IPv6 literal: descartado entero. Las formas comprimidas y las direcciones
     mapeadas de IPv4 dan demasiadas maneras de escribir ::1 como para filtrar
     con confianza, y ningún sitio real que auditemos se publica así.
     Se mira el HOSTNAME, no el href: con `u.href.includes('[')` se rechazaba
     cualquier URL legítima con corchetes en la ruta o la query —?filtro[0]=azul
     es de lo más común—. */
  if (h.includes(':') || h.startsWith('['))
    return 'no se admiten direcciones IPv6 literales';

  /* Servicios de DNS comodín: resuelven a la IP que llevan escrita en el
     nombre, así que `169.254.169.254.nip.io` es la puerta trasera exacta a los
     rangos que la tabla de abajo prohíbe, sin registrar un dominio y sin
     montar nada. La comprobación tras resolver (ver `ipDeDestinoProhibida`) los
     caza igual, pero esto es gratis, no gasta una subpetición y sigue de pie
     aunque el resolvedor no conteste. */
  if (/(^|\.)(nip\.io|sslip\.io|xip\.io|localtest\.me|traefik\.me|1u\.ms|vcap\.me|lvh\.me)$/.test(h))
    return 'no se pueden analizar direcciones internas';

  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    if (ip.slice(1).some(n => +n > 255)) return 'dirección IP no válida';
    if (rangoProhibido(+ip[1], +ip[2], +ip[3]))
      return 'no se pueden analizar direcciones de red privada';
  } else if (!h.includes('.')) {
    /* Host de una sola etiqueta: `metadata`, `router`, `consul`,
       `instance-data`. No es localhost, no acaba en .local ni .internal, y no
       casa con la regex de IPv4, así que colaba. En el borde de Cloudflare
       resuelve por DNS público y probablemente falla, pero esta función está
       pensada para reutilizarse, y dentro de una red con dominios de búsqueda
       configurados esto es un acceso directo al servicio de metadatos. */
    return 'eso no parece un dominio público';
  }
  return null;
}

/**
 * Presupuesto de subpeticiones por análisis.
 *
 * El techo sale de contar el peor caso del código, no de elegir un número
 * bonito: la página principal son 1 petición más hasta SALTOS_MAX (3)
 * redirecciones, o sea 4; y `robots.txt` y `sitemap.xml` hacen lo mismo cada
 * uno. 4 × 3 = 12. Cualquier valor por encima de eso significa que hay un bucle
 * que no debería existir, y entonces conviene cortar en vez de seguir gastando.
 *
 * Es un contador en el código y no un ajuste de plataforma porque Cloudflare no
 * ofrece un tope configurable de subpeticiones: el límite del plan es global por
 * invocación y muy alto, así que no protege de un bug nuestro.
 */
const MAX_SUBPETICIONES = 12;

function presupuestoNuevo() {
  return { usadas: 0, max: MAX_SUBPETICIONES };
}

/** Sigue las redirecciones a mano validando cada salto. */
async function trae(url, señal, metodo = 'GET', presupuesto = null) {
  let actual = url, saltos = 0;
  while (true) {
    if (presupuesto) {
      if (presupuesto.usadas >= presupuesto.max) {
        throw new Error('ese sitio encadena demasiadas redirecciones');
      }
      presupuesto.usadas++;
    }
    const r = await fetch(actual.href, {
      method: metodo,
      redirect: 'manual',
      signal: señal,
      headers: {
        'User-Agent': 'SYC-SEO-Audit/1.0 (+https://sycsolutions.company/#diagnostico)',
        'Accept': 'text/html,application/xhtml+xml',
        /* Cloudflare añade por su cuenta la IP REAL del visitante a toda
           subpetición hacia un sitio que no es cliente suyo, en dos cabeceras:
           `CF-Connecting-IP` y `x-real-ip`. O sea que el sitio analizado ve
           desde qué IP se pidió el diagnóstico.
           De las dos, la documentación dice que sólo `x-real-ip` se puede
           alterar, y que el valor tiene que ser una IP sintácticamente válida.
           Se fija a 0.0.0.0 —dirección "sin especificar", que no identifica a
           nadie— para no filtrar por ahí.
           `CF-Connecting-IP` NO se puede quitar y sigue yendo con la IP real:
           es un riesgo residual documentado en LIMITADOR.md, no algo resuelto. */
        'x-real-ip': '0.0.0.0'
      }
    });
    if (r.status < 300 || r.status > 399) return { r, final: actual };
    const sig = r.headers.get('Location');
    if (!sig || ++saltos > SALTOS_MAX) return { r, final: actual };
    const nueva = new URL(sig, actual);
    const veto = inseguro(nueva);
    if (veto) throw new Error(veto);
    /* Y la comprobación tras resolver, en cada salto que cambie de host: sin
       esto, un servidor público bajo control de quien ataca respondía 302 hacia
       un nombre que apunta a una IP privada y la revalidación léxica lo
       aprobaba, porque sigue mirando el nombre. Sólo cuando el host cambia: un
       302 dentro del mismo dominio ya se comprobó al entrar.
       No consume del presupuesto de subpeticiones a propósito: ese contador
       mide golpes contra el sitio analizado, y esto va al resolvedor. */
    if (nueva.hostname !== actual.hostname) {
      const vetoIP = await ipDeDestinoProhibida(nueva.hostname, señal);
      if (vetoIP) throw new Error(vetoIP);
    }
    actual = nueva;
  }
}

/** Comprueba que un recurso auxiliar existe, sin descargarlo entero.
    Antes el comentario decía esto mismo pero el cuerpo se quedaba abierto y sin
    tope: un /robots.txt de 2 GB se descargaba entero. Ahora se cancela nada más
    conocer el estado, que es lo único que interesa. */
/* ⚠ El catch de esta función se traga CUALQUIER error, veto de destino interno
   incluido. No abre ningún agujero —la conexión sí se impidió— pero deja un
   punto ciego en la telemetría: `registra('destino-interno')` sólo se dispara en
   la puerta de entrada, así que una cadena de redirecciones de robots.txt o
   sitemap.xml hacia una IP privada se resolvía como «no tiene robots.txt» y no
   aparecía en ningún sitio. Ahora se distingue antes de tragárselo. */
async function existe(base, ruta, señal, presupuesto = null) {
  try {
    const { r } = await trae(new URL(ruta, base), señal, 'GET', presupuesto);
    if (r.body) { try { await r.body.cancel(); } catch { /* ya cerrado */ } }
    return r.status >= 200 && r.status < 300;
  } catch (e) {
    /* Un veto de destino interno no es «este sitio no tiene robots.txt»: es un
       intento de alcanzar red privada por una cadena de redirecciones auxiliar.
       El resultado para el informe es el mismo —false—, pero al log tiene que
       llegar, porque si no la única traza de este ataque son las cadenas que
       pasan por la puerta de entrada, que son un tercio de las que se siguen. */
    const m = mensaje(e);
    if (/direcciones internas|red privada/.test(m)) {
      registra('destino-interno', { host: base && base.hostname, via: ruta });
    }
    return false;
  }
}

/* ---------- análisis ---------- */

async function analiza(url) {
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), ESPERA_MS);
  /* Un presupuesto por análisis, no global: lo que se acota es cuánto puede
     gastar UNA petición entrante, que es donde un bug o un sitio hostil hacen
     daño. */
  const presupuesto = presupuestoNuevo();
  try {
    return await analizaConSeñal(url, ctl.signal, presupuesto);
  } finally {
    /* El reloj se limpia cuando TODO ha terminado, no al recibir las cabeceras.
       Antes se limpiaba tras `trae`, así que la lectura del cuerpo quedaba sin
       límite: un servidor que envía un byte por minuto mantenía la petición
       abierta indefinidamente sin llegar nunca al tope de bytes. */
    clearTimeout(reloj);
  }
}

async function analizaConSeñal(url, señal, presupuesto) {
  const t0 = Date.now();
  const { r: resp, final } = await trae(url, señal, 'GET', presupuesto);
  const ms = Date.now() - t0;

  /* Los 52x/53x no vienen del sitio auditado: los genera el propio borde de
     Cloudflare cuando no consigue hablar con el origen —el 530 es literalmente
     «no pude resolver ese dominio»—. Decir «el servidor respondió 530» a quien
     pidió el diagnóstico no significa nada y además suena a que su web falla,
     cuando lo que pasa es que la dirección no existe. */
  if (resp.status >= 520 && resp.status <= 530)
    throw new Error('no se pudo conectar con ese dominio; comprueba que la dirección existe y responde');

  if (!resp.ok) throw new Error('el servidor respondió ' + resp.status);

  const tipo = (resp.headers.get('Content-Type') || '').toLowerCase();
  if (!tipo.includes('html')) throw new Error('esa dirección no devuelve una página HTML');

  const d = {
    lang: '', title: '', desc: '', canonical: '', viewport: false,
    robotsMeta: '', h1: 0, imgs: 0, sinAlt: 0, jsonld: 0, favicon: false,
    og: {}, bytes: 0
  };

  await new HTMLRewriter()
    /* `limpio` porque este valor lo escribe la web analizada, que la elige un
       desconocido, y acaba dentro del informe. Un `lang` de 40 KB o con
       caracteres de control no aporta nada y sí ensucia todo lo que lo lea. */
    .on('html', { element: e => { d.lang = limpio(e.getAttribute('lang'), 35); } })
    .on('title', { text: t => { if (d.title.length < 300) d.title += t.text; } })
    .on('h1', { element: () => { d.h1++; } })
    .on('img', {
      element: e => {
        d.imgs++;
        const alt = e.getAttribute('alt');
        if (alt === null || alt.trim() === '') d.sinAlt++;
      }
    })
    .on('script', {
      element: e => {
        const t = (e.getAttribute('type') || '').toLowerCase();
        if (t === 'application/ld+json') d.jsonld++;
      }
    })
    .on('meta', {
      element: e => {
        const n = (e.getAttribute('name') || '').toLowerCase();
        const p = (e.getAttribute('property') || '').toLowerCase();
        const c = e.getAttribute('content') || '';
        if (n === 'description') d.desc = c;
        else if (n === 'viewport') d.viewport = true;
        else if (n === 'robots') d.robotsMeta = c.toLowerCase();
        else if (p.startsWith('og:')) d.og[p.slice(3)] = c;
      }
    })
    .on('link', {
      element: e => {
        const rel = (e.getAttribute('rel') || '').toLowerCase();
        if (rel.includes('canonical')) d.canonical = e.getAttribute('href') || '';
        if (rel.includes('icon')) d.favicon = true;
      }
    })
    .transform(new Response(
      resp.body ? cortar(resp.body, LIMITE_BYTES, n => { d.bytes = n; }) : ''
    ))
    .arrayBuffer();

  d.title = d.title.trim();

  /* Presupuesto propio para las auxiliares. Antes iban con `undefined` como
     señal y el reloj principal ya se había limpiado en el finally de arriba:
     un host hostil que acepta la conexión y no responde nunca dejaba DOS
     subpeticiones colgadas sin límite por cada petición entrante. */
  const auxCtl = new AbortController();
  const auxReloj = setTimeout(() => auxCtl.abort(), ESPERA_AUX_MS);
  let tieneRobots = false, tieneSitemap = false;
  try {
    [tieneRobots, tieneSitemap] = await Promise.all([
      existe(final, '/robots.txt', auxCtl.signal, presupuesto),
      existe(final, '/sitemap.xml', auxCtl.signal, presupuesto)
    ]);
  } finally {
    clearTimeout(auxReloj);
  }

  return puntua(d, final, ms, tieneRobots, tieneSitemap);
}

/** Trunca el cuerpo y va informando de cuántos bytes se han leído.
    El aviso va dentro de transform y no en flush: terminate() cierra el flujo
    sin llamar a flush, así que en las páginas grandes —justo las que interesa
    medir— el contador se habría quedado a cero. */
function cortar(cuerpo, tope, avisa) {
  let leidos = 0;
  return cuerpo.pipeThrough(new TransformStream({
    transform(trozo, ctl) {
      if (leidos >= tope) return;
      leidos += trozo.byteLength;
      avisa(leidos);
      ctl.enqueue(trozo);
      if (leidos >= tope) ctl.terminate();
    }
  }));
}

/* ---------- puntuación ----------
   Los pesos suman 100. Cada comprobación devuelve estado (ok / warn / bad), el
   hallazgo técnico en `detalle` y, cuando algo falla, su traducción al idioma
   de quien paga la web en `porque`.
   Esa segunda frase existe porque quien pide este diagnóstico no es
   programador: leer "faltan 40 caracteres en la meta description" no le dice
   si eso le cuesta dinero. La nota y los datos son los medidos —aquí no se
   infla nada—, pero se explican por sus consecuencias, que es lo único que
   permite decidir si vale la pena arreglarlo. En lo que ya funciona no se
   añade `porque`: repetirlo en los quince puntos convertiría la lista en ruido
   y enterraría justo lo que hay que leer. */
function puntua(d, url, ms, robots, sitemap) {
  const c = [];
  let total = 0;

  const añade = (peso, estado, titulo, detalle, porque) => {
    const fila = { estado, titulo, detalle };
    if (porque && estado !== 'ok') fila.porque = porque;
    c.push(fila);
    total += peso * (estado === 'ok' ? 1 : estado === 'warn' ? 0.5 : 0);
  };

  const https = url.protocol === 'https:';
  añade(6, https ? 'ok' : 'bad', 'Conexión segura',
    https ? 'El sitio se sirve por HTTPS.' : 'El sitio no usa HTTPS.',
    'El navegador avisa a tus clientes de que tu sitio «no es seguro» antes de que lean una sola palabra. Esa es su primera impresión de tu negocio.');

  const lt = d.title.length;
  añade(12, !lt ? 'bad' : (lt >= 30 && lt <= 65) ? 'ok' : 'warn', 'Título de la página',
    !lt ? 'No hay etiqueta title.'
      : lt < 30 ? 'Solo ' + lt + ' caracteres. Lo ideal son 30 a 65.'
      : lt > 65 ? lt + ' caracteres. Google lo corta en los resultados.'
      : lt + ' caracteres, dentro del rango que Google muestra entero.',
    !lt ? 'Es el titular azul que la gente ve en Google y el nombre de la pestaña. Sin él tu web aparece sin nombre, y nadie entra en algo que no sabe qué es.'
      : lt < 30 ? 'Es el espacio más valioso que tienes en Google —el titular por el que deciden entrar en tu web o en la de al lado— y lo estás usando a medias.'
      : 'Lo que Google recorta suele ser justo el final, que es donde acaba estando lo que te diferencia del resto.');

  const ld = d.desc.length;
  añade(12, !ld ? 'bad' : (ld >= 110 && ld <= 165) ? 'ok' : 'warn', 'Descripción en Google',
    !ld ? 'No hay meta description.'
      : ld < 110 ? 'Solo ' + ld + ' caracteres de los 165 disponibles.'
      : ld > 165 ? ld + ' caracteres. Se corta con puntos suspensivos.'
      : ld + ' caracteres, longitud correcta.',
    !ld ? 'Es tu anuncio gratis debajo del titular en Google. Si no lo escribes tú, Google recorta un trozo cualquiera de tu página, y casi nunca elige el que vende.'
      : ld < 110 ? 'Tienes dos líneas gratis para convencer a alguien que todavía no te conoce, y estás dejando la mitad en blanco.'
      : 'Tu frase se corta por la mitad y el cliente no llega a leer el motivo por el que debería elegirte a ti.');

  añade(10, d.h1 === 1 ? 'ok' : 'bad', 'Encabezado principal',
    d.h1 === 0 ? 'La página no tiene ningún H1.'
      : d.h1 === 1 ? 'Un único H1, como debe ser.'
      : 'Hay ' + d.h1 + ' encabezados H1. Debe haber exactamente uno.',
    d.h1 === 0 ? 'El H1 es el letrero de tu tienda. Google entra, no encuentra letrero y decide por su cuenta a qué te dedicas: casi siempre se equivoca.'
      : 'Con varios letreros a la vez Google no sabe cuál es el bueno y reparte la fuerza entre todos, así que ninguno acaba pesando.');

  añade(10, d.jsonld > 0 ? 'ok' : 'bad', 'Ficha de negocio en Google',
    d.jsonld > 0
      ? d.jsonld + ' bloque(s) de datos estructurados detectados.'
      : 'La página no declara datos estructurados.',
    'Es lo que hace que un negocio salga en Google con estrellas, teléfono, horario o precios. Sin esto apareces como un enlace de texto más, justo al lado de competidores que sí lo tienen.');

  const og = d.og.title && d.og.description && d.og.image;
  añade(8, og ? 'ok' : (d.og.title || d.og.image) ? 'warn' : 'bad', 'Cómo se ve al compartirla',
    og ? 'Vista previa completa: se verá bien en WhatsApp y LinkedIn.'
      : (d.og.title || d.og.image) ? 'La vista previa está incompleta: falta título, descripción o imagen.'
      : 'La página no define ninguna vista previa.',
    og ? '' : (d.og.title || d.og.image)
      ? 'La tarjeta que aparece al compartir tu web sale a medias, y una tarjeta a medias se abre mucho menos que una completa.'
      : 'Cuando alguien pasa tu web por WhatsApp aparece un enlace pelado, sin imagen ni título. Cada vez que ocurre pierdes un clic que ya tenías ganado.');

  const pctAlt = d.imgs ? Math.round((d.imgs - d.sinAlt) / d.imgs * 100) : 100;
  añade(8, !d.imgs ? 'warn' : pctAlt === 100 ? 'ok' : pctAlt >= 70 ? 'warn' : 'bad',
    'Descripción de las imágenes',
    !d.imgs ? 'No se detectó ninguna imagen en la página.'
      : d.sinAlt === 0 ? (d.imgs === 1 ? 'La única imagen está descrita.' : 'Las ' + d.imgs + ' imágenes están descritas.')
      : d.sinAlt + ' de ' + d.imgs + ' imágenes sin descripción.',
    !d.imgs ? 'Una página sin una sola imagen retiene peor: el visitante se queda menos tiempo, y Google mide ese tiempo.'
      : 'Google no ve fotos, lee su descripción. Sin ella tus productos no existen en Google Imágenes, y quien navega con lector de pantalla tampoco sabe qué hay ahí.');

  añade(6, d.canonical ? 'ok' : 'warn', 'Dirección oficial de la página',
    d.canonical ? 'La página declara su URL canónica.' : 'La página no declara cuál es su dirección oficial.',
    'Tu web se alcanza por varias direcciones a la vez (con y sin www, con y sin barra final). Google puede tratarlas como copias distintas y repartir entre todas la fuerza que debería ir a una sola.');

  añade(6, d.viewport ? 'ok' : 'bad', 'Adaptación a móvil',
    d.viewport ? 'La página está preparada para móvil.' : 'La página no declara adaptación a móvil.',
    'En el móvil tu web se ve encogida y hay que hacer zoom para leerla. Google mira primero la versión móvil para decidir tu posición, y la mayoría de tus clientes te busca desde ahí.');

  añade(5, robots ? 'ok' : 'bad', 'Instrucciones para buscadores',
    robots ? 'robots.txt accesible.' : 'No encontramos el archivo robots.txt.',
    'Es la hoja de instrucciones que leen los buscadores al llegar. Sin ella rastrean tu web a ciegas y gastan su tiempo en páginas que no te interesa posicionar.');

  añade(5, sitemap ? 'ok' : 'bad', 'Índice de tu web',
    sitemap ? 'sitemap.xml accesible.' : 'No encontramos el archivo sitemap.xml.',
    'Es el índice que le dice a Google qué páginas tienes. Sin él puede tardar semanas en enterarse de cada página nueva que publiques.');

  añade(5, ms < 800 ? 'ok' : ms < 2500 ? 'warn' : 'bad', 'Velocidad de respuesta',
    ms + ' ms en empezar a responder. ' + (ms < 800 ? 'Excelente.' : ms < 2500 ? 'Mejorable.' : 'Lento.'),
    'Cada segundo de espera se lleva visitas por delante: la gente cierra la pestaña antes de ver nada. Y Google usa ese tiempo para decidir en qué puesto te coloca.');

  añade(4, d.lang ? 'ok' : 'warn', 'Idioma declarado',
    d.lang ? 'La página declara el idioma "' + d.lang + '".' : 'La página no declara en qué idioma está.',
    'Sin declararlo, Google puede enseñar tu web a gente que no habla tu idioma, y el traductor del navegador se activa cuando no debería.');

  const kb = Math.round(d.bytes / 1024);
  añade(3, kb < 120 ? 'ok' : kb < 400 ? 'warn' : 'bad', 'Peso de la página',
    kb + ' KB de código. ' + (kb < 120 ? 'Ligera.' : kb < 400 ? 'Algo pesada.' : 'Muy pesada.'),
    'Cuanto más pesa el código, más tarda en aparecer algo en pantalla. En un móvil con datos, esa diferencia son clientes que se van antes de ver tu web.');

  /* Un noindex no baja la nota: la anula. Da igual lo bien hecho que esté todo
     lo demás si la página le está pidiendo a Google que la ignore. */
  if (d.robotsMeta.includes('noindex')) {
    c.unshift({
      estado: 'bad', titulo: 'Bloqueo de indexación',
      detalle: 'La página lleva puesta la orden «noindex».',
      porque: 'Tu propia web le está pidiendo a Google que no la muestre a nadie. Mientras esa orden siga ahí, da igual todo lo demás: no vas a aparecer.'
    });
    total = Math.min(total, 15);
  }

  return { url: url.href, score: Math.round(total), tiempoMs: ms, checks: c };
}

/* ---------- utilidades ---------- */

function json(cuerpo, estado, cabeceras) {
  return new Response(JSON.stringify(cuerpo), {
    status: estado,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      /* Estas dos no son burocracia: el informe incluye texto copiado de la web
         analizada —el atributo `lang`, por ejemplo— y esa web la elige un
         desconocido. El `Content-Type` ya impide que un navegador actual
         renderice esto como HTML; `nosniff` lo impide también en los que
         adivinan el tipo, y una política que no permite nada cierra el resto.
         Coste de compatibilidad: ninguno. Un JSON no carga nada. */
      'X-Content-Type-Options': 'nosniff',
      'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
      ...cabeceras
    }
  });
}

/**
 * Registro propio, deliberadamente pobre.
 *
 * Los invocation logs de la plataforma están DESACTIVADOS en wrangler.toml
 * porque guardan la IP del visitante y la URL completa durante días, que es
 * justo lo que este Worker se esfuerza en no almacenar. Pero apagarlos sin más
 * dejaría ciega la operación, así que se escribe lo mínimo para saber si algo
 * va mal y nada para saber quién pidió qué.
 *
 * Lo que NUNCA entra aquí: IP, seudónimo, token de Turnstile, sal, secretos, y
 * la URL analizada completa —del destino sólo el host, que basta para ver si un
 * dominio concreto está dando guerra y no lleva ni ruta ni parámetros—.
 */
function registra(evento, extra) {
  try {
    console.log(JSON.stringify({ evento, ...(extra || {}) }));
  } catch {
    /* Un fallo escribiendo un log no puede tumbar una petición. */
  }
}

/**
 * Redondea la espera HACIA ARRIBA a múltiplos de 10 s.
 *
 * El valor exacto sale de la marca más antigua de la ventana, así que en una IP
 * compartida —una oficina, un CGNAT— le contaba a quien recibe el 429 cuándo
 * pidió algo un tercero, con precisión de segundo. Redondear al alza lo
 * convierte en un dato grueso sin romper nada: el invariante que importa es que
 * el valor devuelto NUNCA sea menor que la espera real, porque si lo fuera el
 * cliente reintentaría antes de tiempo y se llevaría otro 429.
 */
function esperaRedondeada(segundos) {
  const s = Number(segundos);
  if (!Number.isFinite(s) || s <= 0) return 60;
  return Math.min(60, Math.ceil(s / 10) * 10);
}

/** Recorta texto traído de la web analizada antes de devolverlo en el informe.
 *  Va sobre el valor, no sobre la presentación: el informe lo consume nuestro
 *  frontend, pero también curl y cualquier integración futura. */
function limpio(s, tope = 100) {
  return String(s || '').replace(/[\u0000-\u001F\u007F<>]/g, '').slice(0, tope);
}

/* Lista blanca de mensajes. El criterio está invertido a propósito respecto a
   como estaba: antes se devolvía `e.message` para todo lo que NO casara con una
   lista de patrones prohibidos, así que cualquier error nuevo del runtime salía
   tal cual al exterior. Eso no es teórico: un destino con credenciales
   incrustadas hace que el runtime lance un TypeError cuyo texto incluye la URL
   entera —contraseña incluida—, y ese cuerpo se cachea públicamente cinco
   minutos. Con lista blanca, lo que no reconocemos no sale. */
const MENSAJES_PROPIOS = new Set([
  'solo se admiten direcciones http y https',
  'solo se analizan sitios publicados en los puertos web habituales',
  'no se admiten direcciones con usuario y contraseña incrustados',
  'no se pueden analizar direcciones internas',
  'no se admiten direcciones IPv6 literales',
  'dirección IP no válida',
  'no se pueden analizar direcciones de red privada',
  'eso no parece un dominio público',
  'ese sitio encadena demasiadas redirecciones',
  'esa dirección no devuelve una página HTML',
  'no se pudo conectar con ese dominio; comprueba que la dirección existe y responde'
]);

function mensaje(e) {
  if (e.name === 'AbortError')
    return 'el sitio tardó más de ' + (ESPERA_MS / 1000) + ' segundos en responder';
  const m = (e && e.message) || '';
  if (MENSAJES_PROPIOS.has(m)) return m;
  if (/^el servidor respondió \d{3}$/.test(m)) return m;
  return 'no se pudo conectar con ese dominio; comprueba que la dirección existe y responde';
}
