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
    '#sc-modelo', '#sc-cantidad', '#sc-destino', '#sc-extra', '#sc-red1',
    '#sc-red2', '#sc-cambio-base', '#sc-negocio', '#sc-notas', '#sc-preview',
    '#sc-preview-pie', '#sc-consulta', '#sc-aviso'
  ].map(id => [id, nodo()]));
  campos['#sc-modelo'].value = 'tria';
  campos['#sc-cantidad'].value = '1';
  campos['#sc-destino'].value = 'Google Reviews';
  campos['#sc-red1'].value = 'Instagram';
  campos['#sc-red2'].value = 'WhatsApp';
  campos['#sc-cambio-base'].value = 'Base del modelo elegido';

  const bases = ['Negro', 'Plateado', 'Dorado', 'Blanco'].map((value, i) => ({ value, checked: i === 0 }));
  const tarjetas = ['tria', 'signa'].map(scTarjeta => ({ dataset: { scTarjeta } }));
  const elegir = ['tria', 'signa'].map(scElegir => ({ ...nodo(), dataset: { scElegir } }));
  const raiz = {
    eventos: {},
    querySelector(id) { return campos[id] || null; },
    querySelectorAll(selector) {
      if (selector === 'input[name="sc-base"]') return bases;
      if (selector === '[data-sc-tarjeta]') return tarjetas;
      if (selector === '[data-sc-elegir]') return elegir;
      return [];
    },
    addEventListener(tipo, fn) { this.eventos[tipo] = fn; }
  };
  runInNewContext(codigo, { document: { getElementById: id => id === 'sc-catalogo' ? raiz : null } });
  const mensaje = () => decodeURIComponent(campos['#sc-consulta'].href.split('?text=')[1] || '');
  return { campos, bases, tarjetas, elegir, raiz, mensaje };
}

test('las fichas, las opciones y las fotografías existen en el catálogo', () => {
  for (const id of ['sc-catalogo', 'sc-personalizados', 'sc-config', 'sc-classic', 'sc-cantidad', 'sc-destino']) {
    assert.match(html, new RegExp(`id="${id}"`));
  }
  for (const archivo of ['sc-tria.webp', 'sc-tria-nfc.webp', 'sc-tria-perfil.webp', 'sc-signa-alvia.webp', 'sc-signa-3241.webp', 'sc-signa-dentiva.webp']) {
    assert.ok(existsSync(join(app, 'assets', archivo)), `Falta ${archivo}`);
    assert.ok(html.includes(`assets/${archivo}`), `Falta referencia a ${archivo}`);
  }
  assert.ok(html.indexOf('id="sc-personalizados"') < html.indexOf('id="sc-classic"'));
  assert.match(html, /id="sc-classic"[\s\S]*?<article class="prod">[\s\S]*?class="prod-compra"/);
  assert.match(html, /S&amp;C \/ 03[\s\S]*?DOCK[\s\S]*?Aún no disponible para compra/);
});

test('TRIA genera una cotización de tres NFC sin procesar el pedido', () => {
  const { campos, mensaje } = preparar();
  assert.match(campos['#sc-consulta'].href, /^https:\/\/wa\.me\/524423697248\?text=/);
  assert.match(mensaje(), /Modelo: S&C TRIA/);
  assert.match(mensaje(), /Cantidad: 1 pieza/);
  assert.match(mensaje(), /Destino principal NFC \+ QR: Google Reviews/);
  assert.match(mensaje(), /Acceso NFC adicional 1: Instagram/);
  assert.match(mensaje(), /Acceso NFC adicional 2: WhatsApp/);
  assert.equal(campos['#sc-extra'].hidden, false);
});

test('SIGNA y la personalización actualizan foto, cantidad y opciones del mensaje', () => {
  const { campos, bases, raiz, mensaje, tarjetas } = preparar();
  campos['#sc-modelo'].value = 'signa';
  campos['#sc-cantidad'].value = '12';
  campos['#sc-destino'].value = 'TikTok';
  campos['#sc-cambio-base'].value = 'Quiero proponer otra forma o diseño 3D';
  campos['#sc-negocio'].value = 'Dentiva';
  campos['#sc-notas'].value = 'Base con nuestro logotipo en relieve';
  bases[0].checked = false;
  bases[2].checked = true;
  raiz.eventos.change();
  assert.equal(campos['#sc-extra'].hidden, true);
  assert.equal(campos['#sc-preview'].src, 'assets/sc-signa-alvia.webp');
  assert.equal(tarjetas[1].dataset.scSeleccionado, 'true');
  assert.match(mensaje(), /Modelo: S&C SIGNA/);
  assert.match(mensaje(), /Cantidad: 12 piezas/);
  assert.match(mensaje(), /Color de la base: Dorado/);
  assert.match(mensaje(), /Destino principal NFC \+ QR: TikTok/);
  assert.match(mensaje(), /Negocio: Dentiva/);
  assert.match(mensaje(), /logotipo en relieve/);
  assert.doesNotMatch(mensaje(), /Acceso NFC adicional/);
});

test('cantidad cero o decimal impide una cotización inválida', () => {
  const { campos, raiz } = preparar();
  for (const invalida of ['0', '-5', '1.5', 'abc']) {
    campos['#sc-cantidad'].value = invalida;
    raiz.eventos.input();
    assert.equal(campos['#sc-consulta'].href, '');
    assert.equal(campos['#sc-consulta'].atributos['aria-disabled'], 'true');
  }
  campos['#sc-cantidad'].value = '2';
  raiz.eventos.change();
  assert.match(campos['#sc-consulta'].href, /^https:\/\/wa\.me\//);
  assert.equal(campos['#sc-consulta'].atributos['aria-disabled'], undefined);
});

test('elegir una ficha también selecciona el modelo del configurador', () => {
  const { campos, elegir, mensaje } = preparar();
  elegir[1].eventos.click();
  assert.equal(campos['#sc-modelo'].value, 'signa');
  assert.match(mensaje(), /S&C SIGNA/);
});
