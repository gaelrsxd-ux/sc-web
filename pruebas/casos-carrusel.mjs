import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runInNewContext } from 'node:vm';
import test from 'node:test';

const app = join(dirname(fileURLToPath(import.meta.url)), '..', 'Kimi_Agent_Web 3D Optimizada', 'app');
const codigo = readFileSync(join(app, 'assets/casos-carrusel.js'), 'utf8');
const estilos = readFileSync(join(app, 'assets/casos-carrusel.css'), 'utf8');
const paginas = [
  ['sitio', readFileSync(join(app, 'index.html'), 'utf8'), 'kabuki-story'],
  ['presentación', readFileSync(join(app, 'gael/index.html'), 'utf8'), 'gael-results']
];

for (const [nombre, html, clase] of paginas) {
  test(`Los tres casos de la ${nombre} se muestran en un único carrusel`, () => {
    const inicio = html.indexOf('class="casos-carrusel" data-casos-carrusel');
    const final = html.indexOf('class="casos-carrusel-ayuda"', inicio);
    assert.ok(inicio > -1 && final > inicio);
    const bloque = html.slice(inicio, final);
    assert.equal((bloque.match(new RegExp(`<section class="${clase}"`, 'g')) || []).length, 3);
    assert.equal((bloque.match(/Toca para ampliar\./g) || []).length, 3);
    assert.match(bloque, /data-casos-pista role="region" aria-roledescription="carrusel"/);
    assert.match(bloque, /data-casos-anterior/);
    assert.match(bloque, /data-casos-siguiente/);
    assert.match(bloque, /data-casos-contador[^>]*>01 \/ 03/);
    assert.match(html, /casos-carrusel\.css/);
    assert.match(html, /casos-carrusel\.js/);
  });

  test(`Los tres resultados de la ${nombre} destacan caso y plazo sin repetirlo`, () => {
    const casos = Array.from(html.matchAll(/<div class="case-timeline">([\\s\\S]*?)<\\/div>/g), m => m[1]);
    assert.equal(casos.length, 3);
    for (const [indice, plazo] of ['2 MESES', '1 MES', '1 MES'].entries()) {
      assert.match(casos[indice], new RegExp(`case-timeline-number">CASO 0${indice + 1}<`));
      assert.match(casos[indice], new RegExp(`case-timeline-duration">EN SOLO ${plazo}<`));
    }
    assert.doesNotMatch(html, /Otro caso ·|Resultados reales · 2 meses|CASO 0[123] · [12] MES/);
  });
}

test('El carrusel usa desplazamiento táctil natural y conserva los dos retratos juntos', () => {
  assert.match(estilos, /scroll-snap-type:x mandatory/);
  assert.match(estilos, /scroll-snap-align:start/);
  assert.match(estilos, /flex:0 0 100%/);
});

test('Las flechas, el contador, el teclado y el deslizamiento mantienen el caso activo', () => {
  const casos = Array.from({ length: 3 }, () => ({
    inert: false,
    setAttribute() {}
  }));
  const botones = () => ({
    disabled: false,
    addEventListener(tipo, fn) { this[tipo] = fn; }
  });
  const anterior = botones();
  const siguiente = botones();
  const contador = { textContent: '' };
  const pista = {
    children: casos,
    clientWidth: 400,
    scrollLeft: 0,
    addEventListener(tipo, fn) { this[tipo] = fn; },
    scrollTo({ left }) {
      this.scrollLeft = left;
      this.scroll();
    }
  };
  const carrusel = {
    querySelector(selector) {
      return {
        '[data-casos-pista]': pista,
        '[data-casos-anterior]': anterior,
        '[data-casos-siguiente]': siguiente,
        '[data-casos-contador]': contador
      }[selector];
    }
  };
  runInNewContext(codigo, {
    document: { querySelectorAll: () => [carrusel] },
    window: { matchMedia: () => ({ matches: false }) },
    requestAnimationFrame: callback => callback()
  });
  assert.equal(contador.textContent, '01 / 03');
  assert.equal(anterior.disabled, true);
  assert.equal(casos[1].inert, true);
  siguiente.click();
  assert.equal(contador.textContent, '02 / 03');
  assert.equal(anterior.disabled, false);
  assert.equal(casos[1].inert, false);
  pista.scrollLeft = 800;
  pista.scroll();
  assert.equal(contador.textContent, '03 / 03');
  assert.equal(siguiente.disabled, true);
  let prevented = false;
  pista.keydown({ key: 'ArrowLeft', preventDefault() { prevented = true; } });
  assert.equal(prevented, true);
  assert.equal(contador.textContent, '02 / 03');
});
