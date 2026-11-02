/** Regresión sin navegador para el catálogo de exhibidores personalizados. */
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'Kimi_Agent_Web 3D Optimizada', 'app');
const html = readFileSync(join(app, 'index.html'), 'utf8');
const codigo = readFileSync(join(app, 'assets/catalogo.js'), 'utf8');
const estilos = readFileSync(join(app, 'assets/catalogo.css'), 'utf8');

function nodo(value = '') {
  return {
    value,
    textContent: '',
    href: '',
    hidden: false,
    dataset: {},
    atributos: {},
    eventos: {},
    addEventListener(tipo, fn) { this.eventos[tipo] = fn; },
    setAttribute(nombre, valor) { this.atributos[nombre] = valor; },
    removeAttribute(nombre) { delete this.atributos[nombre]; if (nombre === 'href') this.href = ''; }
  };
}

function preparar() {
  const campos = Object.fromEntries([
    '#sc-modelo', '#sc-destino', '#sc-extra', '#sc-red1', '#sc-red2', '#sc-negocio',
    '#sc-notas', '#sc-resumen', '#sc-total', '#sc-consulta', '#sc-aviso',
    '#sc-negro', '#sc-plateado', '#sc-dorado', '#sc-blanco'
  ].map(id => [id, nodo()]));
  campos['#sc-modelo'].value = 'tria';
  campos['#sc-destino'].value = 'Google Reviews';
  campos['#sc-red1'].value = 'Instagram';
  campos['#sc-red2'].value = 'WhatsApp';
  for (const id of ['#sc-negro', '#sc-plateado', '#sc-dorado', '#sc-blanco']) campos[id].value = '0';
  campos['#sc-negro'].value = '1';

  const tarjetas = ['tria', 'signa'].map(scTarjeta => ({
    dataset: { scTarjeta },
    imagen: { src: '', alt: '' },
    vistas: [],
    querySelector(selector) { return selector === '.sc-modelo-imagen' ? this.imagen : null; },
    querySelectorAll(selector) { return selector === '[data-sc-vista]' ? this.vistas : []; }
  }));
  tarjetas.forEach((tarjeta, i) => {
    const nombre = i === 0 ? 'tria' : 'signa';
    tarjeta.vistas = [nombre, `${nombre}-vista`].map(scVista => ({
      ...nodo(),
      dataset: { scVista: `assets/sc-${scVista}.webp`, scAlt: `Vista ${scVista}` },
      closest() { return tarjeta; }
    }));
  });
  const elegir = ['tria', 'signa'].map(scElegir => ({ ...nodo(), dataset: { scElegir } }));
  const pasos = ['sc-negro', 'sc-plateado', 'sc-dorado', 'sc-blanco'].flatMap(scPara =>
    [-1, 1].map(scPaso => ({ ...nodo(), dataset: { scPara, scPaso: String(scPaso) } })));
  const raiz = {
    eventos: {},
    querySelector(id) { return campos[id] || null; },
    querySelectorAll(selector) {
      if (selector === '[data-sc-tarjeta]') return tarjetas;
      if (selector === '[data-sc-elegir]') return elegir;
      if (selector === '[data-sc-paso]') return pasos;
      if (selector === '[data-sc-vista]') return tarjetas.flatMap(tarjeta => tarjeta.vistas);
      return [];
    },
    addEventListener(tipo, fn) { this.eventos[tipo] = fn; }
  };
  runInNewContext(codigo, { document: { getElementById: id => id === 'sc-catalogo' ? raiz : null } });
  const mensaje = () => decodeURIComponent(campos['#sc-consulta'].href.split('?text=')[1] || '');
  return { campos, tarjetas, elegir, pasos, raiz, mensaje };
}

