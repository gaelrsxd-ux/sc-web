/* El icono que Google enseña junto al resultado, sacado del logo de la marca.

   El motivo de que exista: el sitio declaraba `logo.svg` como icono, y ese
   archivo es el CARTEL —1600x900, con marco art déco, globo terráqueo y dos
   líneas de texto—. Google exige un cuadrado (1:1) y NO admite SVG: su lista
   es BMP, GIF, ICO, PNG, JPEG, PPM y TIFF. Con un 16:9 recortaba el centro y
   se comía las tres cuartas partes.

   La fuente es `assets/logo-icono.jpg`, el logo tal como lo entregó el dueño.
   Aquí no se redibuja nada: sólo se recorta al cuadrado por el centro y se
   reduce a los dos tamaños que hacen falta. Si el logo cambia, se sustituye
   ese archivo y se vuelve a correr `node tools/icono.mjs`.

   El recorte es por el centro y el logo va holgado, así que sobrevive al
   círculo con el que Google lo recorta en el móvil.                          */
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const AQUI = path.dirname(fileURLToPath(import.meta.url));
const ASSETS = path.join(AQUI, '..', 'Kimi_Agent_Web 3D Optimizada', 'app', 'assets');
const ORIGEN = path.join(ASSETS, 'logo-icono.jpg');

const guion = `
import sys
from PIL import Image
origen, destino, lado = sys.argv[1], sys.argv[2], int(sys.argv[3])

im = Image.open(origen).convert('RGB')
a, l = im.size

# Cuadrado por el centro: el logo está centrado en su lienzo, así que recortar
# el sobrante del lado largo no le quita nada.
c = min(a, l)
im = im.crop(((a - c) // 2, (l - c) // 2, (a - c) // 2 + c, (l - c) // 2 + c))
im.resize((lado, lado), Image.LANCZOS).save(destino, 'PNG', optimize=True)
print('  %-18s %dx%d  (del logo de %dx%d)' % (destino.split('/')[-1], lado, lado, a, l))
`;

for (const lado of [512, 192]) {
  execFileSync('python3', ['-c', guion, ORIGEN, path.join(ASSETS, `icono-${lado}.png`), String(lado)],
               { stdio: 'inherit' });
}
