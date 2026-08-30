import { chromium } from 'playwright';
const B = process.env.BASE || 'http://127.0.0.1:8099';
const S = process.env.CAPTURAS || '';
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });
let fallos = 0;
const ok = (c, t) => { if (!c) fallos++; console.log((c ? '  ok    ' : '  FALLA ') + t); };
const err = [];

const pg = await b.newPage({ viewport: { width: 1280, height: 900 } });
pg.on('pageerror', e => err.push('pageerror: ' + e.message));
pg.on('console', m => { const t = m.text();
  if (m.type() === 'error' && !/CONNECTION_RESET|ABORTED|googleapis/.test(t)) err.push(t); });
const fallidas = [];
pg.on('response', r => { if (r.status() >= 400 && /cliente-/.test(r.url())) fallidas.push(r.status() + ' ' + r.url()); });

await pg.goto(B + '/#clientes', { waitUntil: 'networkidle' });
await pg.waitForTimeout(400);   // #clientes abre su pestaña; el panel entra con una transición corta

/* ---- la sección existe y las tres fotos cargan de verdad ---- */
const figs = pg.locator('.insta-g figure');
ok(await figs.count() === 3, 'hay tres instalaciones');
await pg.locator('.insta').scrollIntoViewIfNeeded();
await pg.waitForTimeout(1200);

const cargadas = await pg.locator('.insta-g img').evaluateAll(
  is => is.map(i => ({ ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight, src: i.currentSrc.split('/').pop() })));
ok(cargadas.every(c => c.ok), 'las tres imágenes cargan (no hay 404)');
ok(fallidas.length === 0, 'ninguna petición de foto de cliente falla' + (fallidas.length ? ': ' + fallidas.join(', ') : ''));
for (const c of cargadas) console.log(`      ${c.src} → ${c.w}x${c.h}`);
ok(cargadas.every(c => Math.abs(c.w / c.h - 0.75) < 0.01), 'las tres tienen la misma proporción 3:4');

/* ---- los pies dicen el negocio y la plaza ---- */
const pies = await pg.locator('.insta-g figcaption').allTextContents();
for (const p of pies) console.log('      pie: ' + p.replace(/\s+/g, ' ').trim());
ok(pies.length === 3 && pies.every(p => /San Luis Potos/i.test(p)), 'cada pie dice la ciudad');

/* ---- LA QUE JUSTIFICA EL ARCHIVO: no hay testimonios inventados ---- */
const texto = await pg.locator('.insta').innerText();
ok(!/[«"'"].{15,}[»"'"]\s*[—-]/.test(texto), 'no hay ninguna frase entrecomillada atribuida a nadie');
ok(!/\b(5|cinco|4|cuatro)\s*(estrellas|de 5)\b/i.test(texto), 'no se inventa ninguna calificación');

/* ---- el visor: dos listas separadas ---- */
await pg.locator('.insta-g figure').first().locator('button').click();
await pg.waitForTimeout(600);
ok(await pg.locator('#visor').isVisible(), 'la primera foto abre el visor');
const cuenta = await pg.locator('#visor-cuenta').textContent();
ok(/\b3\b/.test(cuenta), 'el visor cuenta 3 y no 6: la lista está separada de la del producto (dice «' + cuenta.trim() + '»)');
const pie1 = await pg.locator('#visor-pie').textContent();
ok(/Kabuki/.test(pie1), 'el pie del visor nombra el negocio: «' + pie1.trim() + '»');
const grande = await pg.locator('#visor-img').getAttribute('src');
ok(/cliente-.*-grande\.webp$/.test(grande), 'amplía la versión grande: ' + grande);
await pg.keyboard.press('Escape');
await pg.waitForTimeout(500);

/* ---- y la galería del producto sigue con las SUYAS (4, con la vista explotada) ---- */
await pg.locator('#t-productos').click();     // vive en otra pestaña: hay que abrirla
await pg.waitForTimeout(400);
await pg.locator('.prod-fig .prod-abre').first().click();
await pg.waitForTimeout(600);
const cuenta2 = await pg.locator('#visor-cuenta').textContent();
ok(/\b4\b/.test(cuenta2), 'la galería del producto tiene sus 4 —con la vista explotada— (dice «' + cuenta2.trim() + '»)');
const pie2 = await pg.locator('#visor-pie').textContent();
ok(/frente/i.test(pie2), 'y sigue abriendo por la foto correcta: «' + pie2.trim() + '»');
await pg.keyboard.press('Escape');
await pg.waitForTimeout(400);
await pg.locator('#t-clientes').click();
await pg.waitForTimeout(400);
if (S) await pg.locator('.insta').screenshot({ path: S + '/insta-escritorio.png' });

/* ---- móvil: tira arrastrable, no tres pantallas apiladas ---- */
const m = await b.newPage({ viewport: { width: 390, height: 844 } });
m.on('pageerror', e => err.push('móvil pageerror: ' + e.message));
await m.goto(B + '/#clientes', { waitUntil: 'networkidle' });
await m.waitForTimeout(400);
await m.locator('.insta').scrollIntoViewIfNeeded();
await m.waitForTimeout(1200);
const caja = await m.locator('.insta-g').boundingBox();
const alturaSeccion = (await m.locator('.insta').boundingBox()).height;
ok(alturaSeccion < 844 * 1.6, `en móvil la sección ocupa ${Math.round(alturaSeccion)} px y no tres pantallas`);
const desliza = await m.locator('.insta-g').evaluate(e => e.scrollWidth > e.clientWidth + 40);
ok(desliza, 'la tira se desliza de lado en móvil');
const filas = await m.locator('.insta-g figure').evaluateAll(fs => [...new Set(fs.map(f => Math.round(f.getBoundingClientRect().top)))].length);
ok(filas === 1, 'las tres van en un solo renglón (renglones: ' + filas + ')');
if (S) await m.locator('.insta').screenshot({ path: S + '/insta-movil.png' });

/* ---- sin JavaScript la sección sigue entera ---- */
const sin = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
const p2 = await sin.newPage();
await p2.goto(B + '/#clientes', { waitUntil: 'load' });   // sin JS no hay pestañas: los tres paneles se ven
await p2.waitForTimeout(900);
ok(await p2.locator('.insta-g figure').count() === 3,
   'sin JavaScript las tres fotos están en el HTML: la sección no la fabrica ningún script');
/* ⚠ isVisible() de Playwright NO mira la opacidad, así que un bloque en
   opacity:0 se lo traga. La página entera nace con .rv{opacity:0} y la
   descubre un IntersectionObserver: sin JavaScript, index.html está en blanco
   de arriba abajo. Es de antes de esta sección y afecta a servicios, producto
   y proyectos igual. Lo que sí puede comprobarse aquí es que la sección nueva
   no sea PEOR que sus vecinas: si alguien arregla el descubrimiento, ésta
   viene incluida; si alguien la deja invisible ella sola, esto se pone rojo. */
const opac = async sel => p2.locator(sel).first().evaluate(e => getComputedStyle(e).opacity);
const mia = await opac('.insta'), vecina = await opac('#soluciones .svc-grid');
ok(mia === vecina, `sin JavaScript se comporta igual que el resto de la página (ella ${mia}, la rejilla de servicios ${vecina})`);
if (mia === '0') console.log('      nota: ambas en opacity 0 — fallo previo de index.html, no de esta sección');

console.log(err.length ? '\nERRORES DE CONSOLA: ' + err.join(' | ') : '\nsin errores de consola');
if (err.length) fallos++;
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
await b.close();
process.exit(fallos ? 1 : 0);
