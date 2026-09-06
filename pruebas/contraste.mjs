/* Lo que no se ve, no existe. Esta suite mide contraste de verdad, en un
   viewport de teléfono y con las secciones ya reveladas: texto contra el fondo
   compuesto de sus ancestros, texto de ayuda de los campos, bordes de los
   controles y la flecha de los desplegables.

   Nació de un iPhone: el desplegable de cantidad del pedido tenía la flecha
   nativa del sistema, que iOS pinta en gris oscuro, sobre nuestro fondo negro.
   Invisible. Chromium no lo enseña, así que aquí se comprueba lo que sí se
   puede: que la flecha la dibuje nuestra hoja y que la página declare el
   esquema de color oscuro para los controles nativos. */
import { chromium } from 'playwright';

const B = process.env.BASE || 'http://127.0.0.1:8099';
const PAGINAS = ['index.html', 'pedido.html', 'servicio.html', 'web.html', 'ia.html', 'automatizacion.html',
  'gracias.html', 'gracias-paquete.html', 'gracias-servicio.html', 'guias.html', 'guia-diseno-web-san-luis-potosi.html',
  'terminos.html', 'aviso-de-privacidad.html', 'cookies.html', '404.html'];
let fallos = 0;
const ok = (c, t) => { if (!c) fallos++; console.log((c ? '  ok    ' : '  FALLA ') + t); };
const b = await chromium.launch({ executablePath: process.env.CHROME_PATH || '/opt/pw-browsers/chromium-1194/chrome-linux/chrome' });

