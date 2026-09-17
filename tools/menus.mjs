import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const ARCHIVO_DATOS = path.join(RAIZ, 'datos', 'menus.json');
const ARCHIVO_REDIRECCIONES = path.join(
  RAIZ,
  'Kimi_Agent_Web 3D Optimizada',
  'app',
  '_redirects'
);

export function validarCatalogo(catalogo) {
  if (!catalogo || typeof catalogo !== 'object') throw new Error('El catálogo debe ser un objeto JSON.');

  let dominio;
  try {
    dominio = new URL(catalogo.dominio);
  } catch {
    throw new Error('dominio debe ser una URL HTTPS válida.');
  }
  if (dominio.protocol !== 'https:' || dominio.pathname !== '/' || dominio.search || dominio.hash) {
    throw new Error('dominio debe usar HTTPS y no incluir ruta, consulta ni fragmento.');
  }

  const permitidos = new Set();
  for (const valor of catalogo.origenesExternosPermitidos ?? []) {
    let origen;
    try {
      const url = new URL(valor);
      if (url.protocol !== 'https:' || url.origin !== valor || url.username || url.password) throw new Error();
      origen = url.origin;
    } catch {
      throw new Error(`Origen externo no válido: ${valor}`);
    }
    permitidos.add(origen);
  }

  if (!Array.isArray(catalogo.restaurantes)) throw new Error('restaurantes debe ser una lista.');
  const ids = new Set();
  const codigos = new Set();

  const restaurantes = catalogo.restaurantes.map((entrada, indice) => {
    const lugar = `restaurantes[${indice}]`;
    if (!entrada || typeof entrada !== 'object') throw new Error(`${lugar} debe ser un objeto.`);
    if (!/^MENU-\d{3,}$/.test(entrada.id)) throw new Error(`${lugar}.id debe tener el formato MENU-001.`);
    if (!/^m\d{3,}$/.test(entrada.codigo)) throw new Error(`${lugar}.codigo debe tener el formato m001.`);
    if (ids.has(entrada.id)) throw new Error(`ID repetido: ${entrada.id}`);
    if (codigos.has(entrada.codigo)) throw new Error(`Código repetido: ${entrada.codigo}`);
    ids.add(entrada.id);
    codigos.add(entrada.codigo);

    if (typeof entrada.nombre !== 'string' || !entrada.nombre.trim()) {
      throw new Error(`${lugar}.nombre no puede estar vacío.`);
    }
    if (typeof entrada.activo !== 'boolean') throw new Error(`${lugar}.activo debe ser true o false.`);
    if (typeof entrada.destino !== 'string' || /[\r\n\s]/.test(entrada.destino)) {
      throw new Error(`${lugar}.destino no es válido.`);
    }

    let destino = entrada.destino;
    if (destino.startsWith('/')) {
      if (destino.startsWith('//') || destino.includes('\\')) {
        throw new Error(`${lugar}.destino debe ser una ruta interna segura.`);
      }
      const resuelta = new URL(destino, dominio);
      if (resuelta.origin !== dominio.origin) throw new Error(`${lugar}.destino sale del dominio.`);
    } else {
      let externa;
      try {
        externa = new URL(destino);
      } catch {
        throw new Error(`${lugar}.destino debe ser una ruta interna o una URL HTTPS.`);
      }
      if (externa.protocol !== 'https:' || externa.username || externa.password) {
        throw new Error(`${lugar}.destino externo debe usar HTTPS y no incluir credenciales.`);
      }
      if (!permitidos.has(externa.origin)) {
        throw new Error(`${lugar}.destino usa un origen no permitido: ${externa.origin}`);
      }
      destino = externa.href;
    }

    return { ...entrada, nombre: entrada.nombre.trim(), destino };
  });

  return { dominio: dominio.origin, restaurantes };
}

export function generarRedirecciones(catalogo) {
  const { dominio, restaurantes } = validarCatalogo(catalogo);
  const lineas = [
    '# GENERADO por: node tools/menus.mjs',
    '# Edita datos/menus.json; no edites este archivo a mano.',
    '# 302 es intencional: permite cambiar el destino sin cache permanente.',
    ''
  ];

  for (const restaurante of restaurantes) {
    if (!restaurante.activo) continue;
    lineas.push(`/q/${restaurante.codigo} ${restaurante.destino} 302`);
  }

  lineas.push('', '# Todo código no registrado muestra el estado pendiente.');
  lineas.push('/q/* /menu/pendiente 200', '');
  return {
    dominio,
    contenido: lineas.join('\n'),
    activos: restaurantes.filter(({ activo }) => activo)
  };
}

export function cargarCatalogo() {
  return JSON.parse(fs.readFileSync(ARCHIVO_DATOS, 'utf8'));
}

function ejecutar() {
  const comprobar = process.argv.includes('--check');
  const resultado = generarRedirecciones(cargarCatalogo());

  if (comprobar) {
    const actual = fs.existsSync(ARCHIVO_REDIRECCIONES)
      ? fs.readFileSync(ARCHIVO_REDIRECCIONES, 'utf8').replace(/\r\n/g, '\n')
      : '';
    if (actual !== resultado.contenido) {
      console.error('app/_redirects no coincide con datos/menus.json. Ejecuta: node tools/menus.mjs');
      process.exitCode = 1;
      return;
    }
    console.log(`Menús correctos: ${resultado.activos.length} activo(s).`);
    return;
  }

  fs.writeFileSync(ARCHIVO_REDIRECCIONES, resultado.contenido, 'utf8');
  console.log(`Generado app/_redirects con ${resultado.activos.length} menú(s) activo(s).`);
  for (const restaurante of resultado.activos) {
    console.log(`  ${restaurante.id}: ${resultado.dominio}/q/${restaurante.codigo} -> ${restaurante.destino}`);
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) ejecutar();
