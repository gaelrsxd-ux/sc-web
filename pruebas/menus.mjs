import assert from 'node:assert/strict';
import test from 'node:test';
import { generarRedirecciones, validarCatalogo } from '../tools/menus.mjs';

const base = {
  dominio: 'https://sycsolutions.company',
  origenesExternosPermitidos: ['https://menus.ejemplo.com'],
  restaurantes: [
    { id: 'MENU-001', codigo: 'm001', nombre: 'Demo', destino: '/menu/demo', activo: true },
    { id: 'MENU-002', codigo: 'm002', nombre: 'Externo', destino: 'https://menus.ejemplo.com/carta', activo: true },
    { id: 'MENU-003', codigo: 'm003', nombre: 'Pendiente', destino: '/menu/demo', activo: false }
  ]
};

test('genera rutas exactas antes de la caída pendiente', () => {
  const { contenido } = generarRedirecciones(base);
  assert.match(contenido, /^\/q\/m001 \/menu\/demo 302$/m);
  assert.match(contenido, /^\/q\/m002 https:\/\/menus\.ejemplo\.com\/carta 302$/m);
  assert.doesNotMatch(contenido, /\/q\/m003/);
  assert.ok(contenido.indexOf('/q/m001') < contenido.indexOf('/q/*'));
});

test('rechaza códigos duplicados', () => {
  const catalogo = structuredClone(base);
  catalogo.restaurantes[1].codigo = 'm001';
  assert.throws(() => validarCatalogo(catalogo), /Código repetido/);
});

test('rechaza destinos externos fuera de la lista permitida', () => {
  const catalogo = structuredClone(base);
  catalogo.restaurantes[0].destino = 'https://malicioso.example/phishing';
  assert.throws(() => validarCatalogo(catalogo), /origen no permitido/);
});

test('rechaza rutas que intentan convertirse en URL externa', () => {
  const catalogo = structuredClone(base);
  catalogo.restaurantes[0].destino = '//malicioso.example/menu';
  assert.throws(() => validarCatalogo(catalogo), /ruta interna segura/);
});
