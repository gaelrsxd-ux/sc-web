/* Configurador de la línea S&C Smart Displays.
   El pedido se prepara localmente y abre WhatsApp; no cobra ni almacena datos. */
(() => {
  'use strict';

  const raiz = document.getElementById('sc-catalogo');
  if (!raiz) return;

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
      `Modelo: S&C ${nombre}`,
      `Total: ${suma} ${suma === 1 ? 'pieza' : 'piezas'}`,
      'Colores y cantidades:',
      ...activos.map(color => `- ${color.nombre}: ${color.n}`)
    ];
    partes.push('Quiero enviarles el logotipo de mi marca por este chat y definir con ustedes el diseño, los enlaces NFC/QR y los acabados. ¿Me comparten precio y tiempo de entrega?');

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