test('fichas y controles compactos existen sin alterar las placas clásicas', () => {
  for (const id of ['sc-catalogo', 'sc-personalizados', 'sc-config', 'sc-classic',
    'sc-modelo', 'sc-destino', 'sc-negro', 'sc-plateado', 'sc-dorado', 'sc-blanco',
    'sc-resumen', 'sc-total', 'sc-consulta']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const archivo of ['sc-tria.webp', 'sc-tria-nfc.webp', 'sc-tria-perfil.webp',
    'sc-signa-alvia.webp', 'sc-signa-3241.webp', 'sc-signa-dentiva.webp']) {
    assert.ok(existsSync(join(app, 'assets', archivo)), `Falta ${archivo}`);
    assert.ok(html.includes(`assets/${archivo}`), `Falta referencia a ${archivo}`);
  }
  assert.ok(html.indexOf('id="sc-personalizados"') < html.indexOf('id="sc-classic"'));
  assert.ok(html.indexOf('id="sc-config"') < html.indexOf('id="sc-classic"'));
  assert.ok(html.indexOf('class="sc-propuesta"') > html.indexOf('id="sc-classic"'));
  assert.doesNotMatch(html, /id="sc-cantidad"|id="sc-preview"|name="sc-base"/);
  assert.match(html, /<details class="sc-config-opcional">/);
  assert.match(estilos, /\.sc-modelo-cta::before\{content:"";position:absolute;inset:0;z-index:1/);
  assert.match(estilos, /\.sc-vistas\{[^}]*z-index:2/);
  assert.match(html, /id="sc-classic"[\s\S]*?<article class="prod">[\s\S]*?class="prod-compra"/);
  assert.match(html, /S&amp;C \/ 03[\s\S]*?DOCK[\s\S]*?Aún no disponible para compra/);
});

test('TRIA genera WhatsApp directo con los NFC y una pieza inicial', () => {
  const { campos, mensaje } = preparar();
  assert.match(campos['#sc-consulta'].href, /^https:\/\/wa\.me\/524423697248\?text=/);
  assert.match(mensaje(), /Modelo: S&C TRIA/);
  assert.match(mensaje(), /Total: 1 pieza/);
  assert.match(mensaje(), /- Negro: 1/);
  assert.match(mensaje(), /Destino principal NFC \+ QR: Google Reviews/);
  assert.match(mensaje(), /Acceso NFC adicional 1: Instagram/);
  assert.match(mensaje(), /Acceso NFC adicional 2: WhatsApp/);
  assert.equal(campos['#sc-resumen'].textContent, 'TRIA · 1 negro');
  assert.equal(campos['#sc-total'].textContent, '1 pieza');
  assert.equal(campos['#sc-extra'].hidden, false);
});

test('permite múltiples cantidades y colores en un único mensaje con resumen', () => {
  const { campos, raiz, mensaje } = preparar();
  campos['#sc-negro'].value = '1';
  campos['#sc-plateado'].value = '2';
  campos['#sc-dorado'].value = '5';
  campos['#sc-blanco'].value = '0';
  raiz.eventos.input();
  assert.equal(campos['#sc-total'].textContent, '8 piezas');
  assert.equal(campos['#sc-resumen'].textContent, 'TRIA · 1 negro · 2 plateados · 5 dorados');
  assert.match(mensaje(), /Total: 8 piezas/);
  assert.match(mensaje(), /- Negro: 1\n- Plateado: 2\n- Dorado: 5/);
  assert.doesNotMatch(mensaje(), /- Blanco:/);
});

test('SIGNA actualiza los detalles opcionales y el mensaje sin dos NFC extras', () => {
  const { campos, raiz, mensaje, tarjetas } = preparar();
  campos['#sc-modelo'].value = 'signa';
  campos['#sc-negro'].value = '0';
  campos['#sc-dorado'].value = '12';
  campos['#sc-destino'].value = 'TikTok';
  campos['#sc-negocio'].value = 'Dentiva';
  campos['#sc-notas'].value = 'Logo en relieve';
  raiz.eventos.change();
  assert.equal(campos['#sc-extra'].hidden, true);
  assert.equal(tarjetas[1].dataset.scSeleccionado, 'true');
  assert.equal(campos['#sc-resumen'].textContent, 'SIGNA · 12 dorados');
  assert.match(mensaje(), /Modelo: S&C SIGNA/);
  assert.match(mensaje(), /Total: 12 piezas/);
  assert.match(mensaje(), /- Dorado: 12/);
  assert.match(mensaje(), /Destino principal NFC \+ QR: TikTok/);
  assert.match(mensaje(), /Negocio: Dentiva/);
  assert.match(mensaje(), /Logo en relieve/);
  assert.doesNotMatch(mensaje(), /Acceso NFC adicional/);
});

test('cantidades vacías, negativas, decimales y sin piezas invalidan el enlace', () => {
  const { campos, raiz } = preparar();
  for (const invalida of ['', '-5', '1.5', 'abc', '9007199254740992']) {
    campos['#sc-negro'].value = invalida;
    raiz.eventos.input();
    assert.equal(campos['#sc-consulta'].href, '');
    assert.equal(campos['#sc-consulta'].atributos['aria-disabled'], 'true');
  }
  campos['#sc-negro'].value = '0';
  raiz.eventos.change();
  assert.equal(campos['#sc-consulta'].href, '');
  campos['#sc-blanco'].value = '2';
  raiz.eventos.change();
  assert.match(campos['#sc-consulta'].href, /^https:\/\/wa\.me\//);
  assert.equal(campos['#sc-consulta'].atributos['aria-disabled'], undefined);
  assert.match(campos['#sc-resumen'].textContent, /2 blanco/);
});

test('los controles de más y menos funcionan y nunca generan negativos', () => {
  const { campos, pasos, mensaje } = preparar();
  const menosNegro = pasos.find(b => b.dataset.scPara === 'sc-negro' && b.dataset.scPaso === '-1');
  const masDorado = pasos.find(b => b.dataset.scPara === 'sc-dorado' && b.dataset.scPaso === '1');
  menosNegro.eventos.click();
  menosNegro.eventos.click();
  assert.equal(campos['#sc-negro'].value, '0');
  masDorado.eventos.click();
  masDorado.eventos.click();
  assert.equal(campos['#sc-dorado'].value, '2');
  assert.match(mensaje(), /- Dorado: 2/);
});

test('tocar la ficha selecciona el modelo y deja disponible la cotización', () => {
  const { campos, elegir, mensaje } = preparar();
  elegir[1].eventos.click();
  assert.equal(campos['#sc-modelo'].value, 'signa');
  assert.match(mensaje(), /S&C SIGNA/);
});

test('las miniaturas actualizan imágenes sin seleccionar otro producto', () => {
  const { tarjetas, campos } = preparar();
  const [inicio, segunda] = tarjetas[0].vistas;
  segunda.eventos.click();
  assert.equal(tarjetas[0].imagen.src, 'assets/sc-tria-vista.webp');
  assert.equal(tarjetas[0].imagen.alt, 'Vista tria-vista');
  assert.equal(inicio.atributos['aria-pressed'], 'false');
  assert.equal(segunda.atributos['aria-pressed'], 'true');
  assert.equal(campos['#sc-modelo'].value, 'tria');
});
