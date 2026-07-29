/* Diagnóstico de fluidez. TEMPORAL: se carga sólo al abrir la página con ?fps
   y se puede borrar junto a su línea en index.html cuando ya no haga falta.

   Mide los fotogramas mientras la página se desplaza sola, repite la medición
   desactivando un sospechoso distinto cada vez, y pinta la tabla en pantalla
   para no depender de la consola del navegador. No toca ningún archivo: todo
   se deshace recargando sin ?fps. */
(() => {
  const esperar = ms => new Promise(r => setTimeout(r, ms));

  const caja = document.createElement('div');
  caja.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0A0B0E;' +
    'color:#F4F1EA;font:14px/1.6 Consolas,monospace;padding:26px;overflow:auto';
  caja.innerHTML = '<h2 style="font:600 20px/1.3 Georgia,serif;color:#E4CD9A;margin:0 0 6px">' +
    'Midiendo la fluidez</h2><p id="fps-est" style="color:#9A958A;margin:0 0 18px">' +
    'Tarda unos 30 segundos. No toques la ventana ni cambies de pestaña.</p>' +
    '<div id="fps-out"></div>';
  document.documentElement.appendChild(caja);
  const est = document.getElementById('fps-est');
  const out = document.getElementById('fps-out');

  /* La caja tapa la página, pero lo que se mide es el coste de pintarla, que
     sigue ocurriendo debajo. Se aparta durante cada medición. */
  const ocultaCaja = v => caja.style.visibility = v ? 'visible' : 'hidden';

  function medir(segundos) {
    return new Promise(res => {
      const t = [];
      let ultimo = performance.now();
      const inicio = ultimo;
      let y = 0;
      const alto = Math.max(1, document.body.scrollHeight - innerHeight);
      const scroll = setInterval(() => {
        y = (y + 26) % alto;
        window.scrollTo({ top: y, behavior: 'instant' });
      }, 16);
      const corta = setTimeout(() => { clearInterval(scroll); acabar(); }, segundos * 1000 + 1500);
      let hecho = false;
      function acabar() {
        if (hecho) return; hecho = true;
        clearTimeout(corta); clearInterval(scroll);
        if (t.length < 6) return res({ fps: 0, peor: 0, lentos: 0, fallo: true });
        t.shift();
        const orden = [...t].sort((a, b) => a - b);
        res({
          fps: +(1000 / (t.reduce((a, b) => a + b, 0) / t.length)).toFixed(1),
          peor: +orden[orden.length - 1].toFixed(1),
          lentos: t.filter(x => x > 32).length
        });
      }
      (function paso(n) {
        if (hecho) return;
        t.push(n - ultimo); ultimo = n;
        if (n - inicio < segundos * 1000) requestAnimationFrame(paso); else acabar();
      })(performance.now());
    });
  }

  const hoja = document.createElement('style');
  document.head.appendChild(hoja);

  const pruebas = [
    ['SIN TOCAR NADA', ''],
    ['sin las capas del descenso', '#descenso{display:none!important}'],
    ['sin los dos planos de la ciudad', '.esc.ciudad::before,.esc.ciudad::after{display:none!important}'],
    ['sin las mascaras de la ciudad', '.esc.ciudad::before,.esc.ciudad::after{-webkit-mask-image:none!important;mask-image:none!important}'],
    ['sin will-change (capas GPU fijas)', '*{will-change:auto!important}'],
    ['sin desenfoques', '*{filter:none!important;backdrop-filter:none!important}'],
    ['sin ninguna animacion', '*,*::before,*::after{animation:none!important;transition:none!important}'],
    ['sin el velo y la veta', '#velo,#veta{display:none!important}'],
    ['sin relieve 3D en servicios', '.svc-grid{perspective:none!important}.svc{transform:none!important}']
  ];

  (async () => {
    const res = [];
    for (let i = 0; i < pruebas.length; i++) {
      const [nombre, css] = pruebas[i];
      est.textContent = 'Prueba ' + (i + 1) + ' de ' + pruebas.length + ': ' + nombre;
      hoja.textContent = css;
      await esperar(450);
      ocultaCaja(false);
      const m = await medir(2.6);
      ocultaCaja(true);
      res.push({ nombre, ...m });
    }
    hoja.textContent = '';

    const base = res[0].fps;
    const orden = [...res].sort((a, b) => b.fps - a.fps);
    const filas = orden.map(r => {
      const dif = r.nombre === 'SIN TOCAR NADA' ? '—'
        : (r.fps - base > 0 ? '+' : '') + (r.fps - base).toFixed(1);
      const culpable = r.fps - base >= 8 && r.nombre !== 'SIN TOCAR NADA';
      return '<tr style="' + (culpable ? 'color:#E4CD9A;font-weight:700' : '') + '">' +
        '<td style="padding:7px 16px 7px 0">' + r.nombre + '</td>' +
        '<td style="padding:7px 16px;text-align:right">' + (r.fallo ? 'sin datos' : r.fps + ' fps') + '</td>' +
        '<td style="padding:7px 16px;text-align:right">' + dif + '</td>' +
        '<td style="padding:7px 0;text-align:right;color:#9A958A">' + r.peor + ' ms</td></tr>';
    }).join('');

    /* Se envía al servidor para no depender de capturas de pantalla. Si el
       servidor no tiene buzón, no pasa nada: la tabla sigue en pantalla. */
    let enviado = false;
    try {
      await fetch('/resultado-fps', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medido: new Date().toISOString(),
          base: base,
          pruebas: res,
          entorno: {
            navegador: navigator.userAgent,
            pantalla: innerWidth + 'x' + innerHeight,
            densidad: devicePixelRatio,
            nucleos: navigator.hardwareConcurrency || null,
            paginaAlto: document.body.scrollHeight
          }
        })
      });
      enviado = true;
    } catch (e) { /* sin buzón: queda la tabla en pantalla */ }

    est.innerHTML = enviado
      ? '<b style="color:#E4CD9A">Listo.</b> Los resultados ya se han enviado. ' +
        'Vuelve al chat y escribe <b>listo</b>.'
      : '<b style="color:#E4CD9A">Listo.</b> Manda una foto de esta pantalla, ' +
        'o lee en voz alta las dos primeras filas.';
    out.innerHTML =
      '<table style="border-collapse:collapse;margin:4px 0 22px"><thead><tr style="color:#9A958A">' +
      '<th style="text-align:left;padding:0 16px 8px 0">prueba</th>' +
      '<th style="text-align:right;padding:0 16px 8px">fotogramas</th>' +
      '<th style="text-align:right;padding:0 16px 8px">gana</th>' +
      '<th style="text-align:right;padding:0 0 8px">peor frame</th>' +
      '</tr></thead><tbody>' + filas + '</tbody></table>' +
      '<p style="color:#9A958A;margin:0 0 6px">Lo resaltado es lo que mas devuelve. ' +
      'La fila "SIN TOCAR NADA" es el punto de partida (' + base + ' fps).</p>' +
      '<p style="color:#5E5A52;margin:0">' + navigator.userAgent + '<br>pantalla ' +
      innerWidth + '&times;' + innerHeight + ' &middot; densidad ' + devicePixelRatio +
      ' &middot; nucleos ' + (navigator.hardwareConcurrency || '?') + '</p>' +
      '<p style="margin:20px 0 0"><a href="' + location.pathname + '" ' +
      'style="color:#E4CD9A">Volver a la web normal</a></p>';
  })();
})();
