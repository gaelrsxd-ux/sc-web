/* Diagnóstico de fluidez, segunda versión. TEMPORAL: se activa sólo con ?fps.

   La primera versión medía las nueve pruebas seguidas en la misma carga y sus
   datos salieron inservibles: la página se degrada con el uso, así que cada
   prueba partía peor que la anterior y el deterioro tapaba por completo la
   señal de cada componente.

   Aquí cada prueba corre en una carga limpia y la página se recarga entre una
   y otra. Además mide el deterioro a propósito: repite la prueba base al
   final, después de haber recorrido la página entera, para poner número a
   cuánto se pierde por el simple hecho de usarla. */
(() => {
  const LLAVE = 'syc-diag-fps';
  const esperar = ms => new Promise(r => setTimeout(r, ms));

  const PRUEBAS = [
    ['base — sin tocar nada', ''],
    ['sin las capas del descenso', '#descenso{display:none!important}'],
    ['sin los dos planos de la ciudad', '.esc.ciudad::before,.esc.ciudad::after{display:none!important}'],
    ['sin las mascaras de la ciudad', '.esc.ciudad::before,.esc.ciudad::after{-webkit-mask-image:none!important;mask-image:none!important}'],
    ['sin will-change (capas GPU)', '*{will-change:auto!important}'],
    ['sin desenfoques', '*{filter:none!important;backdrop-filter:none!important}'],
    ['sin ninguna animacion', '*,*::before,*::after{animation:none!important;transition:none!important}'],
    ['sin el velo y la veta', '#velo,#veta{display:none!important}'],
    ['sin relieve 3D en servicios', '.svc-grid{perspective:none!important}.svc{transform:none!important}'],
    ['DETERIORO — base tras recorrer la pagina', '']
  ];

  let est;
  try { est = JSON.parse(sessionStorage.getItem(LLAVE)) || null; } catch (e) { est = null; }
  if (!est) est = { i: 0, res: [] };

  const caja = document.createElement('div');
  caja.style.cssText = 'position:fixed;inset:0;z-index:99999;background:#0A0B0E;color:#F4F1EA;' +
    'font:14px/1.6 Consolas,monospace;padding:26px;overflow:auto';
  document.documentElement.appendChild(caja);
  const escribe = h => caja.innerHTML = h;

  /* La caja tapa la página; se aparta mientras se mide para no falsear nada */
  const tapa = v => caja.style.visibility = v ? 'visible' : 'hidden';

  function medir(segundos, recorrerTodo) {
    return new Promise(res => {
      const t = [];
      let ultimo = performance.now();
      const inicio = ultimo;
      let y = 0;
      const alto = Math.max(1, document.body.scrollHeight - innerHeight);
      /* recorrerTodo acelera el barrido para pasar por la página completa */
      const salto = recorrerTodo ? 90 : 26;
      const scroll = setInterval(() => {
        y = (y + salto) % alto;
        window.scrollTo({ top: y, behavior: 'instant' });
      }, 16);
      let hecho = false;
      const corta = setTimeout(() => acabar(), segundos * 1000 + 2000);
      function acabar() {
        if (hecho) return; hecho = true;
        clearTimeout(corta); clearInterval(scroll);
        if (t.length < 6) return res({ fps: 0, peor: 0, lentos: 0, fallo: true });
        t.shift();
        const o = [...t].sort((a, b) => a - b);
        res({
          fps: +(1000 / (t.reduce((a, b) => a + b, 0) / t.length)).toFixed(1),
          p50: +o[Math.floor(o.length * .5)].toFixed(1),
          p95: +o[Math.floor(o.length * .95)].toFixed(1),
          peor: +o[o.length - 1].toFixed(1),
          lentos: t.filter(x => x > 32).length,
          frames: t.length
        });
      }
      (function paso(n) {
        if (hecho) return;
        t.push(n - ultimo); ultimo = n;
        if (n - inicio < segundos * 1000) requestAnimationFrame(paso); else acabar();
      })(performance.now());
    });
  }

  (async () => {
    /* ---- ya terminó: informe ---- */
    if (est.i >= PRUEBAS.length) {
      sessionStorage.removeItem(LLAVE);
      const base = est.res[0].fps;
      const deterioro = est.res[est.res.length - 1];
      const comps = est.res.slice(1, -1).sort((a, b) => b.fps - a.fps);

      let enviado = false;
      try {
        await fetch('/resultado-fps', {
          method: 'POST', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            medido: new Date().toISOString(), version: 2,
            base: base, pruebas: est.res,
            entorno: {
              navegador: navigator.userAgent, pantalla: innerWidth + 'x' + innerHeight,
              densidad: devicePixelRatio, nucleos: navigator.hardwareConcurrency || null,
              paginaAlto: document.body.scrollHeight,
              memoriaJS: performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) + ' MB' : null
            }
          })
        });
        enviado = true;
      } catch (e) { }

      const fila = p => {
        const d = (p.fps - base > 0 ? '+' : '') + (p.fps - base).toFixed(1);
        const culpa = p.fps - base >= 10;
        return '<tr style="' + (culpa ? 'color:#E4CD9A;font-weight:700' : '') + '">' +
          '<td style="padding:6px 16px 6px 0">' + p.nombre + '</td>' +
          '<td style="padding:6px 14px;text-align:right">' + (p.fallo ? 'sin datos' : p.fps) + '</td>' +
          '<td style="padding:6px 14px;text-align:right">' + d + '</td>' +
          '<td style="padding:6px 0;text-align:right;color:#9A958A">' + p.peor + ' ms</td></tr>';
      };
      escribe('<h2 style="font:600 21px/1.3 Georgia,serif;color:#E4CD9A;margin:0 0 4px">Resultado</h2>' +
        '<p style="color:#9A958A;margin:0 0 20px">' + (enviado
          ? 'Enviado. Vuelve al chat y escribe <b style="color:#F4F1EA">listo</b>.'
          : 'No se pudo enviar: manda una foto de esta pantalla.') + '</p>' +
        '<table style="border-collapse:collapse"><thead><tr style="color:#9A958A">' +
        '<th style="text-align:left;padding:0 16px 8px 0">prueba</th>' +
        '<th style="text-align:right;padding:0 14px 8px">fps</th>' +
        '<th style="text-align:right;padding:0 14px 8px">gana</th>' +
        '<th style="text-align:right;padding:0 0 8px">peor</th></tr></thead><tbody>' +
        fila(est.res[0]) + comps.map(fila).join('') +
        '<tr><td colspan="4" style="padding:10px 0 4px;color:#5E5A52">— — —</td></tr>' +
        fila(deterioro) + '</tbody></table>' +
        '<p style="margin:18px 0 0;color:#9A958A">Base ' + base + ' fps &rarr; tras recorrer la pagina ' +
        deterioro.fps + ' fps (' + (deterioro.fps - base).toFixed(1) + ')</p>' +
        '<p style="margin:16px 0 0"><a href="' + location.pathname + '" style="color:#E4CD9A">Volver a la web</a></p>');
      return;
    }

    /* ---- ejecuta la prueba que toca y recarga ---- */
    const [nombre, css] = PRUEBAS[est.i];
    const esDeterioro = est.i === PRUEBAS.length - 1;
    escribe('<h2 style="font:600 21px/1.3 Georgia,serif;color:#E4CD9A;margin:0 0 4px">Midiendo</h2>' +
      '<p style="color:#9A958A;margin:0">Prueba ' + (est.i + 1) + ' de ' + PRUEBAS.length + ': ' + nombre + '</p>' +
      '<p style="color:#5E5A52;margin:14px 0 0">La pagina se recargara sola entre pruebas. No toques nada.</p>');

    const hoja = document.createElement('style');
    hoja.textContent = css;
    document.head.appendChild(hoja);
    await esperar(900);

    /* Para la prueba de deterioro: recorrer toda la página antes de medir */
    if (esDeterioro) { tapa(false); await medir(9, true); }

    tapa(false);
    const m = await medir(3);
    tapa(true);

    est.res.push({ nombre, ...m });
    est.i++;
    sessionStorage.setItem(LLAVE, JSON.stringify(est));
    location.replace(location.pathname + '?fps');
  })();
})();
