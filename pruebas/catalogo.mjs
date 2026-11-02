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

test('portada clara: web, Google, NFC y revisión sin bloques repetidos', () => {
  const servicios = html.match(/<article class="svc"/g) || [];
  assert.equal(servicios.length, 2, 'Solo hay dos servicios digitales activos');
  assert.ok(html.indexOf('id="svc-google"') < html.indexOf('id="svc-web"'),
    'Google va como servicio 01 y páginas web como 02');
  assert.match(html, /id="svc-google"[\s\S]*?class="idx"[^>]*>\/ 01/);
  assert.match(html, /id="svc-web"[\s\S]*?class="idx"[^>]*>\/ 02/);
  assert.doesNotMatch(html, /id="svc-tareas"|>Automatización de Procesos</);
  assert.match(html, /Configurar mi negocio en Google Maps/);
  assert.match(html, /Placas y exhibidores personalizados NFC \+ QR/);
  assert.match(html, /data-solicitud="Perfil de Empresa en Google"/);
  assert.match(html, /data-solicitud="Exhibidores personalizados NFC \+ QR"/);
  assert.match(html, /const tema=campos\.servicio\.selectedOptions\[0\]\?\.dataset\.solicitud/);
  assert.match(html, /datos\.mensaje=encabezado\+datos\.mensaje/,
    'El mensaje incluye la categoría real sin cambiar los valores validados por el servidor');
  assert.doesNotMatch(html, /id="viva"|getElementById\('viva'\)/,
    'La franja rotatoria repetida no debe ocupar espacio');
  assert.match(html, /\.aud-out:has\(\.aud-idle\)\{display:none\}/,
    'La caja de diagnóstico vacía queda oculta hasta tener resultados');
  assert.match(html, /#contacto \.frame\{padding:22px 18px\}/,
    'Contacto tiene un relleno ajustado en móvil');
});

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

function preparar({ hash = '' } = {}) {
  const campos = Object.fromEntries([
    '#sc-modelo', '#sc-resumen', '#sc-total', '#sc-consulta', '#sc-aviso',
    '#sc-negro', '#sc-plateado', '#sc-dorado', '#sc-blanco'
  ].map(id => [id, nodo()]));
  campos['#sc-modelo'].value = 'tria';
  for (const id of ['#sc-negro', '#sc-plateado', '#sc-dorado', '#sc-blanco']) campos[id].value = '0';
  campos['#sc-negro'].value = '1';

  const paneles = Object.fromEntries(['#sc-personalizados', '#sc-classic']
    .map(id => [id, { ...nodo(), scrollIntoView() { this.desplazado = true; } }]));
  const accesos = ['#sc-classic', '#sc-personalizados'].map(href => ({ ...nodo(), href }));
  const location = { hash };
  const eventosVentana = {};

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
    querySelector(id) { return campos[id] || paneles[id] || null; },
    querySelectorAll(selector) {
      if (selector === '[data-sc-tarjeta]') return tarjetas;
      if (selector === '[data-sc-elegir]') return elegir;
      if (selector === '[data-sc-paso]') return pasos;
      if (selector === '[data-sc-vista]') return tarjetas.flatMap(tarjeta => tarjeta.vistas);
      if (selector === '.sc-accesos a[href^="#sc-"]') return accesos;
      return [];
    },
    addEventListener(tipo, fn) { this.eventos[tipo] = fn; }
  };
  runInNewContext(codigo, {
    document: { getElementById: id => id === 'sc-catalogo' ? raiz : null },
    location,
    addEventListener(tipo, fn) { eventosVentana[tipo] = fn; },
    requestAnimationFrame(fn) { fn(); }
  });
  const mensaje = () => decodeURIComponent(campos['#sc-consulta'].href.split('?text=')[1] || '');
  return { campos, tarjetas, elegir, pasos, raiz, mensaje, paneles, accesos, location, eventosVentana };
}

