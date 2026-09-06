/* El icono que Google enseña junto al resultado, dibujado aquí y no recortado
   de otra cosa.

   El motivo de que exista: el sitio declaraba `logo.svg` como icono, y ese
   archivo es el CARTEL de la marca —1600x900, con marco, globo terráqueo y dos
   líneas de texto—. Google exige un cuadrado (1:1) y NO admite SVG: su lista es
   BMP, GIF, ICO, PNG, JPEG, PPM y TIFF. Con un 16:9 recorta el centro, así que
   de «S&C SOLUTIONS» se veía «S&(». Y aunque cupiera, un cartel con seis
   elementos a 48 píxeles es una mancha.

   Este icono es lo contrario: tres elementos, mucho contraste y aire de sobra
   en el borde, porque en el móvil Google lo recorta en círculo.

   Se dibuja con Pillow para que no dependa de un conversor de SVG, y se
   regenera con `node tools/icono.mjs`. La prueba de contenido comprueba que lo
   que se sirve sigue siendo cuadrado y sigue siendo PNG.                     */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(AQUI, '..', 'Kimi_Agent_Web 3D Optimizada', 'app', 'assets');

/* Los mismos tokens de la web: si la marca cambia de color, cambia aquí. */
const FONDO = '#0A0B0E', ARO = '#C8A96A', TINTA = '#F4F1EA';

const guion = `
import sys
from PIL import Image, ImageDraw, ImageFont
fondo, aro, tinta, destino, lado = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], int(sys.argv[5])

# Se dibuja 4 veces más grande y se reduce: es la forma barata de tener bordes
# suaves sin depender de un antialiasing que Pillow no aplica a los círculos.
E = 4
n = lado * E
im = Image.new('RGB', (n, n), fondo)
d = ImageDraw.Draw(im)

# El aro va al 86% del lado: en el móvil Google recorta el icono en círculo, y
# lo que toque el borde se pierde.
m = n * 0.07
d.ellipse([m, m, n - m, n - m], outline=aro, width=max(1, int(n * 0.028)))

# Monograma. Nada de «SOLUTIONS COMPANY»: a 48 píxeles sólo caben tres letras.
fuente = None
for ruta in ('/usr/share/fonts/truetype/liberation/LiberationSerif-Bold.ttf',
             '/usr/share/fonts/truetype/dejavu/DejaVuSerif-Bold.ttf'):
    try:
        fuente = ImageFont.truetype(ruta, int(n * 0.30)); break
    except OSError:
        pass
if fuente is None:
    raise SystemExit('sin tipografía serif con la que dibujar el monograma')

texto = 'S&C'
caja = d.textbbox((0, 0), texto, font=fuente)
d.text(((n - (caja[2] - caja[0])) / 2 - caja[0],
        (n - (caja[3] - caja[1])) / 2 - caja[1]), texto, font=fuente, fill=tinta)

im.resize((lado, lado), Image.LANCZOS).save(destino, 'PNG', optimize=True)
print('  %-22s %dx%d' % (destino.split('/')[-1], lado, lado))
`;

for (const lado of [512, 192]) {
  const destino = path.join(ASSETS, `icono-${lado}.png`);
  execFileSync('python3', ['-c', guion, FONDO, ARO, TINTA, destino, String(lado)], { stdio: 'inherit' });
}
