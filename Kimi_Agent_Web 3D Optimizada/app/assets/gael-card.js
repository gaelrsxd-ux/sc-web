(() => {
  'use strict';

  const carousel = document.getElementById('gallery');
  const projects = [...carousel.querySelectorAll('.project')];
  const carouselCount = document.getElementById('carousel-count');
  const previousCard = document.querySelector('.carousel-prev');
  const nextCard = document.querySelector('.carousel-next');

  const dialog = document.getElementById('viewer');
  const modalImage = document.getElementById('viewer-image');
  const modalCaption = document.getElementById('viewer-caption');
  const modalCount = document.getElementById('viewer-count');
  const closeButton = dialog.querySelector('.lightbox-close');
  const previousPhoto = dialog.querySelector('.lightbox-prev');
  const nextPhoto = dialog.querySelector('.lightbox-next');

  const visible = projects;
  let activeIndex = 0;
  let viewerIndex = 0;
  let previousFocus = null;
  let gestureStart = null;
  let ignoreClicksUntil = 0;
  let viewerTouchStart = null;

  const wrapped = (n, length) => (n + length) % length;

  function renderCarousel() {
    carousel.classList.add('is-ready');
    projects.forEach(card => {
      card.classList.remove('is-current', 'is-prev', 'is-next', 'is-off');
      if (card.hidden) {
        card.tabIndex = -1;
        card.setAttribute('aria-hidden', 'true');
        return;
      }
      const index = visible.indexOf(card);
      const offset = index - activeIndex;
      const current = offset === 0;
      const adjacent = Math.abs(offset) === 1;
      card.classList.add(current ? 'is-current' : offset === -1 ? 'is-prev' : offset === 1 ? 'is-next' : 'is-off');
      card.tabIndex = current ? 0 : -1;
      card.setAttribute('aria-hidden', String(!current && !adjacent));
      card.setAttribute('aria-label', current ? card.dataset.openLabel : `Mostrar ${card.dataset.caption}`);
    });
    carouselCount.textContent = `${String(activeIndex + 1).padStart(2, '0')} / ${String(visible.length).padStart(2, '0')}`;
    previousCard.disabled = activeIndex === 0;
    nextCard.disabled = activeIndex === visible.length - 1;
  }

  function stepCarousel(direction, focusCurrent = false) {
    if (visible.length < 2) return;
    activeIndex = Math.max(0, Math.min(activeIndex + direction, visible.length - 1));
    renderCarousel();
    if (focusCurrent) visible[activeIndex].focus({ preventScroll: true });
  }

  projects.forEach(card => {
    card.dataset.openLabel = card.getAttribute('aria-label');
    card.addEventListener('click', () => {
      if (Date.now() < ignoreClicksUntil) return;
      const index = visible.indexOf(card);
      if (index < 0) return;
      if (index !== activeIndex) {
        activeIndex = index;
        renderCarousel();
        return;
      }
      previousFocus = card;
      viewerIndex = index;
      renderViewer();
      dialog.showModal();
      closeButton.focus();
    });
  });

  previousCard.addEventListener('click', () => stepCarousel(-1));
  nextCard.addEventListener('click', () => stepCarousel(1));

  carousel.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
      event.preventDefault();
      stepCarousel(event.key === 'ArrowRight' ? 1 : -1, true);
    }
  });

  // Un gesto horizontal gira el carrusel; el desplazamiento vertical sigue funcionando.
  carousel.addEventListener('pointerdown', event => {
    if (event.pointerType === 'mouse' && event.button !== 0) return;
    gestureStart = { id: event.pointerId, x: event.clientX, y: event.clientY };
  });
  carousel.addEventListener('pointerup', event => {
    if (!gestureStart || gestureStart.id !== event.pointerId) return;
    const x = event.clientX - gestureStart.x;
    const y = event.clientY - gestureStart.y;
    gestureStart = null;
    if (Math.abs(x) > 45 && Math.abs(x) > Math.abs(y) * 1.2) {
      ignoreClicksUntil = Date.now() + 400;
      stepCarousel(x < 0 ? 1 : -1);
    }
  });
  carousel.addEventListener('pointercancel', () => { gestureStart = null; });

  function renderViewer() {
    const card = visible[viewerIndex];
    modalImage.src = card.dataset.full;
    modalImage.alt = card.querySelector('img').alt;
    modalCaption.textContent = card.dataset.caption;
    modalCount.textContent = `${viewerIndex + 1} / ${visible.length}`;
  }

  function moveViewer(direction) {
    viewerIndex = wrapped(viewerIndex + direction, visible.length);
    renderViewer();
  }

  closeButton.addEventListener('click', () => dialog.close());
  previousPhoto.addEventListener('click', () => moveViewer(-1));
  nextPhoto.addEventListener('click', () => moveViewer(1));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); moveViewer(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); moveViewer(1); }
  });
  dialog.addEventListener('touchstart', event => { viewerTouchStart = event.touches[0]?.clientX ?? null; }, { passive: true });
  dialog.addEventListener('touchend', event => {
    if (viewerTouchStart === null) return;
    const endX = event.changedTouches[0]?.clientX;
    if (endX !== undefined && Math.abs(endX - viewerTouchStart) > 55) moveViewer(endX < viewerTouchStart ? 1 : -1);
    viewerTouchStart = null;
  }, { passive: true });
  dialog.addEventListener('close', () => {
    modalImage.removeAttribute('src');
    activeIndex = viewerIndex;
    renderCarousel();
    if (previousFocus instanceof HTMLElement) visible[activeIndex].focus({ preventScroll: true });
  });

  // Safari permite un rebote lateral del viewport visual después de pellizcar.
  // Frenamos sólo el gesto que cruzaría los bordes; el zoom, el desplazamiento
  // vertical y los gestos normales del carrusel continúan disponibles.
  let pageTouch = null;
  const rememberTouch = touch => ({
    id: touch.identifier,
    startX: touch.clientX,
    startY: touch.clientY,
    lastX: touch.clientX,
    axis: null,
    inCarousel: touch.target instanceof Element && Boolean(touch.target.closest('.gallery'))
  });

  document.addEventListener('touchstart', event => {
    pageTouch = event.touches.length === 1 ? rememberTouch(event.touches[0]) : null;
  }, { passive: true });

  document.addEventListener('touchmove', event => {
    if (!pageTouch || event.touches.length !== 1) return;
    const touch = event.touches[0];
    if (touch.identifier !== pageTouch.id) return;
    const totalX = touch.clientX - pageTouch.startX;
    const totalY = touch.clientY - pageTouch.startY;
    if (!pageTouch.axis && Math.hypot(totalX, totalY) >= 8) {
      pageTouch.axis = Math.abs(totalX) > Math.abs(totalY) * 1.15 ? 'x' : 'y';
    }
    const movementX = touch.clientX - pageTouch.lastX;
    pageTouch.lastX = touch.clientX;
    if (pageTouch.axis !== 'x' || movementX === 0) return;

    const viewport = window.visualViewport;
    const scale = viewport?.scale || 1;
    if (pageTouch.inCarousel && scale <= 1.01) return;
    const pageWidth = document.documentElement.clientWidth;
    const visibleWidth = viewport?.width || pageWidth;
    const maxLeft = Math.max(0, pageWidth - visibleWidth);
    const currentLeft = viewport?.pageLeft ?? window.scrollX;
    const nextLeft = currentLeft - movementX / scale;
    if ((nextLeft < 0 || nextLeft > maxLeft) && event.cancelable) {
      event.preventDefault();
    }
  }, { passive: false, capture: true });

  document.addEventListener('touchend', event => {
    pageTouch = event.touches.length === 1 ? rememberTouch(event.touches[0]) : null;
  }, { passive: true });
  document.addEventListener('touchcancel', () => { pageTouch = null; }, { passive: true });

  renderCarousel();
})();