test('fichas y controles compactos existen sin alterar las placas clásicas', () => {
  assert.match(html, /class="sc-cabecera sc-cabecera--breve"[\s\S]*?Un toque\. <em>Más clientes\.<\/em>/,
    'El encabezado es breve y va directo al beneficio');
  assert.doesNotMatch(html, /Tu marca merece|Smart Displays \/ Fabricación propia|Elige un modelo y los colores que quieras/,
    'La introducción larga no debe robar pantalla al catálogo');
  assert.match(estilos, /\.sc-cabecera\.sc-cabecera--breve\{display:block;padding:8px 0 13px\}/,
    'El encabezado compacto elimina el espacio vacío de la segunda columna');
  for (const id of ['sc-catalogo', 'sc-personalizados', 'sc-config', 'sc-classic',
    'sc-modelo', 'sc-negro', 'sc-plateado', 'sc-dorado', 'sc-blanco',
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
  assert.doesNotMatch(html, /id="sc-cantidad"|id="sc-preview"|name="sc-base"|id="sc-destino"|class="sc-config-opcional"|\(opcional\)/);
  assert.match(html, /En WhatsApp nos envías tu logotipo y definimos juntos el diseño, enlaces NFC\/QR, precio y entrega/);
  assert.match(estilos, /\.sc-modelo-cta::before\{content:"";position:absolute;inset:0;z-index:1/);
  assert.match(estilos, /\.sc-vistas\{[^}]*z-index:2/);
  assert.match(estilos, /\.sc-config\{[^}]*padding:0/,
    'El configurador debe anular el padding vertical de la regla global section');
  assert.match(estilos, /\.js #sc-classic:not\(\[data-sc-activo="true"\]\)/);
  assert.match(estilos, /\.sc-bloque\{[^}]*padding:0/);
  assert.match(html, /id="sc-classic"[\s\S]*?<article class="prod">[\s\S]*?class="prod-compra"/);
  assert.match(html, /S&amp;C \/ 03[\s\S]*?DOCK[\s\S]*?Aún no disponible para compra/);
  assert.match(html, /01 \/ Clásicas y mayoreo[\s\S]*02 \/ Personalizados/,
    'Las clásicas deben aparecer primero, a la izquierda');
  assert.match(html, /CLASSIC <span class="sc-classic-rombo" aria-hidden="true"><\/span> <em>mayoreo\.<\/em>/,
    'Un rombo reemplaza el ampersand tipográfico del encabezado');
  assert.match(estilos, /\.sc-classic-rombo\{/);
});

test('CLASSIC abre primero, Personalizados va segundo y los enlaces restauran la vista', () => {
  const { paneles, accesos, location, eventosVentana } = preparar();
  assert.equal(paneles['#sc-classic'].hidden, false);
  assert.equal(paneles['#sc-personalizados'].hidden, true);
  assert.equal(accesos[0].atributos['aria-current'], 'page');
  accesos[1].eventos.click();
  assert.equal(paneles['#sc-classic'].hidden, true);
  assert.equal(paneles['#sc-personalizados'].hidden, false);
  assert.equal(accesos[1].atributos['aria-current'], 'page');
  location.hash = '#sc-classic';
  eventosVentana.hashchange();
  assert.equal(paneles['#sc-classic'].hidden, false);
  assert.equal(paneles['#sc-personalizados'].hidden, true);
  const directo = preparar({ hash: '#sc-personalizados' });
  assert.equal(directo.paneles['#sc-personalizados'].hidden, false);
  const classic = preparar({ hash: '#sc-classic' });
  assert.equal(classic.paneles['#sc-classic'].hidden, false);
  assert.equal(classic.paneles['#sc-classic'].desplazado, true);
});

test('animaciones progresivas visibles por defecto y con margen para reaccionar antes', () => {
  assert.match(html, /\.rv\{opacity:1;transform:none/);
  assert.match(html, /\.rv\.reveal-pending\{opacity:0;transform:translateY\(22px\)/);
  assert.match(html, /\.zoomsec\{opacity:1;transform:none/);
  assert.match(html, /\.baraja\.bar-listo\{opacity:1;transform:none/);
  assert.match(html, /\.w\{display:inline-block;opacity:1;transform:none/);
  assert.match(html, /if\(animarScroll\)/);
  assert.match(html, /rootMargin:'160px 0px 160px 0px'/);
  assert.doesNotMatch(html, /setTimeout\(\(\)=>\{destapa\(\);obs\.disconnect\(\);\},3000\)/);
});

test('TRIA genera WhatsApp directo con modelo y cantidad inicial y pide el logotipo', () => {
  const { campos, mensaje } = preparar();
  assert.match(campos['#sc-consulta'].href, /^https:\/\/wa\.me\/524423697248\?text=/);
  assert.match(mensaje(), /\*Modelo:\* S&C TRIA/);
  assert.match(mensaje(), /\*Total:\* 1 pieza/);
  assert.match(mensaje(), /• Negro: 1/);
  assert.match(mensaje(), /mi logotipo por este chat/);
  assert.match(mensaje(), /definir juntos el diseño, los enlaces NFC\/QR y los acabados/);
  assert.match(mensaje(), /S&C Solutions\.\n\n\*Modelo:\* S&C TRIA\n\*Total:\* 1 pieza\n\n\*Colores y cantidades:\*\n• Negro: 1\n\n/,
    'El mensaje debe tener espacios entre presentación, resumen, colores y conversación');
  assert.match(mensaje(), /acabados\.\n\n¿Me comparten el precio y tiempo de entrega\?/);
  assert.doesNotMatch(mensaje(), /Destino principal|Acceso NFC adicional|Negocio:|Indicaciones:/);
  assert.equal(campos['#sc-resumen'].textContent, 'TRIA · 1 negro');
  assert.equal(campos['#sc-total'].textContent, '1 pieza');
  assert.match(campos['#sc-aviso'].textContent, /nos envías tu logotipo/);
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
  assert.match(mensaje(), /\*Total:\* 8 piezas/);
  assert.match(mensaje(), /• Negro: 1\n• Plateado: 2\n• Dorado: 5/);
  assert.doesNotMatch(mensaje(), /• Blanco:/);
});

test('SIGNA cotiza únicamente el modelo y los colores y lleva el diseño a WhatsApp', () => {
  const { campos, raiz, mensaje, tarjetas } = preparar();
  campos['#sc-modelo'].value = 'signa';
  campos['#sc-negro'].value = '0';
  campos['#sc-dorado'].value = '12';
  raiz.eventos.change();
  assert.equal(tarjetas[1].dataset.scSeleccionado, 'true');
  assert.equal(campos['#sc-resumen'].textContent, 'SIGNA · 12 dorados');
  assert.match(mensaje(), /\*Modelo:\* S&C SIGNA/);
  assert.match(mensaje(), /\*Total:\* 12 piezas/);
  assert.match(mensaje(), /• Dorado: 12/);
  assert.match(mensaje(), /mi logotipo por este chat/);
  assert.doesNotMatch(mensaje(), /Destino principal|Acceso NFC adicional|Negocio:|Indicaciones:/);
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
  assert.match(mensaje(), /• Dorado: 2/);
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
