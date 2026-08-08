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

export default {
  async fetch(peticion, env, ctx) {
    const dev = env && env.ENTORNO === 'dev';
    const permitidos = dev ? [...ORIGENES, ...ORIGENES_DEV] : ORIGENES;
    const origen = peticion.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': permitidos.includes(origen) ? origen : permitidos[0],
      'Access-Control-Allow-Methods': 'GET, OPTIONS',
      'Access-Control-Max-Age': '86400',
      'Vary': 'Origin'
    };

    if (peticion.method === 'OPTIONS') return new Response(null, { headers: cors });
    if (peticion.method !== 'GET') return json({ error: 'método no permitido' }, 405, cors);

    const cruda = new URL(peticion.url).searchParams.get('url');
    if (!cruda) return json({ error: 'falta el parámetro url' }, 400, cors);

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

    /* La caché va ANTES del limitador: servir un informe ya calculado no cuesta
       peticiones salientes, así que no tiene sentido penalizarlo.

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

    /* Limitador por IP. Es la única barrera real contra el abuso: sin él,
       recorrer miles de dominios distintos nunca toca caché y cada intento son
       peticiones salientes reales facturadas a nuestra cuenta. */
    const ip = peticion.headers.get('CF-Connecting-IP') || 'desconocida';
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
    if (permitido) permitido = await dentroDelTope(ip, ctx);

    if (!permitido) {
      return json(
        { error: 'demasiados análisis seguidos; espera un minuto e inténtalo de nuevo' },
        429,
        { ...cors, 'Retry-After': '60' }
      );
    }

    let informe;
    try {
      informe = await analiza(destino);
    } catch (e) {
      /* Los errores TAMBIÉN se cachean. Antes no, y ese era el agujero: apuntar
         a dominios inexistentes o que no devuelven HTML nunca tocaba caché, así
         que cada intento provocaba peticiones salientes reales. Amplificación
         de 1 entrante a 3 salientes, indefinidamente. */
      const fallo = json({ error: mensaje(e) }, 502, cors);
      fallo.headers.set('Cache-Control', 'public, max-age=' + CACHE_ERR_S);
      if (ctx) ctx.waitUntil(caches.default.put(clave, fallo.clone()));
      return fallo;
    }

    const salida = json(informe, 200, cors);
    salida.headers.set('Cache-Control', 'public, max-age=' + CACHE_OK_S);
    /* waitUntil en vez de await: guardar en caché no debe retrasar la respuesta
       que ya está lista. */
    if (ctx) ctx.waitUntil(caches.default.put(clave, salida.clone()));
    else await caches.default.put(clave, salida.clone());
    return salida;
  }
};

/* ---------- límite de uso ---------- */

