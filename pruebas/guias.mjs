/* Las guías responden preguntas para que las citen: personas, buscadores y, sobre
   todo, sistemas de IA. Este archivo vigila lo que hace que eso funcione y que se
   rompe en silencio — un canonical mal puesto o un JSON-LD que no parsea no se ve
   mirando la página, y nadie se entera hasta que la guía lleva meses sin aparecer
   en ninguna parte.

   No mide posicionamiento: eso no se puede medir desde aquí y tarda semanas. Mide
   que las condiciones estén puestas. */
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const B = process.env.BASE || 'http://127.0.0.1:8099';
const APP = 'Kimi_Agent_Web 3D Optimizada/app';
let fallos = 0;
const ok = (c, t) => { if (!c) fallos++; console.log((c ? '  ok    ' : '  FALLA ') + t); };

/* La lista sale de tools/precios.mjs, que es quien manda: si alguien añade una
   guía allí y no la escribe, esto lo dice. */
const fuente = fs.readFileSync('tools/precios.mjs', 'utf8');
const GUIAS = [...fuente.matchAll(/archivo:\s*'(guia-[a-z0-9-]+\.html)'/g)].map(m => m[1]);
ok(GUIAS.length >= 5, `tools/precios.mjs declara ${GUIAS.length} guías`);

const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
const err = [];

/* ---- el sitemap y la tarjeta de las IAs las conocen ---- */
const sitemap = fs.readFileSync(path.join(APP, 'sitemap.xml'), 'utf8');
const llms = fs.readFileSync(path.join(APP, 'llms.txt'), 'utf8');
for (const g of GUIAS) {
  const slug = g.replace(/\.html$/, '');
  ok(sitemap.includes(`/${slug}<`), `${slug} está en el sitemap`);
  ok(llms.includes(`/${slug})`), `${slug} está en llms.txt`);
}

/* ---- y ninguna es huérfana: la enlaza la portada o el índice /guias,
   que a su vez cuelga de la portada (se comprueba más abajo). ---- */
const portada = fs.readFileSync(path.join(APP, 'index.html'), 'utf8');
const indice = fs.readFileSync(path.join(APP, 'guias.html'), 'utf8');
for (const g of GUIAS) ok(portada.includes(`href="${g}"`) || indice.includes(`href="${g}"`),
  `la portada o el índice enlazan a ${g}`);

/* Las frases que la gente teclea de verdad (autocompletado de Google, México,
   septiembre de 2026). Cada guía prioritaria tiene que llevarlas en el título o
   en el h1; si alguien las «mejora» por estilo, esto lo dice. */
const FRASES = {
  'guia-diseno-web-san-luis-potosi':     [/p[áa]ginas web/i, /San Luis Potos/i, /dise[ñn]o/i],
  'guia-precio-pagina-web':              [/cu[áa]nto cuesta una p[áa]gina web/i, /M[ée]xico/i],
  'guia-mas-resenas-google':             [/conseguir m[áa]s rese[ñn]as en Google/i],
  'guia-placas-nfc-resenas':             [/placa nfc/i, /rese[ñn]as de Google/i, /producto/i],
  'guia-negocio-en-google-maps':         [/configurar Google Business Profile/i, /Google Maps/i],
  'guia-como-aparecer-en-google':        [/mi negocio aparezca en Google/i],
  'guia-aparecer-primero-google-maps':   [/primero en Google Maps/i],
  'guia-negocio-no-aparece-google-maps': [/no aparece en Google Maps/i],
  'guia-codigo-qr-resenas-google':       [/c[óo]digo QR/i, /rese[ñn]as de Google/i],
  'guia-automatizar-whatsapp-business':  [/automatizar WhatsApp Business/i],
};
/* A dónde puede llevar el botón de arriba: sólo a páginas que venden. */
const DESTINOS = ['web.html', 'pedido.html', 'servicio.html', 'ia.html', 'automatizacion.html'];

