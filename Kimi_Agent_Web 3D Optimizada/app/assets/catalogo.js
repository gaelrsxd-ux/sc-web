/* Configurador de la línea S&C Smart Displays.
   La cotización se prepara en el navegador: no hay cobro, almacenamiento ni API. */
(() => {
  'use strict';

  const raiz = document.getElementById('sc-catalogo');
  if (!raiz) return;

  const modelo = raiz.querySelector('#sc-modelo');
  const base = raiz.querySelectorAll('input[name="sc-base"]');
  const cantidad = raiz.querySelector('#sc-cantidad');
  const destino = raiz.querySelector('#sc-destino');
  const extra = raiz.querySelector('#sc-extra');
  const red1 = raiz.querySelector('#sc-red1');
  const red2 = raiz.querySelector('#sc-red2');
  const cambioBase = raiz.querySelector('#sc-cambio-base');
  const negocio = raiz.querySelector('#sc-negocio');
  const notas = raiz.querySelector('#sc-notas');
  const imagen = raiz.querySelector('#sc-preview');
  const pie = raiz.querySelector('#sc-preview-pie');
  const enlace = raiz.querySelector('#sc-consulta');
  const aviso = raiz.querySelector('#sc-aviso');
  if (![modelo,cantidad,destino,extra,red1,red2,cambioBase,negocio,notas,imagen,pie,enlace,aviso].every(Boolean)) return;

  const catalogo = {
    tria: {
      titulo:'TRIA',
      foto:'assets/sc-tria.webp',
      alt:'Presentación del exhibidor TRIA con tres puntos NFC y código QR',
      pie:'TRIA: render de presentación. Las fotos de la pieza impresa están en la galería.'
    },
    signa: {
      titulo:'SIGNA',
      foto:'assets/sc-signa-alvia.webp',
      alt:'Exhibidor SIGNA blanco personalizado para ÁLVIA',
      pie:'SIGNA: fotografía de un exhibidor fabricado y personalizado para ÁLVIA.'
    }
  };

  const texto = v => String(v || '').trim();

  function actualizar() {
    const elegido = catalogo[modelo.value] || catalogo.tria;
    const esTria = modelo.value === 'tria';
    extra.hidden = !esTria;
    imagen.src = elegido.foto;
    imagen.alt = elegido.alt;
    pie.textContent = elegido.pie;

    raiz.querySelectorAll('[data-sc-tarjeta]').forEach(t => {
      t.dataset.scSeleccionado = String(t.dataset.scTarjeta === modelo.value);
    });

    const n = Number(cantidad.value);
    if (!Number.isSafeInteger(n) || n < 1) {
      enlace.removeAttribute('href');
      enlace.setAttribute('aria-disabled','true');
      aviso.textContent = 'Escribe una cantidad válida de una pieza o más.';
      return;
    }

    const color = [...base].find(x => x.checked)?.value || 'Negro';
    const partes = [
      'Hola, quiero cotizar un exhibidor personalizado de S&C Solutions.',
      `Modelo: S&C ${elegido.titulo}`,
      `Cantidad: ${n} ${n===1?'pieza':'piezas'}`,
      `Color de la base: ${color}`,
      `Destino principal NFC + QR: ${destino.value}`
    ];
    if (esTria) {
      partes.push(`Acceso NFC adicional 1: ${red1.value}`);
      partes.push(`Acceso NFC adicional 2: ${red2.value}`);
    }
    partes.push(`Diseño de la base: ${cambioBase.value}`);
    if (texto(negocio.value)) partes.push(`Negocio: ${texto(negocio.value)}`);
    if (texto(notas.value)) partes.push(`Mi propuesta: ${texto(notas.value)}`);
    partes.push('Quiero personalizarlo con mi marca. Puedo enviar mi logo, imágenes o archivos 3D por este chat.');

    enlace.href = 'https://wa.me/524423697248?text=' + encodeURIComponent(partes.join('\n'));
    enlace.removeAttribute('aria-disabled');
    enlace.textContent = `Cotizar S&C ${elegido.titulo} por WhatsApp`;
    aviso.textContent = 'Revisamos contigo diseño, costo final y tiempo de fabricación antes de confirmar.';
  }

  raiz.querySelectorAll('[data-sc-elegir]').forEach(a => {
    a.addEventListener('click', () => {
      if (catalogo[a.dataset.scElegir]) {
        modelo.value = a.dataset.scElegir;
        actualizar();
      }
    });
  });

  raiz.addEventListener('input', actualizar);
  raiz.addEventListener('change', actualizar);
  actualizar();
})();