const TOPE_POR_VENTANA = 20;   /* análisis nuevos por IP y minuto */

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
async function dentroDelTope(ip, ctx) {
  try {
    const ventana = Math.floor(Date.now() / 60000);
    const clave = new Request(
      'https://cache.local/rl?ip=' + encodeURIComponent(ip) + '&v=' + ventana
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

/** Rechaza destinos que no deben alcanzarse desde el borde.
 *
 *  Nota sobre codificaciones alternativas (http://2130706433/, 0x7f000001,
 *  127.1): no son un bypass porque el parser de `new URL()` normaliza IPv4 a
 *  cuádruple con puntos en los esquemas especiales antes de que la expresión
 *  regular de abajo lo vea. Se documenta porque es una dependencia implícita
 *  del parser: si esta función se reutiliza sobre un string crudo, o en un
 *  runtime con otro parser, deja de ser cierto. Valida siempre sobre
 *  `url.hostname` ya normalizado, nunca sobre el texto original. */
function inseguro(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return 'solo se admiten direcciones http y https';

  /* Puerto: solo el estándar de cada esquema. Sin esta comprobación el Worker
     responde de forma distinguible según el destino esté abierto, cerrado o no
     devuelva HTML —y además publica `tiempoMs`—, lo que lo convierte en un
     escáner de puertos semiciego contra cualquier host público. */
  if (u.port !== '' && u.port !== '80' && u.port !== '443')
    return 'solo se analizan sitios publicados en los puertos web habituales';

  const h = u.hostname.toLowerCase().replace(/\.$/, '');

  if (h === 'localhost' || h.endsWith('.localhost') ||
      h.endsWith('.local') || h.endsWith('.internal') || h.endsWith('.home.arpa'))
    return 'no se pueden analizar direcciones internas';

  /* IPv6 literal: descartado entero. Las formas comprimidas y las direcciones
     mapeadas de IPv4 dan demasiadas maneras de escribir ::1 como para filtrar
     con confianza, y ningún sitio real que auditemos se publica así. */
  if (h.includes(':') || u.href.includes('['))
    return 'no se admiten direcciones IPv6 literales';

  const ip = h.match(/^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/);
  if (ip) {
    const [a, b] = [+ip[1], +ip[2]];
    if (ip.slice(1).some(n => +n > 255)) return 'dirección IP no válida';
    if (a === 0 || a === 10 || a === 127 || a >= 224 ||
        (a === 172 && b >= 16 && b <= 31) ||
        (a === 192 && b === 168) ||
        (a === 169 && b === 254) ||
        (a === 100 && b >= 64 && b <= 127) ||
        /* Rangos que faltaban: benchmarking (198.18/15), IETF protocol
           assignments (192.0.0/24) y las tres TEST-NET de documentación. */
        (a === 198 && b >= 18 && b <= 19) ||
        (a === 192 && b === 0) ||
        (a === 198 && b === 51) ||
        (a === 203 && b === 0))
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

/** Sigue las redirecciones a mano validando cada salto. */
async function trae(url, señal, metodo = 'GET') {
  let actual = url, saltos = 0;
  while (true) {
    const r = await fetch(actual.href, {
      method: metodo,
      redirect: 'manual',
      signal: señal,
      headers: {
        'User-Agent': 'SYC-SEO-Audit/1.0 (+https://sycsolutions.company/#diagnostico)',
        'Accept': 'text/html,application/xhtml+xml'
      }
    });
    if (r.status < 300 || r.status > 399) return { r, final: actual };
    const sig = r.headers.get('Location');
    if (!sig || ++saltos > SALTOS_MAX) return { r, final: actual };
    const nueva = new URL(sig, actual);
    const veto = inseguro(nueva);
    if (veto) throw new Error(veto);
    actual = nueva;
  }
}

/** Comprueba que un recurso auxiliar existe, sin descargarlo entero.
    Antes el comentario decía esto mismo pero el cuerpo se quedaba abierto y sin
    tope: un /robots.txt de 2 GB se descargaba entero. Ahora se cancela nada más
    conocer el estado, que es lo único que interesa. */
async function existe(base, ruta, señal) {
  try {
    const { r } = await trae(new URL(ruta, base), señal, 'GET');
    if (r.body) { try { await r.body.cancel(); } catch { /* ya cerrado */ } }
    return r.status >= 200 && r.status < 300;
  } catch {
    return false;
  }
}

/* ---------- análisis ---------- */

async function analiza(url) {
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), ESPERA_MS);
  try {
    return await analizaConSeñal(url, ctl.signal);
  } finally {
    /* El reloj se limpia cuando TODO ha terminado, no al recibir las cabeceras.
       Antes se limpiaba tras `trae`, así que la lectura del cuerpo quedaba sin
       límite: un servidor que envía un byte por minuto mantenía la petición
       abierta indefinidamente sin llegar nunca al tope de bytes. */
    clearTimeout(reloj);
  }
}

async function analizaConSeñal(url, señal) {
  const t0 = Date.now();
  const { r: resp, final } = await trae(url, señal);
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
    .on('html', { element: e => { d.lang = e.getAttribute('lang') || ''; } })
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
      existe(final, '/robots.txt', auxCtl.signal),
      existe(final, '/sitemap.xml', auxCtl.signal)
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
    headers: { 'Content-Type': 'application/json; charset=utf-8', ...cabeceras }
  });
}

/* Los fallos de red del runtime llegan como "internal error; reference = …".
   Eso no le dice nada a quien lo lee y además saca a la vista un identificador
   interno, así que se traduce a la causa real: el dominio no responde. */
function mensaje(e) {
  if (e.name === 'AbortError')
    return 'el sitio tardó más de ' + (ESPERA_MS / 1000) + ' segundos en responder';
  const m = e.message || '';
  if (!m || /internal error|reference\s*=|connection (lost|refused)|resolve|ENOTFOUND|ECONNRESET|certificate|SSL|TLS/i.test(m))
    return 'no se pudo conectar con ese dominio; comprueba que la dirección existe y responde';
  return m;
}
