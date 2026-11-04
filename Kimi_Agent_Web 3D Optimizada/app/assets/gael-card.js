(() => {
  'use strict';
  const filters = [...document.querySelectorAll('.filter')];
  const projects = [...document.querySelectorAll('.project')];
  const dialog = document.getElementById('viewer');
  const modalImage = document.getElementById('viewer-image');
  const modalCaption = document.getElementById('viewer-caption');
  const modalCount = document.getElementById('viewer-count');
  const closeButton = dialog.querySelector('.lightbox-close');
  const prevButton = dialog.querySelector('.lightbox-prev');
  const nextButton = dialog.querySelector('.lightbox-next');
  let visible = projects;
  let current = 0;
  let previousFocus = null;
  let touchStartX = null;

  function render() {
    const card = visible[current];
    if (!card) return;
    const picture = card.querySelector('img');
    modalImage.src = card.dataset.full;
    modalImage.alt = picture.alt;
    modalCaption.textContent = card.dataset.caption;
    modalCount.textContent = `${current + 1} / ${visible.length}`;
  }

  function move(offset) {
    if (!visible.length) return;
    current = (current + offset + visible.length) % visible.length;
    render();
  }

  filters.forEach(filter => {
    filter.addEventListener('click', () => {
      const kind = filter.dataset.filter;
      filters.forEach(button => {
        const selected = button === filter;
        button.classList.toggle('is-active', selected);
        button.setAttribute('aria-pressed', String(selected));
      });
      projects.forEach(project => { project.hidden = kind !== 'all' && project.dataset.kind !== kind; });
      visible = projects.filter(project => !project.hidden);
    });
  });

  projects.forEach(project => {
    project.addEventListener('click', () => {
      visible = projects.filter(item => !item.hidden);
      current = visible.indexOf(project);
      if (current < 0) return;
      previousFocus = document.activeElement;
      render();
      if (typeof dialog.showModal === 'function') dialog.showModal();
      else dialog.setAttribute('open', '');
      closeButton.focus();
    });
  });

  closeButton.addEventListener('click', () => dialog.close());
  prevButton.addEventListener('click', () => move(-1));
  nextButton.addEventListener('click', () => move(1));
  dialog.addEventListener('click', event => { if (event.target === dialog) dialog.close(); });
  dialog.addEventListener('keydown', event => {
    if (event.key === 'ArrowLeft') { event.preventDefault(); move(-1); }
    if (event.key === 'ArrowRight') { event.preventDefault(); move(1); }
  });
  dialog.addEventListener('touchstart', event => { touchStartX = event.touches[0]?.clientX ?? null; }, { passive: true });
  dialog.addEventListener('touchend', event => {
    if (touchStartX === null) return;
    const touchEndX = event.changedTouches[0]?.clientX;
    if (touchEndX === undefined) return;
    const distance = touchEndX - touchStartX;
    if (Math.abs(distance) > 55) move(distance > 0 ? -1 : 1);
    touchStartX = null;
  }, { passive: true });
  dialog.addEventListener('close', () => {
    modalImage.removeAttribute('src');
    if (previousFocus instanceof HTMLElement) previousFocus.focus();
  });
})();
