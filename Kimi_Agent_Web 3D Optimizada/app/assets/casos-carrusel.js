/* Carrusel compartido por la web y la presentación digital.
   Cada diapositiva contiene el par antes/después; sus visores siguen aparte. */
(() => {
  'use strict';
  document.querySelectorAll('[data-casos-carrusel]').forEach(carrusel => {
    const pista = carrusel.querySelector('[data-casos-pista]');
    const casos = [...pista.children];
    const anterior = carrusel.querySelector('[data-casos-anterior]');
    const siguiente = carrusel.querySelector('[data-casos-siguiente]');
    const contador = carrusel.querySelector('[data-casos-contador]');
    if (!casos.length || !anterior || !siguiente || !contador) return;

    let actual = 0;
    let programado = false;
    const numero = n => String(n).padStart(2, '0');
    function mostrar(n) {
      actual = Math.max(0, Math.min(n, casos.length - 1));
      anterior.disabled = actual === 0;
      siguiente.disabled = actual === casos.length - 1;
      contador.textContent = `${numero(actual + 1)} / ${numero(casos.length)}`;
      casos.forEach((caso, i) => {
        caso.setAttribute('aria-label', `Caso ${i + 1} de ${casos.length}`);
        caso.setAttribute('aria-roledescription', 'diapositiva');
        caso.inert = i !== actual;
      });
    }
    function mover(paso) {
      const destino = Math.max(0, Math.min(actual + paso, casos.length - 1));
      mostrar(destino);
      pista.scrollTo({
        left: destino * pista.clientWidth,
        behavior: window.matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth'
      });
    }
    function alDesplazar() {
      if (programado) return;
      programado = true;
      requestAnimationFrame(() => {
        programado = false;
        if (pista.clientWidth) mostrar(Math.round(pista.scrollLeft / pista.clientWidth));
      });
    }
    anterior.addEventListener('click', () => mover(-1));
    siguiente.addEventListener('click', () => mover(1));
    pista.addEventListener('scroll', alDesplazar, { passive: true });
    pista.addEventListener('keydown', event => {
      if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
      event.preventDefault();
      mover(event.key === 'ArrowRight' ? 1 : -1);
    });
    mostrar(0);
  });
})();