for (const pg of PAGINAS) {
  console.log(`\n── ${pg}`);
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, reducedMotion: 'reduce' });
  const r = await p.goto(`${B}/${pg}`, { waitUntil: 'load' });
  ok(r.status() === 200 || pg === '404.html', `responde ${r.status()}`);
  /* Pasos del pedido y pestañas: se enseñan todos para medirlos. Las
     animaciones de entrada se anulan: lo que se mide es el estado final. */
  await p.evaluate(() => { for (const e of document.querySelectorAll('[data-paso],.sol-panel')) { e.hidden = false; } });
  await p.addStyleTag({ content: '[data-paso]{display:block!important} .rv,.zoomsec,.w{opacity:1!important;transform:none!important;transition:none!important}' });
  const alto = await p.evaluate(() => document.body.scrollHeight);
  for (let y = 0; y < alto; y += 600) { await p.evaluate(v => window.scrollTo({ top: v, behavior: 'instant' }), y); await p.waitForTimeout(40); }
  await p.waitForTimeout(600);

  const res = await p.evaluate(() => {
    const parse = c => { const m = (c || '').match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/); return m ? [+m[1], +m[2], +m[3], m[4] === undefined ? 1 : +m[4]] : null; };
    const lum = ([r, g, b]) => { const f = v => { v /= 255; return v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4); }; return .2126 * f(r) + .7152 * f(g) + .0722 * f(b); };
    const ratio = (a, b) => { const l1 = lum(a), l2 = lum(b); return (Math.max(l1, l2) + .05) / (Math.min(l1, l2) + .05); };
    const blend = (top, bot) => { const a = top[3]; return [top[0] * a + bot[0] * (1 - a), top[1] * a + bot[1] * (1 - a), top[2] * a + bot[2] * (1 - a), 1]; };
    const fondo = el => {
      const capas = []; let e = el;
      while (e) { const c = parse(getComputedStyle(e).backgroundColor); if (c && c[3] > 0) capas.push(c); e = e.parentElement; }
      let bg = [255, 255, 255, 1];
      for (const c of capas.reverse()) bg = c[3] >= 1 ? c : blend(c, bg);
      return bg;
    };
    const fondoBajo = el => { // el fondo sobre el que se ve el borde: el del padre
      return fondo(el.parentElement || el);
    };
    const visible = el => { let e = el; while (e) { const s = getComputedStyle(e); if (s.display === 'none' || s.visibility === 'hidden' || +s.opacity === 0) return false; e = e.parentElement; } const r = el.getBoundingClientRect(); return r.width > 0 && r.height > 0; };
    const nombre = el => el.tagName.toLowerCase() + (typeof el.className === 'string' && el.className.trim() ? '.' + el.className.trim().split(/\s+/).slice(0, 2).join('.') : '') + (el.id ? '#' + el.id : '');
    const texto = [], placeholders = [], bordes = [], selects = [];
    let nTexto = 0, nPh = 0, nBordes = 0;
    for (const el of document.querySelectorAll('body *')) {
      if (!visible(el)) continue;
      const cs = getComputedStyle(el);
      let op = 1, e = el; while (e) { op *= +getComputedStyle(e).opacity; e = e.parentElement; }
      const bg = fondo(el);
      const t = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join(' ').trim();
      if (t) {
        nTexto++;
        let col = parse(cs.color); col = [col[0], col[1], col[2], col[3] * op];
        const eff = col[3] < 1 ? blend(col, bg) : col;
        const fs = parseFloat(cs.fontSize), grande = fs >= 24 || (fs >= 18.66 && +cs.fontWeight >= 600);
        const rt = ratio(eff, bg);
        if (rt < (grande ? 3 : 4.5)) texto.push(`${nombre(el)} «${t.slice(0, 32)}» ${rt.toFixed(2)}`);
      }
      if ((el.tagName === 'INPUT' || el.tagName === 'TEXTAREA') && el.placeholder) {
        nPh++;
        const pc = parse(getComputedStyle(el, '::placeholder').color);
        const rt = ratio(pc, bg); if (rt < 4.5) placeholders.push(`${nombre(el)} «${el.placeholder.slice(0, 24)}» ${rt.toFixed(2)}`);
      }
      const esControl = ['INPUT', 'SELECT', 'TEXTAREA'].includes(el.tagName) && !['hidden', 'radio', 'checkbox', 'range', 'submit', 'button'].includes(el.type)
                     || el.classList.contains('ped-op');
      if (esControl) {
        nBordes++;
        const lados = ['borderTopColor', 'borderBottomColor'].map(k => parse(cs[k])).filter(c => c && c[3] > 0);
        const anchos = ['borderTopWidth', 'borderBottomWidth'].map(k => parseFloat(cs[k]));
        if (anchos.some(w => w > 0)) {
          const bc = lados[lados.length - 1] || [0, 0, 0, 0];
          const base = fondoBajo(el);
          const rt = ratio(bc[3] < 1 ? blend(bc, base) : bc, base);
          if (rt < 3) bordes.push(`${nombre(el)} borde ${rt.toFixed(2)}`);
        }
      }
      if (el.tagName === 'SELECT') selects.push({ n: nombre(el), propia: cs.appearance === 'none' && /gradient/.test(cs.backgroundImage) });
    }
    return { texto, placeholders, bordes, selects, nTexto, nPh, nBordes,
      esquema: document.querySelector('meta[name="color-scheme"]')?.content || '' };
  });

  ok(res.esquema === 'dark', `declara color-scheme oscuro para los controles nativos («${res.esquema}»)`);

  /* ⚠ EL ICONO QUE ENSEÑA GOOGLE TIENE QUE SER CUADRADO Y NO PUEDE SER SVG.
     Google exige 1:1 y su lista de formatos es BMP, GIF, ICO, PNG, JPEG, PPM y
     TIFF. El sitio declaraba el CARTEL de la marca, un SVG de 1600x900, así que
     recortaba el centro y de «S&C SOLUTIONS» se leía «S&(». Se comprueba en cada
     página porque basta una que declare otra cosa para que Google dude. */
  const iconos = await p.evaluate(() => [...document.querySelectorAll('link[rel~="icon"], link[rel="apple-touch-icon"]')]
    .map(l => ({ href: l.getAttribute('href'), tipo: l.type, rel: l.rel })));
  ok(iconos.length >= 2, `declara ${iconos.length} iconos`);
  ok(iconos.every(i => !/\.svg$/i.test(i.href)), 'ninguno es SVG, que Google no admite como icono');
  ok(iconos.some(i => i.rel === 'apple-touch-icon'), 'y hay apple-touch-icon, que Google también acepta');
  for (const i of iconos) {
    const r = await p.request.get(new URL(i.href, `${B}/`).href);
    ok(r.status() === 200, `${i.href} responde ${r.status()}`);
    /* Cuadratura leída del propio PNG: los 8 bytes tras «IHDR» son ancho y alto. */
    const b = await r.body();
    const j = b.indexOf(Buffer.from('IHDR'));
    const an = b.readUInt32BE(j + 4), al = b.readUInt32BE(j + 8);
    ok(an === al && an >= 48, `y mide ${an}x${al}: cuadrado y por encima de 48`);
  }
  ok(res.texto.length === 0, `${res.nTexto} textos legibles (4,5:1; 3:1 los grandes)` + (res.texto.length ? `: ${res.texto.join(' · ')}` : ''));
  if (res.nPh) ok(res.placeholders.length === 0, `${res.nPh} textos de ayuda de campo legibles` + (res.placeholders.length ? `: ${res.placeholders.join(' · ')}` : ''));
  if (res.nBordes) ok(res.bordes.length === 0, `${res.nBordes} bordes de control a 3:1 o más` + (res.bordes.length ? `: ${res.bordes.join(' · ')}` : ''));
  for (const s of res.selects) ok(s.propia, `${s.n}: la flecha del desplegable la dibuja nuestra hoja, no el sistema`);
  await p.close();
}
await b.close();
console.log(fallos ? `\n${fallos} FALLO(S)` : '\nTodo en verde');
process.exit(fallos ? 1 : 0);
