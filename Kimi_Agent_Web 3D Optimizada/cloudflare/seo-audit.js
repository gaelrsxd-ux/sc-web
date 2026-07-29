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

/* Orígenes que pueden llamar al Worker. Si no está en la lista, no hay CORS y
   el navegador bloquea la respuesta: evita que el endpoint acabe siendo el
   auditor gratuito de terceros a costa de nuestra cuenta. */
const ORIGENES = [
  'https://sycsolutions.company',
  'https://www.sycsolutions.company',
  /* Mientras no hay dominio propio, el sitio vive en Cloudflare Pages. Esta es
     la URL de producción del proyecto (rama principal), estable entre
     despliegues; las URLs de previsualización con hash cambian en cada
     `wrangler pages deploy` y no se pueden fijar aquí de antemano. */
  'https://syc-solutions.pages.dev',
  'http://localhost:8080',
  'http://127.0.0.1:8080'
];

const LIMITE_BYTES = 1_500_000;   /* deja de leer al superar millón y medio */
const ESPERA_MS    = 12_000;      /* un sitio que tarda más ya suspende solo */
const SALTOS_MAX   = 3;           /* redirecciones que seguimos a mano */

export default {
  async fetch(peticion) {
    const origen = peticion.headers.get('Origin') || '';
    const cors = {
      'Access-Control-Allow-Origin': ORIGENES.includes(origen) ? origen : ORIGENES[0],
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

    const veto = inseguro(destino);
    if (veto) return json({ error: veto }, 400, cors);

    /* Cachea el resultado una hora. Un mismo sitio analizado en bucle deja de
       costar peticiones salientes, que es el abuso más probable aquí. */
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

    let informe;
    try {
      informe = await analiza(destino);
    } catch (e) {
      return json({ error: mensaje(e) }, 502, cors);
    }

    const salida = json(informe, 200, cors);
    salida.headers.set('Cache-Control', 'public, max-age=3600');
    await caches.default.put(clave, salida.clone());
    return salida;
  }
};

/* ---------- red ---------- */

/** Rechaza destinos que no deben alcanzarse desde el borde. */
function inseguro(u) {
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    return 'solo se admiten direcciones http y https';

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
        (a === 100 && b >= 64 && b <= 127))
      return 'no se pueden analizar direcciones de red privada';
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

/** Comprueba que un recurso auxiliar existe, sin descargarlo entero. */
async function existe(base, ruta, señal) {
  try {
    const { r } = await trae(new URL(ruta, base), señal, 'GET');
    return r.status >= 200 && r.status < 300;
  } catch {
    return false;
  }
}

/* ---------- análisis ---------- */

async function analiza(url) {
  const ctl = new AbortController();
  const reloj = setTimeout(() => ctl.abort(), ESPERA_MS);
  const t0 = Date.now();

  let resp, final;
  try {
    ({ r: resp, final } = await trae(url, ctl.signal));
  } finally {
    clearTimeout(reloj);
  }
  const ms = Date.now() - t0;

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

  const [tieneRobots, tieneSitemap] = await Promise.all([
    existe(final, '/robots.txt', undefined),
    existe(final, '/sitemap.xml', undefined)
  ]);

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
