const foto = document.querySelector('#foto-principal');
const nombre = document.querySelector('#nombre-principal');
const precio = document.querySelector('#precio-principal');
const detalle = document.querySelector('#detalle-principal');
const platos = [...document.querySelectorAll('.plato')];

platos.forEach((plato) => plato.addEventListener('click', () => {
  platos.forEach((opcion) => opcion.setAttribute('aria-pressed', 'false'));
  plato.setAttribute('aria-pressed', 'true');
  foto.classList.add('cambiando');

  const imagen = new Image();
  imagen.src = plato.dataset.img;
  imagen.onload = () => {
    foto.src = plato.dataset.img;
    foto.alt = plato.dataset.alt;
    nombre.textContent = plato.dataset.nombre;
    precio.textContent = plato.dataset.precio;
    detalle.textContent = plato.dataset.detalle;
    foto.classList.remove('cambiando');
  };
}));
