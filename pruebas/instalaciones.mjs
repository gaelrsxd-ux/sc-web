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

/* ---- la sección existe y las cuatro fotos cargan de verdad ---- */
const figs = pg.locator('.insta-g figure');
ok(await figs.count() === 4, 'hay cuatro instalaciones');
await pg.locator('.insta').scrollIntoViewIfNeeded();
await pg.waitForTimeout(1200);

const cargadas = await pg.locator('.insta-g img').evaluateAll(
  is => is.map(i => ({ ok: i.complete && i.naturalWidth > 0, w: i.naturalWidth, h: i.naturalHeight, src: i.currentSrc.split('/').pop() })));
ok(cargadas.every(c => c.ok), 'las cuatro imágenes cargan (no hay 404)');
ok(fallidas.length === 0, 'ninguna petición de foto de cliente falla' + (fallidas.length ? ': ' + fallidas.join(', ') : ''));
for (const c of cargadas) console.log(`      ${c.src} → ${c.w}x${c.h}`);
ok(cargadas.every(c => Math.abs(c.w / c.h - 0.75) < 0.01), 'las cuatro tienen la misma proporción 3:4');

/* ⚠ NINGUNA comprobación de arriba mira la opacidad: naturalWidth vale igual
   en una foto invisible. Desde que las fotos entran al deslizar, un fallo en
   ese módulo —un root mal puesto, un umbral que no se alcanza— dejaría la
   sección ENTERA en blanco y todo lo anterior seguiría en verde. En escritorio
   la rejilla no se desplaza: las cuatro caen dentro del root a la vez y deben
   acabar visibles todas. */
const opacEsc = await pg.locator('.insta-g figure').evaluateAll(fs => fs.map(f => getComputedStyle(f).opacity));
ok(opacEsc.every(x => x === '1'), 'en escritorio las cuatro se descubren juntas (opacidades: ' + opacEsc.join(', ') + ')');

/* ---- los pies dicen el negocio y la plaza ---- */
const pies = await pg.locator('.insta-g figcaption').allTextContents();
for (const p of pies) console.log('      pie: ' + p.replace(/\s+/g, ' ').trim());
ok(pies.length === 4 && pies.every(p => /San Luis Potos/i.test(p)), 'cada pie dice la ciudad');

/* ---- LA QUE JUSTIFICA EL ARCHIVO: no hay testimonios inventados ---- */
const texto = await pg.locator('.insta').innerText();
ok(!/[«"'"].{15,}[»"'"]\s*[—-]/.test(texto), 'no hay ninguna frase entrecomillada atribuida a nadie');
ok(!/\b(5|cinco|4|cuatro)\s*(estrellas|de 5)\b/i.test(texto), 'no se inventa ninguna calificación');

/* ---- el visor: dos listas separadas ---- */
const scrollAntes = await pg.evaluate(() => Math.round(scrollY));
await pg.locator('.insta-g figure').first().locator('button').click();
await pg.waitForTimeout(600);
ok(await pg.locator('#visor').isVisible(), 'la primera foto abre el visor');

/* ⚠ LO QUE ESTE ARCHIVO NO VIO UNA VEZ: el visor «funcionaba» —contaba,
   pasaba fotos, cerraba— con sus estilos de caja borrados. Sin position:fixed
   se abría como un div más del flujo, al principio de la página: el foco
   saltaba hasta allí, el fondo se quedaba sin desplazamiento y en un teléfono
   era una pantalla congelada que sólo se arreglaba recargando. isVisible() y
   textContent() no ven la diferencia; estas tres sí. */
const vcaja = await pg.locator('#visor').evaluate(e => {
  const c = getComputedStyle(e), r = e.getBoundingClientRect();
  return { pos: c.position, op: c.opacity,
           cubre: r.x <= 0 && r.y <= 0 && r.width >= innerWidth && r.height >= innerHeight };
});
ok(vcaja.pos === 'fixed' && vcaja.cubre, 'el visor es un diálogo fijo que tapa la pantalla, no un div en el flujo (' + vcaja.pos + ')');
ok(vcaja.op === '1', 'y se ve de verdad, no en opacity 0 (está en ' + vcaja.op + ')');
ok(Math.round(await pg.evaluate(() => scrollY)) === scrollAntes,
   'abrirlo no arrastra la página al principio');
const cuenta = await pg.locator('#visor-cuenta').textContent();
/* ⚠ La cuenta sola YA NO PRUEBA NADA: desde la cuarta instalación las dos
   galerías tienen 4, así que un visor que mezclara ambas listas —el fallo que
   esta línea vigilaba— seguiría diciendo 4 aquí y pasaría. Lo que las separa
   es el origen de las fotos: la de clientes tira de cliente-*, la del producto
   de producto-*. Por eso se comprueban las dos cosas, y abajo la del producto
   se mira igual. */
ok(/\b4\b/.test(cuenta), 'el visor cuenta las 4 instalaciones (dice «' + cuenta.trim() + '»)');
ok(!/\b8\b/.test(cuenta), 'y no 8: no se ha tragado también la galería del producto');
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
const grande2 = await pg.locator('#visor-img').getAttribute('src');
ok(/producto-.*\.webp$/.test(grande2), 'y amplía una foto del producto, no la de un cliente: ' + grande2);
await pg.keyboard.press('Escape');
await pg.waitForTimeout(400);
ok(await pg.locator('.prod-mas').isHidden(),
   'en escritorio el aviso de «más fotos» no está: las miniaturas ya lo dicen');
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
ok(filas === 1, 'las cuatro van en un solo renglón (renglones: ' + filas + ')');

