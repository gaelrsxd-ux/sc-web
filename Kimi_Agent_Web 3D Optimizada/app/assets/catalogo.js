/* Configurador de la línea S&C Smart Displays.
   El pedido se prepara localmente y abre WhatsApp; no cobra ni almacena datos. */
(() => {
  'use strict';

  const raiz = document.getElementById('sc-catalogo');
  if (!raiz) return;

  // El visitante elige una línea: la otra no alarga la página ni distrae.
  const personalizados = raiz.querySelector('#sc-personalizados');
  const classic = raiz.querySelector('#sc-classic');
  const accesos = [...raiz.querySelectorAll('.sc-accesos a[href^="#sc-"]')];
  if (personalizados && classic && accesos.length === 2) {
    function mostrarLinea(linea) {
      const esClassic = linea === 'classic';
      personalizados.hidden = esClassic;
      classic.hidden = !esClassic;
      personalizados.dataset.scActivo = String(!esClassic);
      classic.dataset.scActivo = String(esClassic);
      accesos.forEach(acceso => {
        const activa = acceso.getAttribute('href') === (esClassic ? '#sc-classic' : '#sc-personalizados');
        if (activa) acceso.setAttribute('aria-current', 'page');
        else acceso.removeAttribute('aria-current');
      });
    }
    const sincronizarHash = () => {
      if (location.hash === '#sc-classic') mostrarLinea('classic');
      else if (location.hash === '#sc-personalizados' || location.hash === '#sc-config') {
        mostrarLinea('personalizados');
      }
    };
    accesos.forEach(acceso => {
      acceso.addEventListener('click', () => mostrarLinea(
        acceso.getAttribute('href') === '#sc-classic' ? 'classic' : 'personalizados'
      ));
    });
    mostrarLinea(location.hash === '#sc-classic' ? 'classic' : 'personalizados');
    addEventListener('hashchange', sincronizarHash);
    if (location.hash === '#sc-classic') {
      requestAnimationFrame(() => classic.scrollIntoView({ block: 'start' }));
    }
  }

  const modelo = raiz.querySelector('#sc-modelo');
  const colores = [
    { nombre: 'Negro', id: 'sc-negro', input: raiz.querySelector('#sc-negro') },
    { nombre: 'Plateado', id: 'sc-plateado', input: raiz.querySelector('#sc-plateado') },
    { nombre: 'Dorado', id: 'sc-dorado', input: raiz.querySelector('#sc-dorado') },
    { nombre: 'Blanco', id: 'sc-blanco', input: raiz.querySelector('#sc-blanco') }
  ];
  const resumen = raiz.querySelector('#sc-resumen');
  const total = raiz.querySelector('#sc-total');
  const enlace = raiz.querySelector('#sc-consulta');
  const aviso = raiz.querySelector('#sc-aviso');
  if (![modelo, resumen, total, enlace, aviso]
    .every(Boolean) || colores.some(color => !color.input)) return;

  const modelos = { tria: 'TRIA', signa: 'SIGNA' };

  function actualizar() {
    const nombre = modelos[modelo.value] || modelos.tria;
    // Las fotografías de bases pertenecen a SIGNA; TRIA conserva sus colores sin esas fotos.
    raiz.dataset.scModelo = modelo.value;

    raiz.querySelectorAll('[data-sc-tarjeta]').forEach(tarjeta => {
      tarjeta.dataset.scSeleccionado = String(tarjeta.dataset.scTarjeta === modelo.value);
    });

    const cantidades = colores.map(color => {
      const valor = color.input.value.trim();
      const n = Number(valor);
      return { nombre: color.nombre, n, valido: valor !== '' && Number.isSafeInteger(n) && n >= 0 };
    });
    const valido = cantidades.every(color => color.valido);
    const suma = cantidades.reduce((acum, color) => acum + color.n, 0);
    const activos = cantidades.filter(color => color.n > 0);

    resumen.textContent = `${nombre} · ${activos.length ? activos.map(color => `${color.n} ${color.nombre.toLowerCase()}${color.n === 1 ? '' : 's'}`).join(' · ') : 'sin piezas'}`;
    total.textContent = `${suma} ${suma === 1 ? 'pieza' : 'piezas'}`;

    if (!valido || !Number.isSafeInteger(suma) || suma < 1) {
      enlace.removeAttribute('href');
      enlace.setAttribute('aria-disabled', 'true');
      aviso.textContent = 'Indica al menos una pieza. Usa cantidades enteras de 0 en adelante.';
      return;
    }

    const partes = [
      'Hola, quiero cotizar exhibidores personalizados de S&C Solutions.',
      '',
      `*Modelo:* S&C ${nombre}`,
      `*Total:* ${suma} ${suma === 1 ? 'pieza' : 'piezas'}`,
      '',
      '*Colores y cantidades:*',
      ...activos.map(color => `• ${color.nombre}: ${color.n}`),
      '',
      'Les enviaré mi logotipo por este chat para definir juntos el diseño, los enlaces NFC/QR y los acabados.',
      '',
      '¿Me comparten el precio y tiempo de entrega?'
    ];

    enlace.href = 'https://wa.me/524423697248?text=' + encodeURIComponent(partes.join('\n'));
    enlace.removeAttribute('aria-disabled');
    enlace.textContent = 'Cotizar por WhatsApp';
    aviso.textContent = 'En WhatsApp nos envías tu logotipo y definimos juntos el diseño, enlaces NFC/QR, precio y entrega.';
  }

  raiz.querySelectorAll('[data-sc-elegir]').forEach(enlaceModelo => {
    enlaceModelo.addEventListener('click', () => {
      if (modelos[enlaceModelo.dataset.scElegir]) {
        modelo.value = enlaceModelo.dataset.scElegir;
        actualizar();
      }
    });
  });

  raiz.querySelectorAll('[data-sc-paso]').forEach(boton => {
    boton.addEventListener('click', () => {
      const color = colores.find(item => item.id === boton.dataset.scPara);
      if (!color) return;
      const actual = Number(color.input.value);
      const base = Number.isSafeInteger(actual) && actual >= 0 ? actual : 0;
      const paso = Number(boton.dataset.scPaso);
      color.input.value = String(Math.min(Number.MAX_SAFE_INTEGER, Math.max(0, base + paso)));
      actualizar();
    });
  });

  // Las miniaturas muestran otra vista sin abrir la ficha ni cambiar el modelo.
  raiz.querySelectorAll('[data-sc-vista]').forEach(boton => {
    boton.addEventListener('click', () => {
      const tarjeta = boton.closest('[data-sc-tarjeta]');
      const foto = tarjeta?.querySelector('.sc-modelo-imagen');
      if (!foto) return;
      foto.src = boton.dataset.scVista;
      foto.alt = boton.dataset.scAlt;
      tarjeta.querySelectorAll('[data-sc-vista]').forEach(b => {
        b.setAttribute('aria-pressed', String(b === boton));
      });
    });
  });

  raiz.addEventListener('input', actualizar);
  raiz.addEventListener('change', actualizar);
  actualizar();
})();