for (const g of GUIAS) {
  const slug = g.replace(/\.html$/, '');
  console.log(`\n── ${slug}`);
  const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
  pg.on('pageerror', e => err.push(`${slug}: ${e.message}`));
  const r = await pg.goto(`${B}/${g}`, { waitUntil: 'domcontentloaded' });
  ok(r.status() === 200, `responde 200`);
  /* La hoja de estilos llega después del DOM y no hay scripts que la esperen:
     lo que dependa de CSS (la barra oculta en escritorio) se mira tras «load». */
  await pg.waitForLoadState('load');

  const meta = await pg.evaluate(() => ({
    titulo: document.title,
    desc: document.querySelector('meta[name=description]')?.content || '',
    robots: document.querySelector('meta[name=robots]')?.content || '',
    canonical: document.querySelector('link[rel=canonical]')?.href || '',
    h1: document.querySelectorAll('h1').length,
    h1t: document.querySelector('h1')?.textContent.trim() || '',
    resp: document.querySelector('.respuesta')?.textContent.replace(/\s+/g, ' ').trim() || '',
    precio: document.querySelector('.guia-precio')?.textContent.replace(/\s+/g, ' ').trim() || '',
    fuentes: [...document.querySelectorAll('.fuentes a')].map(a => a.href),
    otras: [...document.querySelectorAll('.otras a')].map(a => a.getAttribute('href')),
    ld: [...document.querySelectorAll('script[type="application/ld+json"]')].map(s => s.textContent),
    faqVis: document.querySelectorAll('.preguntas details').length,
    cta: document.querySelector('.guia-cta .gc-wa')?.href || '',
    prosa: document.querySelector('main')?.innerText || '',
    og: document.querySelector('meta[property="og:image"]')?.content || '',
    firma: document.querySelector('.firma')?.textContent.replace(/\s+/g, ' ') || '',
    accion: (() => {
      const a = document.querySelector('.accion'); if (!a) return null;
      const h2 = document.querySelector('main h2');
      return {
        antesDelPrimerH2: !!h2 && (a.compareDocumentPosition(h2) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
        ir: a.querySelector('.ac-ir')?.getAttribute('href') || '',
        irTxt: a.querySelector('.ac-ir')?.textContent.trim() || '',
        wa: a.querySelector('.ac-wa')?.href || '',
        prueba: a.querySelector('.ac-prueba')?.textContent.replace(/\s+/g, ' ').trim() || '',
        pruebaHref: a.querySelector('.ac-prueba a')?.getAttribute('href') || '',
      };
    })(),
    clientes: [...document.querySelectorAll('.clientes .cl-fila img')].map(i => ({ src: i.getAttribute('src'), alt: i.alt })),
    clientesHref: [...document.querySelectorAll('.clientes a')].map(a => a.getAttribute('href')),
    barra: { ir: document.querySelector('.barra-fija .bf-ir')?.getAttribute('href') || '',
             wa: document.querySelector('.barra-fija .bf-wa')?.href || '' },
    barraCaja: document.querySelector('.barra-fija')?.getBoundingClientRect().height || 0,
  }));

  /* ---- la frase buscada, en el título o en el h1 ---- */
  for (const re of FRASES[slug] || []) ok(re.test(meta.titulo + ' ' + meta.h1t), `título/h1 llevan ${re}`);

  ok(meta.h1 === 1, `un solo <h1> (hay ${meta.h1})`);
  ok(meta.canonical === `https://sycsolutions.company/${slug}`, `canonical correcto: ${meta.canonical}`);
  ok(/index/.test(meta.robots) && !/noindex/.test(meta.robots), `indexable: «${meta.robots}»`);
  ok(meta.titulo.length >= 25 && meta.titulo.length <= 75, `título de ${meta.titulo.length} caracteres`);
  /* 160 y no 185: por encima de eso Google corta, y lo que se pierde es
     siempre el final, que es donde suele estar el gancho. */
  ok(meta.desc.length >= 90 && meta.desc.length <= 160, `descripción de ${meta.desc.length} caracteres`);

  /* ⚠ LO QUE DE VERDAD HACE QUE UNA IA LA CITE. Se midió que una cifra concreta
     en la respuesta sube las citas más que cualquier ajuste técnico. La
     respuesta va arriba del todo y tiene que traer un número. */
  ok(/\d/.test(meta.resp), 'la respuesta de arriba trae una cifra');
  ok(meta.resp.length >= 120, `y responde de verdad (${meta.resp.length} caracteres)`);

  /* La descripción también: es lo que se lee en el resultado sin entrar. */
  ok(/\d/.test(meta.desc), 'la meta descripción también trae una cifra');
  /* Un precio en la descripción caduca el día que cambie la tabla, y la
     descripción no la reescribe nadie. Cifras sí; precios propios, no. */
  ok(!/\$\d/.test(meta.desc), 'y ningún precio propio escrito a mano en ella');

  /* Fuentes primarias enlazadas: el otro factor que se midió. */
  ok(meta.fuentes.length >= 3, `cita ${meta.fuentes.length} fuentes con enlace`);
  ok(meta.fuentes.every(u => /^https:\/\//.test(u)), 'y todas apuntan fuera por https');

  /* Enlaces a las guías de su tema y al índice: sin ellos cada una es una isla. */
  ok(meta.otras.length >= 3, `enlaza a ${meta.otras.length} guías de su tema`);
  ok(meta.otras.includes('guias.html'), 'y al índice /guias');

  /* El precio, escrito por la tabla. */
  ok(/\$[\d,]+/.test(meta.precio), `el recuadro de precio trae cifra: «${meta.precio.slice(0, 60)}…»`);

  /* ---- los datos estructurados ---- */
  ok(meta.ld.length === 3, `${meta.ld.length} bloques JSON-LD`);
  let tipos = [], articulo = null;
  for (const t of meta.ld) {
    let d; try { d = JSON.parse(t); } catch { ok(false, 'un JSON-LD NO PARSEA'); continue; }
    tipos.push(d['@type']);
    if (d['@type'] === 'Article') articulo = d;
  }
  ok(tipos.includes('Article') && tipos.includes('FAQPage') && tipos.includes('BreadcrumbList'),
     `tipos: ${tipos.join(', ')}`);
  if (articulo) {
    ok(!!articulo.datePublished && !!articulo.dateModified, `lleva fechas (${articulo.datePublished})`);
    ok(!!articulo.author?.name, `lleva autor (${articulo.author?.name})`);
    ok((articulo.citation || []).length >= 3, `el esquema declara ${(articulo.citation || []).length} fuentes`);
    ok(articulo.headline === meta.h1t, 'el headline del esquema es el <h1> de la página');
  }
  const faq = meta.ld.map(t => { try { return JSON.parse(t); } catch { return {}; } })
                     .find(d => d['@type'] === 'FAQPage');
  ok((faq?.mainEntity || []).length >= 3, `${(faq?.mainEntity || []).length} preguntas en el esquema`);
  const vacias = (faq?.mainEntity || []).filter(q => !q.acceptedAnswer?.text?.trim());
  ok(vacias.length === 0, 'ninguna pregunta del esquema se queda sin respuesta');
  /* ⚠ Un FAQPage cuyas preguntas no se ven en la página es marcado engañoso
     para Google. Las visibles y las del esquema salen de la misma lista, y
     aquí se comprueba que sigan siendo las mismas. */
  ok(meta.faqVis === (faq?.mainEntity || []).length, `las ${meta.faqVis} preguntas del esquema se ven en la página`);
  /* La llamada a la acción: WhatsApp con el mensaje escrito para esta guía. */
  ok(/^https:\/\/wa\.me\/\d{10,15}\?text=./.test(meta.cta), 'el botón abre WhatsApp con un mensaje ya escrito');
  ok(meta.cta.includes('gu%C3%ADa') || /gu%C3%ADa|guia/i.test(meta.cta), 'y el mensaje dice de qué guía viene');
  /* Las cifras de la prosa las escribe la tabla; «$0» es el marcador sin resolver. */
  ok(!/\$0\b/.test(meta.prosa), 'ninguna cifra de precio quedó sin generar');

  /* ⚠ LA ACCIÓN VA ARRIBA. El 57% del tiempo de lectura se queda en la primera
     pantalla (NN/g) y la mitad de los lectores no pasa de la mitad (Chartbeat):
     el botón de comprar o de WhatsApp tiene que existir antes del primer h2. */
  ok(!!meta.accion, 'hay un bloque de acción');
  if (meta.accion) {
    ok(meta.accion.antesDelPrimerH2, 'y está antes del primer h2 del artículo');
    ok(DESTINOS.includes(meta.accion.ir), `el botón lleva a una página que vende: ${meta.accion.ir}`);
    const rd = await pg.request.get(`${B}/${meta.accion.ir}`);
    ok(rd.status() === 200, `y esa página responde ${rd.status()}`);
    ok(meta.accion.irTxt.length >= 6, `con texto propio: «${meta.accion.irTxt}»`);
    ok(meta.accion.wa === meta.cta, 'el WhatsApp de arriba abre con el mismo mensaje de la guía');
    ok(/Kabuki|Podol|Seminuevos/.test(meta.accion.prueba) && meta.accion.pruebaHref === '/#clientes',
       'y al lado, clientes con nombre que llevan a las fotos');
  }
  ok(meta.barra.ir === meta.accion?.ir && meta.barra.wa === meta.cta, 'la barra fija repite los dos destinos');
  ok(meta.barraCaja === 0, 'y en escritorio no se enseña');

  /* Prueba de trabajo real: fotos que existen y llevan a la portada. */
  ok(meta.clientes.length >= 3, `${meta.clientes.length} fotos de clientes`);
  for (const c of meta.clientes) {
    const ri = await pg.request.get(`${B}/${c.src}`);
    ok(ri.status() === 200 && /San Luis/.test(c.alt), `foto ${c.src.replace(/^assets\//, '')} carga y su alt dice dónde`);
  }
  ok(meta.clientesHref.length > 0 && meta.clientesHref.every(h => h === '/#clientes'), 'todas llevan a /#clientes');
  ok(/id="clientes"/.test(portada), 'y la portada tiene esa ancla');

  /* Entidad: quién escribe, qué hace y dónde. Es lo que una IA asocia al nombre. */
  ok(/S&C Solutions/.test(meta.firma) && /p[áa]ginas web/i.test(meta.firma) && /San Luis Potos/.test(meta.firma) && /M[ée]xico/.test(meta.firma),
     'la firma dice quién es, qué hace y dónde');
  ok(/^https:\/\/sycsolutions\.company\/assets\//.test(meta.og), `og:image para compartir por WhatsApp: ${meta.og.split('/').pop()}`);
  if (articulo) ok(Array.isArray(articulo.image) && articulo.image.length > 0, 'el Article declara imagen');

  await pg.close();

  /* ---- en el celular, que es desde donde entra casi todo el mundo ---- */
  const mv = await b.newPage({ viewport: { width: 390, height: 844 } });
  mv.on('pageerror', e => err.push(`${slug} (móvil): ${e.message}`));
  await mv.goto(`${B}/${g}`, { waitUntil: 'load' });
  const cajaIr = await mv.locator('.accion .ac-ir').boundingBox();
  ok(!!cajaIr && cajaIr.y + cajaIr.height <= 844 * 1.35,
     `el botón de comprar queda a ${cajaIr ? Math.round(cajaIr.y) : '?'}px: antes de pantalla y media`);
  const barra = await mv.locator('.barra-fija').boundingBox();
  ok(!!barra && Math.abs(barra.y + barra.height - 844) <= 1 && barra.width >= 388,
     `la barra fija está pegada abajo (${barra ? Math.round(barra.y) : '?'}px)`);
  await mv.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'instant' }));
  await mv.waitForTimeout(150);
  const barra2 = await mv.locator('.barra-fija').boundingBox();
  const pie = await mv.locator('footer small').boundingBox();
  ok(!!barra2 && Math.abs(barra2.y + barra2.height - 844) <= 1, 'y sigue ahí al final del artículo');
  ok(!!pie && !!barra2 && pie.y + pie.height <= barra2.y, 'sin tapar el pie de página');
  await mv.close();
}

/* ---- el índice: existe, lista todas, y la portada y el pie lo enlazan ---- */
console.log('\n── guias (índice)');
{
  const pi = await b.newPage({ viewport: { width: 1280, height: 900 } });
  const r = await pi.goto(`${B}/guias.html`, { waitUntil: 'domcontentloaded' });
  ok(r.status() === 200, 'responde 200');
  const enlaces = await pi.locator('.indice-guias a').evaluateAll(as => as.map(a => a.getAttribute('href')));
  for (const g of GUIAS) ok(enlaces.includes(g), `lista ${g}`);
  ok(await pi.locator('h1').count() === 1, 'un solo h1');
  const ld = await pi.locator('script[type="application/ld+json"]').first().textContent();
  let d = null; try { d = JSON.parse(ld); } catch {}
  ok(d && d['@type'] === 'CollectionPage' && d.mainEntity?.numberOfItems === GUIAS.length,
     `CollectionPage con ${d?.mainEntity?.numberOfItems} elementos`);
  ok(sitemap.includes('/guias<'), 'está en el sitemap');
  ok(portada.includes('href="guias.html"'), 'la portada enlaza al índice');
  await pi.close();
}

/* ---- sin JavaScript: los rastreadores de IA no lo ejecutan ----
   ⚠ ESTA ES LA COMPROBACIÓN QUE JUSTIFICA EL ARCHIVO. GPTBot, ClaudeBot y
   PerplexityBot leen el HTML crudo y se van: no esperan, no reintentan, no
   ejecutan un script. Una guía cuyo texto lo pintara JavaScript sería invisible
   para ellos y nadie se daría cuenta mirando la pantalla. */
console.log('\n── sin JavaScript (así la ven GPTBot, ClaudeBot y PerplexityBot)');
const sin = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
for (const g of GUIAS) {
  const p2 = await sin.newPage();
  await p2.goto(`${B}/${g}`, { waitUntil: 'load' });
  const v = await p2.evaluate(() => ({
    resp: document.querySelector('.respuesta')?.textContent.replace(/\s+/g, ' ').trim() || '',
    precio: document.querySelector('.guia-precio')?.textContent.replace(/\s+/g, ' ').trim() || '',
    ld: document.querySelectorAll('script[type="application/ld+json"]').length,
    palabras: document.querySelector('main').innerText.split(/\s+/).filter(Boolean).length,
  }));
  ok(/\d/.test(v.resp) && v.resp.length >= 120, `${g.replace(/\.html$/, '')}: la respuesta está en el HTML crudo`);
  ok(/\$[\d,]+/.test(v.precio), '  y el precio también');
  ok(v.ld === 3, '  y los tres JSON-LD');
  ok(v.palabras >= 400, `  y el texto entero: ${v.palabras} palabras`);
  await p2.close();
}

console.log(err.length ? '\nERRORES DE JS: ' + err.join(' | ') : '\nsin errores de JavaScript');
if (err.length) fallos++;
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
await b.close();
process.exit(fallos ? 1 : 0);