/* ---- las fotos entran al deslizar, no están todas puestas ----
   Lo que se pidió: que vayan apareciendo conforme se arrastra a la derecha.
   La cuarta está fuera de la tira al cargar, así que empieza oculta; al llevar
   la tira al final tiene que llegar. Si alguien cambia el root del observador a
   la pantalla, las cuatro contarían como visibles desde el principio —en
   vertical ya lo están— y esta pareja de líneas se pone roja. */
const opac4 = () => m.locator('.insta-g figure').nth(3).evaluate(e => getComputedStyle(e).opacity);
ok(await opac4() === '0', 'la cuarta empieza oculta: no están todas puestas de golpe');
await m.locator('.insta-g').evaluate(e => e.scrollTo({ left: e.scrollWidth }));
await m.waitForTimeout(900);
ok(await opac4() === '1', 'y aparece al deslizar la tira a la derecha');
await m.locator('.insta-g').evaluate(e => e.scrollTo({ left: 0 }));
await m.waitForTimeout(500);

/* ---- móvil: tocar una foto abre un diálogo del que se puede SALIR ----
   El teléfono no tiene tecla Escape: si la equis no está en pantalla, el
   visitante se queda encerrado. Es exactamente lo que pasó con los estilos
   del visor borrados, y el celular de verdad hubo que reiniciarlo. */
const scrollM = await m.evaluate(() => Math.round(scrollY));
await m.locator('.insta-g figure').first().locator('button').click();
await m.waitForTimeout(600);
const vm = await m.locator('#visor').boundingBox();
ok(vm && vm.width >= 390 && vm.height >= 844, 'en el teléfono el visor tapa la pantalla entera');
ok(Math.round(await m.evaluate(() => scrollY)) === scrollM, 'y no arrastra la página a ninguna parte');
const eqm = await m.locator('#visor .cerrar').boundingBox();
ok(eqm && eqm.y >= 0 && eqm.x >= 0 && eqm.y + eqm.height <= 844 && eqm.x + eqm.width <= 390,
   'la equis está dentro de la pantalla del teléfono');
await m.locator('#visor .cerrar').click();
await m.waitForTimeout(600);
ok(await m.locator('#visor').isHidden(), 'la equis cierra el visor');
ok(await m.evaluate(() => getComputedStyle(document.body).overflow !== 'hidden'),
   'y la página vuelve a poder desplazarse');

/* ---- móvil: se sabe que hay más fotos aunque las miniaturas no estén ----
   Las miniaturas se esconden para que la ficha no crezca, pero eso dejaba la
   foto principal como si fuera la única —y sin pinta de tocable. La píldora
   «Ver las 4 fotos» es parte del botón: anuncia y abre. */
await m.locator('#t-productos').click();
await m.waitForTimeout(400);
ok(await m.locator('.prod-mini').isHidden(), 'las miniaturas siguen fuera del móvil: la ficha no crece');
const mas = m.locator('.prod-mas');
ok(await mas.isVisible(), 'pero el aviso de la galería está a la vista');
const nmas = parseInt((await mas.textContent()).replace(/\D/g, ''), 10);
const reales = await m.locator('[data-galeria="producto"]').count();
ok(nmas === reales, 'y su número dice la verdad: anuncia ' + nmas + ' y hay ' + reales);
await mas.click();
await m.waitForTimeout(600);
const cuentaM = (await m.locator('#visor-cuenta').textContent()).trim();
ok(cuentaM.endsWith('/ ' + reales), 'tocar el aviso abre la galería completa (dice «' + cuentaM + '»)');
await m.locator('#visor .cerrar').click();
await m.waitForTimeout(600);
if (S) await m.locator('.insta').screenshot({ path: S + '/insta-movil.png' });

/* ---- sin JavaScript la sección sigue entera ---- */
const sin = await b.newContext({ javaScriptEnabled: false, viewport: { width: 1280, height: 900 } });
const p2 = await sin.newPage();
await p2.goto(B + '/#clientes', { waitUntil: 'load' });   // sin JS no hay pestañas: los tres paneles se ven
await p2.waitForTimeout(900);
ok(await p2.locator('.insta-g figure').count() === 4,
   'sin JavaScript las cuatro fotos están en el HTML: la sección no la fabrica ningún script');
/* Y se VEN, que no es lo mismo que estar. El estado oculto de la entrada al
   deslizar lo enciende el script con .desliza; si alguien lo pasara a la hoja
   de estilos, sin JavaScript esta sección quedaría en blanco —el fallo que ya
   tiene .rv en el resto de la página— y esta línea es la que lo impide. */
const opacSinJs = await p2.locator('.insta-g figure').evaluateAll(fs => fs.map(f => getComputedStyle(f).opacity));
ok(opacSinJs.every(x => x === '1'),
   'y se ven enteras: el estado oculto lo enciende el script, no el CSS (opacidades: ' + opacSinJs.join(', ') + ')');
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
