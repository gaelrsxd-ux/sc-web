/* Instagram no admite un mensaje prellenado mediante enlace público.
   Preparamos el texto en el portapapeles al tocar su botón; WhatsApp sí
   recibe el mensaje directamente mediante el parámetro ?text=. */
(() => {
  const instagram = document.querySelector('.social-ig');
  if (!instagram) return;

  const mensaje = 'Hola, vengo de su página web y me interesa conocer más sobre sus servicios. ¿Me podrían dar información, por favor?';
  const chat = 'https://ig.me/m/sycsolutions_mx';
  const perfil = 'https://www.instagram.com/sycsolutions_mx/';

  /* Instagram Web no siempre admite ig.me; en escritorio se conserva el perfil. */
  if (window.matchMedia?.('(hover: hover) and (pointer: fine)').matches) {
    instagram.href = perfil;
  } else {
    instagram.href = chat;
  }

  instagram.addEventListener('click', () => {
    // Copia sincrónica antes de que el navegador abra la nueva pestaña/app.
    let copiado = false;
    const campo = document.createElement('textarea');
    campo.value = mensaje;
    campo.readOnly = true;
    campo.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0';
    document.body.appendChild(campo);
    try {
      campo.select();
      campo.setSelectionRange(0, mensaje.length);
      copiado = document.execCommand('copy');
    } catch (_) { /* Un navegador puede denegar la copia. */ }
    campo.remove();

    if (!copiado && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(mensaje).catch(() => {});
    }
  });
})();
