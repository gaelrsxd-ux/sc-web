#!/usr/bin/env node
/* ============================================================================
   LAS COLONIAS DE CADA CÓDIGO POSTAL, Y LAS CIUDADES DE MÉXICO

   Para qué está. En el formulario de envío había tres campos que el comprador
   tenía que escribir a mano, con acentos, sin faltas y sin ayuda: código
   postal, colonia y ciudad. Tres campos de texto libre en un móvil, justo
   antes de pagar. Lo que llegaba era «lomas 4a», «Lomas cuarta seccion» y
   «Lomas 4ta Secc.» para la misma calle, y una dirección mal escrita no es un
   dato feo: es un paquete que vuelve.

   Lo que hace este archivo. Convierte el catálogo oficial de SEPOMEX en dos
   cosas que la web puede leer sola:

     assets/mx/NN.json    los códigos postales que empiezan por NN, con su
                          estado, su ciudad y la lista de colonias de cada uno.
     assets/mx/ciudades.json  los nombres de ciudad y municipio de todo el país,
                          para la lista desplegable del campo «Ciudad».

   Así, quien teclea 78216 ve aparecer «Lomas Tercera Sección», «Lomas Cuarta
   Sección» y «Santa Mónica» —y el estado y la ciudad se rellenan solos—; y
   quien escribe «sole» en el campo de ciudad ve «Soledad de Graciano Sánchez».
   Los dos campos siguen siendo de texto libre: si su colonia no está en la
   lista, la escribe igual. Una lista que no deja escribir fuera de ella es
   peor que no tenerla — hay fraccionamientos nuevos que SEPOMEX aún no tiene.

   ⚠ SE PARTE EN NOVENTA Y SEIS ARCHIVOS Y NO ES CAPRICHO. El catálogo entero
   son 158.000 asentamientos, más de cuatro megas. Mandárselos a un teléfono
   para averiguar tres colonias sería más pesado que toda la web junta. Partido
   por los dos primeros dígitos del código postal, el navegador se baja UN
   archivo de unas 40 KB —el de su zona— y sólo cuando hace falta.

   Cómo se usa:
     node tools/cp.mjs ruta/al/CPdescarga.txt   regenera los archivos
     node tools/cp.mjs --check                  no toca nada; falla si lo
                                                generado no se sostiene

   ⚠ EL ORIGEN NO VIVE EN ESTE REPOSITORIO, a propósito: son 15 MB de texto que
   sólo sirven para volver a generar lo mismo. Se descarga del exportador
   oficial de Correos de México —«Consulta de códigos postales · Exportar»— en
   formato de texto separado por barras verticales, o de cualquier copia fiel
   de ese mismo archivo. La primera línea puede ser la de encabezados; se salta
   sola. Lo que SÍ se versiona es el resultado, porque es lo que se publica.

   `--check` no vuelve a descargar nada: comprueba que lo publicado se sostiene
   solo —que cada archivo se lee, que los códigos tienen cinco dígitos, que
   ningún estado se salió de los que ofrece el desplegable del formulario y que
   el índice de ciudades no está vacío—. Es lo que puede correr el CI sin red.
   ========================================================================= */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const APP = path.join(RAIZ, 'Kimi_Agent_Web 3D Optimizada', 'app');
const SALIDA = path.join(APP, 'assets', 'mx');
const PEDIDO = path.join(APP, 'pedido.html');

/* ⚠ LOS NOMBRES DE SEPOMEX NO SON LOS DEL FORMULARIO, y son cuatro. El
   catálogo oficial escribe los nombres constitucionales; el desplegable de
   pedido.html escribe los que usa la gente. Sin esta tabla, quien teclea un
   código postal de Torreón recibiría «Coahuila de Zaragoza» y el desplegable
   —que sólo tiene «Coahuila»— se quedaría en blanco sin decir por qué. */
const ESTADOS = {
  'Coahuila de Zaragoza': 'Coahuila',
  'Michoacán de Ocampo': 'Michoacán',
  'México': 'Estado de México',
  'Veracruz de Ignacio de la Llave': 'Veracruz',
};

/* Los que de verdad ofrece el formulario. Se leen del HTML y no se copian aquí
   porque una lista copiada es una lista que se queda vieja: el día que alguien
   toque el desplegable, esto tiene que enterarse y fallar, no seguir generando
   estados que el formulario no puede seleccionar. */
