/* Las cuatro páginas de servicio como PÁGINAS QUE RESPONDEN, no sólo como
   pantallas de cobro: lo que tiene que ser cierto para que salgan cuando
   alguien busca o le pregunta a una IA, y para que lo que citen sea lo que la
   web cobra.
     · son indexables: sin «noindex», con canónica, título con lo que se hace
       y descripción con hechos;
     · el esquema Service/Offer dice el precio del catálogo del Worker, que es
       lo que se cobra —y el de Google, los dos paquetes—;
     · las preguntas visibles y las del esquema FAQPage son las mismas, en el
       mismo orden y con el mismo texto (Google penaliza que difieran);
     · la sección de precio dice el precio, el anticipo y el plazo de la tabla;
     · ninguna ancla interna apunta al vacío, y el enlace a los términos cae en
       el apartado de ese paquete;
     · están en el sitemap y en llms.txt.
   Se corre igual que las otras:
     node servidor.js 8099 &
     node pruebas/contenido.mjs                                               */
import { chromium } from 'playwright';
import { readFileSync } from 'node:fs';
const BASE = process.env.BASE || 'http://127.0.0.1:8099';
const app = p => new URL('../Kimi_Agent_Web 3D Optimizada/app/' + p, import.meta.url);
const TABLA    = JSON.parse(readFileSync(new URL('../Kimi_Agent_Web 3D Optimizada/cloudflare/pagos/paquetes.json', import.meta.url), 'utf8'));
const SITEMAP  = readFileSync(app('sitemap.xml'), 'utf8');
const LLMS     = readFileSync(app('llms.txt'), 'utf8');
const TERMINOS = readFileSync(app('terminos.html'), 'utf8');
const miles = n => n.toLocaleString('en-US');
/* Contado y sin placas: las filas base de cada familia, que son las que el
   esquema anuncia. Las de anticipo son filas aparte del catálogo, con
   «· anticipo» en el nombre; las de placas llevan `placas`. */
const nom = p => p.base || p.nombre;
const esAnticipo = p => /· anticipo$/.test(nom(p));
const base = f => TABLA.paquetes.filter(p => p.familia === f && !esAnticipo(p) && !p.placas);
const anticipoDe = fila => TABLA.paquetes.find(p => p.familia === fila.familia && !p.placas && esAnticipo(p) && nom(p).startsWith(nom(fila)));

const PAGINAS = [
  { pagina: 'web.html',            f: 'web',    terminos: 'sitio-web',     titulo: /p[áa]gina web/i,   ciudad: true },
  { pagina: 'ia.html',             f: 'ia',     terminos: 'agente-ia',     titulo: /whatsapp/i,        mensual: 990 },
  { pagina: 'automatizacion.html', f: 'auto',   terminos: 'automatizacion', titulo: /automatizaci/i },
  { pagina: 'servicio.html',       f: 'google', terminos: 'perfil-google', titulo: /perfil de google/i, ciudad: true },
];

const navegador = await chromium.launch({
  executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
});
let fallos = 0, cuenta = 0;
const ok = (c, t) => { cuenta++; if (!c) fallos++; console.log((c ? '  ok    ' : '  FALLA ') + t); };
const errores = [];

