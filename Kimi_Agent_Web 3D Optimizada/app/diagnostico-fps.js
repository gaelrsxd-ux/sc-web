/* Medidor de fluidez EN VIVO. TEMPORAL: se activa sólo con ?fps.

   Las versiones anteriores medían por tramos y no captaron el deterioro con el
   tiempo —el síntoma real en PC— porque la pestaña se iba a segundo plano.
   Esta corre una sola vez, de forma continua: desplaza la página sola durante
   60 s y muestra en pantalla, en vivo, los fotogramas por segundo, el mínimo,
   la memoria y en qué punto va. Así se ve CUÁNDO cae y si la memoria crece.
   No hay que hacer clic ni cambiar de pestaña: sólo mirar. */
(() => {
  const DURACION = 60;               /* segundos de medición */
  const muestras = [];               /* {t, fps, heap, y} cada segundo */

  /* Panel pequeño en una esquina: la página se ve y se mide por debajo */
  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;min-width:230px;' +
    'background:rgba(10,11,14,.92);color:#F4F1EA;font:12px/1.5 Consolas,monospace;' +
    'padding:14px 16px;border:1px solid #C8A96A;border-radius:8px;pointer-events:none';
  p.innerHTML = '<div id="d-fps" style="font:700 30px/1 Consolas,monospace;color:#E4CD9A">— fps</div>' +
    '<div id="d-info" style="margin-top:8px;color:#9A958A"></div>';
  document.documentElement.appendChild(p);
  const elFps = p.querySelector('#d-fps');
  const elInfo = p.querySelector('#d-info');

  const seccionEn = y => {
    const secs = [...document.querySelectorAll('main > *[id],section[id]')];
    let best = '—', bd = 1e9;
    const mid = y + innerHeight / 2;
    secs.forEach(s => {
      const t = s.offsetTop, b = t + s.offsetHeight;
      const d = mid < t ? t - mid : mid > b ? mid - b : 0;
      if (d < bd) { bd = d; best = s.id; }
    });
    return best;
  };

  let t0 = performance.now();
  let ultimoSeg = t0;
  let framesSeg = 0;
  let ultimo = t0;
  let minFps = 999;
  let dir = 1, y = 0;
  let pausadoPorOculto = false;

  function bucle(n) {
    /* Si la pestaña se oculta, rAF se congela: se avisa y no se contamina */
    if (document.hidden) {
      pausadoPorOculto = true;
      elFps.textContent = 'en pausa';
      elInfo.innerHTML = 'Vuelve a esta pestaña<br>para seguir midiendo';
      requestAnimationFrame(bucle);
      return;
    }
    if (pausadoPorOculto) { pausadoPorOculto = false; ultimo = ultimoSeg = n; framesSeg = 0; }

    framesSeg++;
    ultimo = n;

    /* Auto-scroll: baja y sube, recorriendo toda la página */
    const alto = Math.max(1, document.body.scrollHeight - innerHeight);
    y += dir * 22;
    if (y >= alto) { y = alto; dir = -1; }
    else if (y <= 0) { y = 0; dir = 1; }
    window.scrollTo({ top: y, behavior: 'instant' });

    /* Cada segundo: registra y pinta */
    if (n - ultimoSeg >= 1000) {
      const fps = Math.round(framesSeg * 1000 / (n - ultimoSeg));
      const heap = performance.memory ? Math.round(performance.memory.usedJSHeapSize / 1048576) : null;
      const seg = Math.round((n - t0) / 1000);
      muestras.push({ t: seg, fps, heap, y: Math.round(y), sec: seccionEn(y) });
      if (fps < minFps) minFps = fps;
      elFps.textContent = fps + ' fps';
      elFps.style.color = fps < 30 ? '#E06A5A' : fps < 50 ? '#E4CD9A' : '#8FBF7F';
      elInfo.innerHTML = 'min ' + minFps + ' fps &middot; ' + seg + '/' + DURACION + ' s<br>' +
        (heap != null ? 'memoria ' + heap + ' MB<br>' : '') + 'seccion: ' + muestras[muestras.length - 1].sec;
      ultimoSeg = n;
      framesSeg = 0;
    }

    if (n - t0 < DURACION * 1000) requestAnimationFrame(bucle);
    else finaliza();
  }

  async function finaliza() {
    const fps = muestras.map(m => m.fps);
    const heaps = muestras.map(m => m.heap).filter(h => h != null);
    const inicio = Math.round(fps.slice(0, 5).reduce((a, b) => a + b, 0) / Math.min(5, fps.length));
    const final = Math.round(fps.slice(-5).reduce((a, b) => a + b, 0) / Math.min(5, fps.length));
    const resumen = {
      medido: new Date().toISOString(), tipo: 'vivo',
      inicio_fps: inicio, final_fps: final, min_fps: Math.min(...fps),
      cayo: inicio - final,
      heap_inicial: heaps[0] || null, heap_final: heaps[heaps.length - 1] || null,
      serie: muestras,
      entorno: {
        navegador: navigator.userAgent, pantalla: innerWidth + 'x' + innerHeight,
        densidad: devicePixelRatio, nucleos: navigator.hardwareConcurrency || null,
        paginaAlto: document.body.scrollHeight
      }
    };
    let enviado = false;
    try {
      await fetch('/resultado-fps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(resumen)
      });
      enviado = true;
    } catch (e) { }

    p.style.pointerEvents = 'auto';
    p.style.minWidth = '300px';
    const filas = muestras.filter((m, i) => i % 5 === 0 || i === muestras.length - 1)
      .map(m => '<tr><td style="padding:1px 10px 1px 0">' + m.t + ' s</td>' +
        '<td style="padding:1px 10px;text-align:right;color:' +
        (m.fps < 30 ? '#E06A5A' : '#F4F1EA') + '">' + m.fps + ' fps</td>' +
        '<td style="padding:1px 0;color:#9A958A">' + (m.heap != null ? m.heap + ' MB' : '') +
        ' &middot; ' + m.sec + '</td></tr>').join('');
    elFps.textContent = 'Listo';
    elInfo.innerHTML =
      '<div style="margin:8px 0;color:#F4F1EA">Empezó a <b>' + inicio + '</b> y terminó a <b>' + final +
      '</b> fps.<br>Mínimo ' + Math.min(...fps) + '. ' +
      (heaps.length ? 'Memoria ' + heaps[0] + '&rarr;' + heaps[heaps.length - 1] + ' MB.' : '') + '</div>' +
      '<table style="border-collapse:collapse;margin-top:4px">' + filas + '</table>' +
      '<div style="margin-top:10px;color:' + (enviado ? '#8FBF7F' : '#E4CD9A') + '">' +
      (enviado ? 'Enviado. Vuelve al chat y escribe <b>listo</b>.'
        : 'No se pudo enviar. Manda una foto de este panel.') + '</div>' +
      '<div style="margin-top:8px"><a href="' + location.pathname + '" style="color:#E4CD9A">Volver a la web</a></div>';
  }

  requestAnimationFrame(bucle);
})();
