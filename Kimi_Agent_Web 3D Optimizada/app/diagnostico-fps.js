/* A/B definitivo. TEMPORAL: se activa sólo con ?fps.

   Lo ya medido: la página rinde ~22 fps en régimen estable (los 175 fps del
   arranque eran una ventana falsa, con la página aún sin pintar) y la memoria
   no crece, así que no hay fuga. El costo es de composición: en una pantalla de
   2552 px cada capa a pantalla completa son 3,3 millones de píxeles, y el fondo
   compone unas seis por fotograma.

   Los dos planos de la ciudad concentran el 90% del área animada de la web
   (6,7 millones de px² frente a los 282.000 del rombo), y animan scale() y
   rotateY() sobre imágenes enmascaradas: eso obliga a re-rasterizar la capa
   entera en cada fotograma en vez de componerla tal cual.

   Esta prueba mide cuatro escenarios de 14 s en una sola carga, alternando en
   caliente para que todos partan de la misma página ya pintada. Así se sabe con
   número cuánto devuelve cada cosa, sin tocar ni una animación decorativa. */
(() => {
  const TRAMO = 14;   /* segundos por escenario */

  const ESCENARIOS = [
    ['tal como está ahora', ''],
    ['sin el vuelo de dron de la ciudad (mantiene el paralaje del scroll)',
      '#preloader.done ~ #descenso .esc.ciudad::before,' +
      '#preloader.done ~ #descenso .esc.ciudad::after{animation:none!important}'],
    ['sin las máscaras de los dos planos',
      '.esc.ciudad::before,.esc.ciudad::after{-webkit-mask-image:none!important;mask-image:none!important}'],
    ['sin dron y sin máscaras',
      '#preloader.done ~ #descenso .esc.ciudad::before,' +
      '#preloader.done ~ #descenso .esc.ciudad::after{animation:none!important}' +
      '.esc.ciudad::before,.esc.ciudad::after{-webkit-mask-image:none!important;mask-image:none!important}']
  ];

  const p = document.createElement('div');
  p.style.cssText = 'position:fixed;top:12px;right:12px;z-index:99999;min-width:250px;max-width:330px;' +
    'background:rgba(10,11,14,.94);color:#F4F1EA;font:12px/1.5 Consolas,monospace;' +
    'padding:14px 16px;border:1px solid #C8A96A;border-radius:8px;pointer-events:none';
  p.innerHTML = '<div id="d-fps" style="font:700 30px/1 Consolas,monospace;color:#E4CD9A">— fps</div>' +
    '<div id="d-info" style="margin-top:8px;color:#9A958A"></div>';
  document.documentElement.appendChild(p);
  const elFps = p.querySelector('#d-fps');
  const elInfo = p.querySelector('#d-info');

  const hoja = document.createElement('style');
  document.head.appendChild(hoja);

  const res = [];
  let y = 0, dir = 1;

  /* Un único bucle de scroll y de conteo para los cuatro escenarios: cambiar de
     escenario sólo cambia la hoja de estilo, sin recargar ni reiniciar nada. */
  function corre(idx) {
    return new Promise(fin => {
      const [nombre, css] = ESCENARIOS[idx];
      hoja.textContent = css;
      const fps = [];
      let t0 = 0, ultimoSeg = 0, frames = 0, arrancado = false;

      /* Se descarta el primer segundo de cada tramo: al cambiar la hoja el
         navegador rehace capas, y ese pico no representa el régimen estable. */
      let calienta = true;

      function bucle(n) {
        if (document.hidden) {
          elFps.textContent = 'en pausa';
          elInfo.innerHTML = 'Vuelve a esta pestaña';
          requestAnimationFrame(bucle);
          return;
        }
        if (!arrancado) { arrancado = true; t0 = ultimoSeg = n; }

        frames++;
        const alto = Math.max(1, document.body.scrollHeight - innerHeight);
        y += dir * 22;
        if (y >= alto) { y = alto; dir = -1; } else if (y <= 0) { y = 0; dir = 1; }
        window.scrollTo({ top: y, behavior: 'instant' });

        if (n - ultimoSeg >= 1000) {
          const f = Math.round(frames * 1000 / (n - ultimoSeg));
          if (calienta) calienta = false; else fps.push(f);
          elFps.textContent = f + ' fps';
          elFps.style.color = f < 30 ? '#E06A5A' : f < 50 ? '#E4CD9A' : '#8FBF7F';
          elInfo.innerHTML = 'Escenario ' + (idx + 1) + ' de ' + ESCENARIOS.length +
            '<br><span style="color:#F4F1EA">' + nombre + '</span>' +
            '<br>' + Math.round((n - t0) / 1000) + '/' + TRAMO + ' s';
          ultimoSeg = n; frames = 0;
        }

        if (n - t0 < TRAMO * 1000) requestAnimationFrame(bucle);
        else {
          const o = [...fps].sort((a, b) => a - b);
          res.push({
            nombre,
            mediana: o.length ? o[Math.floor(o.length / 2)] : 0,
            min: o.length ? o[0] : 0,
            max: o.length ? o[o.length - 1] : 0,
            muestras: o.length
          });
          fin();
        }
      }
      requestAnimationFrame(bucle);
    });
  }

  (async () => {
    for (let i = 0; i < ESCENARIOS.length; i++) await corre(i);
    hoja.textContent = '';

    const base = res[0].mediana;
    let enviado = false;
    try {
      await fetch('/resultado-fps', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          medido: new Date().toISOString(), tipo: 'ab-ciudad',
          base, escenarios: res,
          entorno: {
            navegador: navigator.userAgent, pantalla: innerWidth + 'x' + innerHeight,
            densidad: devicePixelRatio, nucleos: navigator.hardwareConcurrency || null
          }
        })
      });
      enviado = true;
    } catch (e) { }

    p.style.pointerEvents = 'auto';
    const filas = res.map(r => {
      const d = r.mediana - base;
      const bueno = d >= 8;
      return '<tr style="' + (bueno ? 'color:#8FBF7F;font-weight:700' : '') + '">' +
        '<td style="padding:3px 10px 3px 0;vertical-align:top">' + r.nombre + '</td>' +
        '<td style="padding:3px 0;text-align:right;vertical-align:top;white-space:nowrap">' +
        r.mediana + ' fps' + (r === res[0] ? '' : '<br><span style="color:#9A958A">' +
          (d > 0 ? '+' : '') + d + '</span>') + '</td></tr>';
    }).join('');
    elFps.textContent = 'Listo';
    elInfo.innerHTML = '<table style="border-collapse:collapse;margin:8px 0">' + filas + '</table>' +
      '<div style="color:' + (enviado ? '#8FBF7F' : '#E4CD9A') + '">' +
      (enviado ? 'Enviado. Escribe <b>listo</b> en el chat.' : 'Manda una foto de este panel.') + '</div>' +
      '<div style="margin-top:8px"><a href="' + location.pathname + '" style="color:#E4CD9A">Volver a la web</a></div>';
  })();
})();