function estadosDelFormulario() {
  const html = fs.readFileSync(PEDIDO, 'utf8');
  const sel = html.match(/<select name="estado"[\s\S]*?<\/select>/);
  if (!sel) throw new Error('pedido.html: no encuentro el desplegable de estados');
  const nombres = [...sel[0].matchAll(/<option(?: value="([^"]*)")?>([^<]+)<\/option>/g)]
    .map(m => (m[1] !== undefined ? m[1] : m[2]))
    .filter(Boolean);
  if (nombres.length !== 32)
    throw new Error(`pedido.html: el desplegable tiene ${nombres.length} estados y deberían ser 32`);
  return new Set(nombres);
}

const arg = process.argv[2];
const comprobar = process.argv.includes('--check');

/* ------------------------------------------------------------- COMPROBAR */

if (comprobar) {
  const validos = estadosDelFormulario();
  const problemas = [];
  if (!fs.existsSync(SALIDA)) problemas.push('falta la carpeta assets/mx');
  else {
    const archivos = fs.readdirSync(SALIDA).filter(f => f.endsWith('.json'));
    const zonas = archivos.filter(f => /^\d{2}\.json$/.test(f));
    if (!zonas.length) problemas.push('no hay ningún archivo de zona (assets/mx/NN.json)');
    let cps = 0, colonias = 0;
    for (const f of zonas) {
      let d;
      try { d = JSON.parse(fs.readFileSync(path.join(SALIDA, f), 'utf8')); }
      catch (e) { problemas.push(`${f}: no es JSON válido (${e.message})`); continue; }
      if (!d || !Array.isArray(d.e) || !Array.isArray(d.c) || !d.z) {
        problemas.push(`${f}: no tiene la forma {e:[],c:[],z:{}}`); continue;
      }
      for (const nombre of d.e)
        if (!validos.has(nombre)) problemas.push(`${f}: el estado «${nombre}» no está en el desplegable de pedido.html`);
      const zona = f.slice(0, 2);
      for (const [cp, v] of Object.entries(d.z)) {
        cps++;
        if (!/^\d{5}$/.test(cp)) { problemas.push(`${f}: «${cp}» no es un código postal de cinco dígitos`); continue; }
        if (cp.slice(0, 2) !== zona) problemas.push(`${f}: ${cp} no pertenece a la zona ${zona}`);
        if (!Array.isArray(v) || v.length !== 3 || !Array.isArray(v[2]) || !v[2].length) {
          problemas.push(`${f}: ${cp} no tiene la forma [estado, ciudad, [colonias]]`); continue;
        }
        if (d.e[v[0]] === undefined) problemas.push(`${f}: ${cp} apunta a un estado que no existe`);
        if (d.c[v[1]] === undefined) problemas.push(`${f}: ${cp} apunta a una ciudad que no existe`);
        colonias += v[2].length;
      }
    }
    const ciudades = path.join(SALIDA, 'ciudades.json');
    if (!fs.existsSync(ciudades)) problemas.push('falta assets/mx/ciudades.json');
    else {
      let lista;
      try { lista = JSON.parse(fs.readFileSync(ciudades, 'utf8')); }
      catch (e) { lista = null; problemas.push(`ciudades.json: no es JSON válido (${e.message})`); }
      if (lista && (!Array.isArray(lista) || lista.length < 2000))
        problemas.push(`ciudades.json: ${Array.isArray(lista) ? lista.length : 0} nombres, y deberían ser más de 2.000`);
    }
    if (!problemas.length)
      console.log(`OK: ${zonas.length} zonas, ${cps.toLocaleString('es-MX')} códigos postales y ` +
                  `${colonias.toLocaleString('es-MX')} colonias.`);
  }
  if (problemas.length) {
    console.error('Colonias por código postal:\n  ' + problemas.join('\n  '));
    console.error('\nSe regenera con:  node tools/cp.mjs ruta/al/CPdescarga.txt');
    process.exit(1);
  }
  process.exit(0);
}

/* ------------------------------------------------------------- GENERAR */

if (!arg || arg.startsWith('--')) {
  console.error('Falta el catálogo de origen.\n\n' +
    '  node tools/cp.mjs ruta/al/CPdescarga.txt\n\n' +
    'Es el archivo de texto separado por barras («|») del exportador oficial de\n' +
    'Correos de México. No se guarda en este repositorio: son 15 MB que sólo\n' +
    'sirven para volver a generar assets/mx/.');
  process.exit(1);
}
if (!fs.existsSync(arg)) { console.error(`No existe: ${arg}`); process.exit(1); }

const validos = estadosDelFormulario();
const lineas = fs.readFileSync(arg, 'utf8').split(/\r?\n/);

/* Un asentamiento por línea; un código postal aparece tantas veces como
   colonias tenga. Las columnas que se usan son las cinco primeras más la
   sexta: código, asentamiento, tipo, municipio, estado y ciudad. */
const zonas = new Map();          // «78» → Map(cp → {estado, ciudad, colonias:Set})
const nombresCiudad = new Set();
const desconocidos = new Set();
let leidas = 0, saltadas = 0;

for (const linea of lineas) {
  if (!linea) continue;
  const c = linea.split('|');
  if (c.length < 6) { saltadas++; continue; }
  const cp = c[0].trim();
  if (!/^\d{5}$/.test(cp)) { saltadas++; continue; }   // la fila de encabezados cae aquí
  const colonia = c[1].trim();
  const municipio = c[3].trim();
  const bruto = c[4].trim();
  const ciudadOficial = c[5].trim();
  if (!colonia || !municipio || !bruto) { saltadas++; continue; }

  const estado = ESTADOS[bruto] || bruto;
  if (!validos.has(estado)) { desconocidos.add(bruto); saltadas++; continue; }

  /* La «ciudad» del catálogo sólo existe para las poblaciones grandes; para
     todo lo demás lo que la gente escribe en ese campo es el municipio. */
  const ciudad = ciudadOficial || municipio;
  nombresCiudad.add(ciudad);
  nombresCiudad.add(municipio);

  const zona = cp.slice(0, 2);
  if (!zonas.has(zona)) zonas.set(zona, new Map());
  const dentro = zonas.get(zona);
  if (!dentro.has(cp)) dentro.set(cp, { estado, ciudad, colonias: new Set() });
  dentro.get(cp).colonias.add(colonia);
  leidas++;
}

if (desconocidos.size) {
  console.error('Estados que no están en el desplegable de pedido.html:\n  ' +
    [...desconocidos].join('\n  ') +
    '\n\nSe añaden a la tabla ESTADOS de este archivo, o al desplegable.');
  process.exit(1);
}
if (leidas < 100000) {
  console.error(`Sólo se leyeron ${leidas} asentamientos; el catálogo completo pasa de 150.000. ` +
    'Comprueba que el archivo de origen esté entero.');
  process.exit(1);
}

fs.mkdirSync(SALIDA, { recursive: true });
/* Se borra lo anterior: si una zona desaparece del catálogo, su archivo tiene
   que desaparecer también. Uno huérfano seguiría sirviéndose y contestando. */
for (const f of fs.readdirSync(SALIDA)) if (f.endsWith('.json')) fs.unlinkSync(path.join(SALIDA, f));

const ordena = (a, b) => a.localeCompare(b, 'es');
let totalCps = 0, totalColonias = 0, bytes = 0;

for (const [zona, dentro] of [...zonas].sort((a, b) => a[0].localeCompare(b[0]))) {
  /* Una tabla de nombres por archivo. El estado se repite en los 400 códigos
     postales de la zona y la ciudad en los 200 de su municipio: escribirlos
     una vez y apuntar con un número quita casi un tercio del peso, que es
     justo el tercio que se descarga un teléfono con datos móviles. */
  const est = [], ciu = [], iE = new Map(), iC = new Map();
  const z = {};
  for (const cp of [...dentro.keys()].sort()) {
    const v = dentro.get(cp);
    if (!iE.has(v.estado)) { iE.set(v.estado, est.length); est.push(v.estado); }
    if (!iC.has(v.ciudad)) { iC.set(v.ciudad, ciu.length); ciu.push(v.ciudad); }
    z[cp] = [iE.get(v.estado), iC.get(v.ciudad), [...v.colonias].sort(ordena)];
    totalCps++;
    totalColonias += v.colonias.size;
  }
  const texto = JSON.stringify({ e: est, c: ciu, z });
  bytes += texto.length;
  fs.writeFileSync(path.join(SALIDA, `${zona}.json`), texto);
}

const ciudades = [...nombresCiudad].sort(ordena);
fs.writeFileSync(path.join(SALIDA, 'ciudades.json'), JSON.stringify(ciudades));

console.log(
  `${zonas.size} zonas · ${totalCps.toLocaleString('es-MX')} códigos postales · ` +
  `${totalColonias.toLocaleString('es-MX')} colonias · ` +
  `${ciudades.length.toLocaleString('es-MX')} ciudades\n` +
  `assets/mx/ ocupa ${(bytes / 1024 / 1024).toFixed(1)} MB en total, ` +
  `${(bytes / zonas.size / 1024).toFixed(0)} KB de media por zona.`);