for (const P of PAGINAS) {
  console.log('\n── ' + P.pagina);
  const pg = await navegador.newPage({ viewport: { width: 390, height: 844 } });
  pg.on('pageerror', e => errores.push(P.pagina + ' ' + e.message));
  pg.on('console', m => { if (m.type() === 'error' && !/CONNECTION_RESET|ABORTED|googleapis|gstatic/.test(m.text())) errores.push(P.pagina + ' ' + m.text()); });
  /* Las fuentes de Google se responden vacías en vez de abortarse: abortar
     deja un «Failed to load resource» en consola que no es de la página. */
  await pg.route('**://fonts.{googleapis,gstatic}.com/**', r => r.fulfill({ status: 204, body: '' }));
  await pg.goto(BASE + '/' + P.pagina, { waitUntil: 'domcontentloaded' });

  /* ---- indexable ---- */
  ok(await pg.locator('meta[name="robots"]').count() === 0, 'sin «noindex»: la página se puede encontrar');
  const canon = await pg.locator('link[rel="canonical"]').getAttribute('href');
  ok(canon === 'https://sycsolutions.company/' + P.pagina.replace(/\.html$/, ''), 'canónica limpia: ' + canon);
  const titulo = await pg.title();
  ok(P.titulo.test(titulo) && /S&C Solutions/.test(titulo), 'el título dice qué se hace y de quién: «' + titulo + '»');
  if (P.ciudad) ok(/San Luis Potos/i.test(titulo), 'y dónde, porque es lo que pesa en una búsqueda local');
  const desc = await pg.locator('meta[name="description"]').getAttribute('content');
  ok(desc.length >= 90 && desc.length <= 170 && !/\$\d/.test(desc), 'descripción con hechos, de tamaño de buscador y sin cifras que caduquen (' + desc.length + ')');
  ok(await pg.locator('h1').count() === 1, 'un solo h1');

  /* ---- el esquema Service dice lo que cobra el Worker ---- */
  const esquemas = await pg.locator('script[type="application/ld+json"]').allTextContents();
  const nodos = esquemas.flatMap(t => { const d = JSON.parse(t); return d['@graph'] || [d]; });
  const servicios = nodos.filter(n => n['@type'] === 'Service');
  const filas = base(P.f);
  ok(servicios.length === filas.length && filas.length > 0, `hay ${servicios.length} Service en el esquema, y el catálogo tiene ${filas.length} paquete(s)`);
  for (const fila of filas) {
    const n = servicios.find(x => x.name === nom(fila));
    ok(!!n, `el esquema tiene «${nom(fila)}»`);
    if (n) {
      ok(n.offers && n.offers.price === String(fila.total) && n.offers.priceCurrency === 'MXN',
         `y su precio es el del catálogo: $${miles(fila.total)} MXN`);
      ok(n.offers.url === canon && n.url === canon, 'y su URL es la canónica');
      ok(n.provider && /S&C Solutions/.test(n.provider.name), 'y quién lo da');
    }
  }

  /* ---- preguntas visibles = preguntas del esquema ---- */
  const faq = nodos.find(n => n['@type'] === 'FAQPage');
  const visibles = (await pg.locator('.sv-info .faq details summary').allTextContents()).map(t => t.trim());
  const respuestas = (await pg.locator('.sv-info .faq details .faq-r').allTextContents()).map(t => t.replace(/\s+/g, ' ').trim());
  ok(!!faq && visibles.length >= 3, `hay FAQPage y ${visibles.length} preguntas visibles`);
  if (faq) {
    const enEsquema = faq.mainEntity.map(q => q.name);
    ok(JSON.stringify(enEsquema) === JSON.stringify(visibles), 'las preguntas del esquema son las visibles, en el mismo orden');
    const iguales = faq.mainEntity.every((q, i) => q.acceptedAnswer.text.replace(/\s+/g, ' ').trim() === respuestas[i]);
    ok(iguales, 'y cada respuesta del esquema es la que se lee');
  }

  /* ---- la sección de precio dice lo de la tabla ---- */
  const hechos = (await pg.locator('#precio ~ p').allTextContents()).join(' ').replace(/\s+/g, ' ');
  for (const fila of filas) {
    ok(hechos.includes('$' + miles(fila.total) + ' MXN'), `«Precio, pago y plazo» dice $${miles(fila.total)} MXN`);
    const ant = anticipoDe(fila);
    ok(!!ant, `el catálogo tiene la fila de anticipo de «${nom(fila)}»`);
    if (ant) ok(hechos.includes('$' + miles(ant.total) + ' MXN de anticipo') && hechos.includes('$' + miles(fila.total - ant.total) + ' MXN'),
               `y la sección dice el anticipo ($${miles(ant.total)}) y el resto ($${miles(fila.total - ant.total)})`);
  }
  if (P.mensual) ok(hechos.includes('$' + miles(P.mensual) + ' MXN al mes'), 'y la mensualidad');
  ok(/d[íi]as h[áa]biles/.test(hechos), 'y el plazo, en días hábiles');
  /* El plazo de aquí y el de la lista de «qué incluye» son el mismo número. */
  const mPlazo = /(\d+) d[íi]as h[áa]biles/.exec(hechos);
  if (mPlazo && !/\d+ a \d+ d[íi]as/.test(hechos)) {
    const lista = (await pg.locator('.sv-mas li').allTextContents()).join(' ');
    ok(lista.includes(mPlazo[1] + ' días hábiles'), `y son los mismos ${mPlazo[1]} días que dice «ver qué incluye»`);
  }

  /* ---- anclas ---- */
  const rotas = await pg.$$eval('a[href^="#"]', as => as.map(a => a.getAttribute('href')).filter(h => h.length > 1 && !document.getElementById(h.slice(1))));
  ok(rotas.length === 0, 'ninguna ancla interna apunta al vacío' + (rotas.length ? ': ' + rotas.join(', ') : ''));
  const aTerminos = await pg.locator('#precio ~ p a[href*="terminos.html#"]').getAttribute('href');
  ok(aTerminos === 'terminos.html#' + P.terminos && TERMINOS.includes(`id="${P.terminos}"`), 'el enlace a los términos cae en el apartado de este paquete');
  const cta = pg.locator('.sv-info-cta a');
  ok(await cta.getAttribute('href') === '#sv-form' && await pg.locator('#sv-form').count() === 1, 'y al final hay vuelta al cobro');

  /* ---- fuera de la página ---- */
  ok(SITEMAP.includes('<loc>' + canon + '</loc>'), 'está en el sitemap');
  ok(LLMS.includes(canon), 'y en llms.txt');

  await pg.close();
}

await navegador.close();
console.log('');
if (errores.length) { console.log('errores de consola:'); errores.forEach(e => console.log('  ' + e)); fallos += errores.length; }
else console.log('sin errores de consola');
console.log(fallos ? `\n${fallos} de ${cuenta} comprobaciones FALLAN` : `\n${cuenta} comprobaciones, todas en verde`);
process.exit(fallos ? 1 : 0);