/* Fotos de productos y acabados: ampliación con navegación por modelo.
   El diálogo nativo mantiene el cierre al tocar la foto o el fondo. */
(() => {
  'use strict';
  const raiz = document.getElementById('sc-catalogo');
  if (!raiz || typeof document.createElement !== 'function' || !document.body) return;
  const muestras = [...raiz.querySelectorAll('.sc-color-ver, .sc-foto-abrir')];
  if (!muestras.length) return;

  const modal = document.createElement('dialog');
  modal.className = 'sc-color-modal';
  modal.setAttribute('aria-label', 'Fotografía ampliada del exhibidor');
  const imagen = document.createElement('img');
  imagen.className = 'sc-color-modal__img';
  const anterior = document.createElement('button');
  anterior.type = 'button';
  anterior.className = 'sc-color-modal__flecha sc-color-modal__flecha--anterior';
  anterior.textContent = '‹';
  anterior.setAttribute('aria-label', 'Fotografía anterior');
  anterior.hidden = true;
  const siguiente = document.createElement('button');
  siguiente.type = 'button';
  siguiente.className = 'sc-color-modal__flecha sc-color-modal__flecha--siguiente';
  siguiente.textContent = '›';
  siguiente.setAttribute('aria-label', 'Fotografía siguiente');
  siguiente.hidden = true;
  const contador = document.createElement('span');
  contador.className = 'sc-color-modal__contador';
  contador.setAttribute('aria-live', 'polite');
  contador.hidden = true;
  const cerrarBoton = document.createElement('button');
  cerrarBoton.type = 'button';
  cerrarBoton.className = 'sc-color-modal__cerrar';
  cerrarBoton.textContent = '×';
  cerrarBoton.setAttribute('aria-label', 'Cerrar fotografía');
  modal.append(imagen, anterior, siguiente, contador, cerrarBoton);
  document.body.appendChild(modal);

  let origen = null;
  let overflowAnterior = '';
  let vistas = [];
  let indice = 0;
  function cerrar() { if (modal.open) modal.close(); }

  function mostrarVista(nueva) {
    if (nueva < 0 || nueva >= vistas.length) return;
    indice = nueva;
    const vista = vistas[indice];
    imagen.src = vista.src;
    imagen.alt = vista.alt;
    anterior.hidden = indice === 0;
    siguiente.hidden = indice === vistas.length - 1;
    contador.hidden = vistas.length < 2;
    contador.textContent = String(indice + 1) + ' / ' + vistas.length;
    // Mantiene la miniatura y la portada sincronizadas al cerrar la ampliación.
    if (vista.boton) vista.boton.click();
  }

  muestras.forEach(boton => boton.addEventListener('click', () => {
    const miniatura = boton.querySelector('img');
    if (!miniatura || typeof modal.showModal !== 'function') return;
    const producto = boton.classList.contains('sc-foto-abrir');
    const tarjeta = producto ? boton.closest('[data-sc-tarjeta]') : null;
    const botones = tarjeta ? [...tarjeta.querySelectorAll('[data-sc-vista]')] : [];
    vistas = botones.length
      ? botones.map(b => ({ src: b.dataset.scVista, alt: b.dataset.scAlt, boton: b }))
      : [{ src: miniatura.currentSrc || miniatura.getAttribute('src'), alt: miniatura.alt }];
    const seleccionada = botones.findIndex(b => b.getAttribute('aria-pressed') === 'true');
    modal.classList.toggle('sc-color-modal--producto', producto);
    origen = boton;
    overflowAnterior = document.documentElement.style.overflow;
    mostrarVista(seleccionada >= 0 ? seleccionada : 0);
    modal.showModal();
    document.documentElement.style.overflow = 'hidden';
    cerrarBoton.focus();
  }));

  anterior.addEventListener('click', evento => {
    evento.stopPropagation();
    mostrarVista(indice - 1);
  });
  siguiente.addEventListener('click', evento => {
    evento.stopPropagation();
    mostrarVista(indice + 1);
  });
  modal.addEventListener('keydown', evento => {
    if (vistas.length < 2) return;
    if (evento.key === 'ArrowLeft' || evento.key === 'ArrowRight') {
      evento.preventDefault();
      mostrarVista(indice + (evento.key === 'ArrowRight' ? 1 : -1));
    }
  });
  // Tocar la fotografía o el fondo sigue cerrando el diálogo; las flechas no.
  modal.addEventListener('click', cerrar);
  cerrarBoton.addEventListener('click', cerrar);
  modal.addEventListener('close', () => {
    document.documentElement.style.overflow = overflowAnterior;
    imagen.removeAttribute('src');
    vistas = [];
    indice = 0;
    if (origen && origen.isConnected) origen.focus();
  });
})();
