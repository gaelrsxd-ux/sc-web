/**
 * Pruebas del filtro de destinos (defensa contra SSRF).
 *
 *   cd "Kimi_Agent_Web 3D Optimizada/cloudflare"
 *   node --test test/ssrf.test.mjs
 *
 * `inseguro()` es una función pura, así que se prueba directamente y sin
 * levantar nada: cientos de vectores en milisegundos. No usa red.
 *
 * Los casos marcados con REGRESIÓN son fallos que existieron de verdad y que se
 * encontraron auditando esta función con 190 vectores. Cada uno falla si se
 * revierte el parche correspondiente; están aquí para que no vuelvan.
 */

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

/* `seo-audit.js` reexporta la clase del Durable Object, que a su vez importa
   `cloudflare:workers`. Ese especificador sólo existe dentro del runtime de
   Workers, así que Node se niega a resolverlo. Se sustituye por un doble vacío:
   aquí sólo interesa `inseguro()`, que es una función pura y no lo toca.
   Es preferible a partir el archivo en dos sólo para poder probarlo. */
registerHooks({
  resolve(especificador, contexto, siguiente) {
    if (especificador === 'cloudflare:workers') {
      return { url: 'data:text/javascript,export class DurableObject {}', shortCircuit: true };
    }
    return siguiente(especificador, contexto);
  }
});

const { inseguro, rangoProhibido, ipv6Prohibida } = await import('../seo-audit.js');

/** Igual que hace el Worker: antepone https si no hay esquema. */
function veto(cruda) {
  let u;
  try {
    const conEsquema = /^[a-z][a-z0-9+.-]*:/i.test(cruda);
    u = new URL(conEsquema ? cruda : 'https://' + cruda);
  } catch {
    return 'dirección no válida';
  }
  return inseguro(u);
}

const bloquea = (v, motivo) => assert.notEqual(veto(v), null, `${v} debería estar BLOQUEADO (${motivo || ''})`);
const permite = (v) => assert.equal(veto(v), null, `${v} debería PASAR y fue bloqueado: ${veto(v)}`);

describe('filtro de destinos', () => {

  test('esquemas: sólo http y https', () => {
    for (const v of [
      'file:///etc/passwd', 'ftp://ejemplo.test/', 'javascript:alert(1)',
      'data:text/html,<script>1</script>', 'blob:https://a/b', 'gopher://a/',
      'dict://a:11211/', 'ldap://a/', 'ws://a/', 'wss://a/', 'sftp://a/',
      'jar:https://a!/b', 'view-source:https://a/'
    ]) bloquea(v, 'esquema');
  });

  test('loopback y sus disfraces numéricos', () => {
    for (const v of [
      '127.0.0.1', '127.1', '127.0.1', '2130706433', '0x7f000001',
      '0177.0.0.1', '017700000001', '0', '0.0.0.0', '0x0',
      'localhost', 'LOCALHOST', 'foo.localhost'
    ]) bloquea(v, 'loopback');
  });

  test('rangos privados y reservados', () => {
    for (const v of [
      '10.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.1',
      '169.254.169.254', '100.64.0.1', '100.127.0.1',
      '198.18.0.1', '192.0.0.1', '198.51.100.1', '203.0.113.1',
      '224.0.0.1', '255.255.255.255'
    ]) bloquea(v, 'rango reservado');
  });

  test('direcciones públicas justo fuera de los rangos SÍ pasan', () => {
    for (const v of ['172.15.0.1', '172.32.0.1', '100.63.0.1', '100.128.0.1', '11.0.0.1'])
      permite(v);
  });

  test('IPv6 literal', () => {
    for (const v of [
      'http://[::1]/', 'http://[::]/', 'http://[fc00::1]/', 'http://[fd00::1]/',
      'http://[fe80::1]/', 'http://[2001:db8::1]/', 'http://[::ffff:127.0.0.1]/',
      'http://[::ffff:169.254.169.254]/'
    ]) bloquea(v, 'IPv6');
  });

  test('host de una sola etiqueta y servicios de metadatos', () => {
    for (const v of [
      'metadata', 'instance-data', 'router', 'consul', 'intranet', 'wpad',
      'metadata.google.internal', '100.100.100.200'
    ]) bloquea(v, 'interno');
  });

  test('userinfo en la URL', () => {
    for (const v of [
      'http://ejemplo.test@127.0.0.1/', 'http://user@localhost/', 'https://a:b@[::1]/'
    ]) bloquea(v, 'userinfo hacia destino interno');
  });

  test('puertos no web', () => {
    for (const v of [
      'https://ejemplo.test:22/', 'https://ejemplo.test:3306/', 'https://ejemplo.test:6379/',
      'https://ejemplo.test:11211/', 'https://ejemplo.test:8080/', 'https://ejemplo.test:8443/'
    ]) bloquea(v, 'puerto');
  });

  test('puertos web correctos para su esquema sí pasan', () => {
    permite('https://ejemplo.test:443/');
    permite('http://ejemplo.test:80/');
    permite('https://ejemplo.test/');
  });

  /* ---------- regresiones: fallos reales encontrados en auditoría ---------- */

  test('REGRESIÓN H-1: doble punto final no puede anular el filtro', () => {
    /* `.replace(/\.$/, '')` quitaba UN punto. "127.0.0.1.." quedaba en
       "127.0.0.1.", que ya no casa con la regex de IPv4 ni cae en la rama de
       etiqueta única: se saltaba el filtro entero. */
    for (const v of [
      '127.0.0.1..', '127.0.0.1...', 'localhost..', 'localhost...',
      'foo.localhost..', '10.0.0.1..', '169.254.169.254..', '192.168.1.1...'
    ]) bloquea(v, 'doble punto final');
  });

  test('REGRESIÓN H-1b: etiqueta vacía en medio del host', () => {
    for (const v of ['ejemplo..test', 'a..b.test']) bloquea(v, 'etiqueta vacía');
  });

  test('REGRESIÓN H-2: credenciales incrustadas se rechazan', () => {
    /* Importa porque a `inseguro()` llegan también los destinos de las
       redirecciones: un sitio hostil devolvía un Location con usuario:clave y
       el Worker acababa enviándolo, además de publicarlo en el informe. */
    bloquea('https://usuario:secreto@ejemplo.test/', 'credenciales');
    bloquea('https://usuario@ejemplo.test/', 'usuario');
  });

  test('REGRESIÓN L-1: relé anycast 6to4', () => {
    bloquea('192.88.99.1', '6to4');
  });

  test('REGRESIÓN L-2: sufijos de red interna con puntos', () => {
    for (const v of [
      'kubernetes.default.svc', 'consul.service.consul', 'vault.service.consul',
      'algo.lan', 'algo.intranet', 'algo.corp', 'algo.private'
    ]) bloquea(v, 'sufijo interno');
  });

  test('REGRESIÓN L-3: puerto cruzado entre esquemas', () => {
    bloquea('http://ejemplo.test:443/', 'http en 443');
    bloquea('https://ejemplo.test:80/', 'https en 80');
  });

  test('REGRESIÓN L-4: corchetes en ruta o query NO deben bloquear', () => {
    /* Se miraba `u.href.includes('[')`, así que cualquier URL legítima con
       corchetes en la query —?filtro[0]=azul, de lo más común en tiendas— se
       rechazaba como si fuera IPv6 literal. */
    permite('https://tienda.test/?filtro[0]=azul');
    permite('https://tienda.test/path[0]');
    permite('https://tienda.test/?a[]=1&a[]=2');
  });

  test('destinos legítimos normales pasan', () => {
    for (const v of [
      'https://sycsolutions.company', 'sycsolutions.company', 'www.sycsolutions.company',
      'https://ejemplo.test/una/ruta?con=query#y-fragmento',
      'https://xn--ejemplo-9za.test/', 'https://ejemplo.test/ñandú'
    ]) permite(v);
  });

  /* REGRESIÓN — El agujero que esta suite no podía ver.
     Los 190 vectores de arriba son todos SINTÁCTICOS: comprueban que la cadena
     del hostname no sea una IP prohibida escrita de alguna forma rara. Pero
     `inseguro()` decidía sólo sobre la cadena, y un NOMBRE que resuelve a una IP
     privada la atravesaba entera. No hacía falta ni registrar un dominio: los
     servicios de DNS comodín resuelven a la IP que llevan escrita en el nombre,
     son públicos y son gratis.
     La defensa real es la comprobación tras resolver —`ipDeDestinoProhibida`,
     que consulta DNS y por tanto no se puede probar aquí sin red—, pero estos
     sufijos se rechazan además léxicamente, y eso sí se prueba y es lo que hace
     que la barrera siga en pie aunque el resolvedor no conteste. */
  test('REGRESIÓN: los servicios de DNS comodín no pasan', () => {
    for (const v of [
      '127.0.0.1.nip.io', 'http://169.254.169.254.nip.io/latest/meta-data/',
      '10.0.0.1.sslip.io', '192.168.1.1.sslip.io', 'https://1.2.3.4.xip.io/',
      'localtest.me', 'app.localtest.me', 'lvh.me', 'algo.vcap.me',
      'x.traefik.me', '1.2.3.4.1u.ms'
    ]) bloquea(v, 'DNS comodín: resuelve a la IP escrita en el nombre');
  });

  /* REGRESIÓN — LA TABLA DE RANGOS ES /24 DONDE EL RANGO RESERVADO ES /24.
     Estaban escritas como /16 y durante mucho tiempo fue inocuo: la tabla sólo
     veía IPs que el visitante escribía a mano, y nadie audita su web por IP.
     Desde que la comprobación tras resolver pasa por aquí cada registro A de
     cada dominio, cada /16 de más son ~65.000 direcciones PÚBLICAS a cuyos
     dueños se les respondería «no se pueden analizar direcciones internas».
     Estas cuatro tienen que PASAR. Si alguna falla, se ha vuelto a ampliar una
     regla a /16 y hay clientes reales que no pueden usar el diagnóstico. */
  test('REGRESIÓN: el espacio público vecino de los /24 reservados NO se bloquea', () => {
    for (const [a, b, c] of [[203, 0, 50], [198, 51, 42], [192, 0, 66], [192, 88, 1]])
      assert.equal(rangoProhibido(a, b, c), false, `${a}.${b}.${c}.7 es público y debe pasar`);
  });

  test('los /24 reservados de verdad sí se bloquean', () => {
    for (const [a, b, c] of [[192, 0, 0], [192, 0, 2], [198, 51, 100], [203, 0, 113], [192, 88, 99]])
      assert.equal(rangoProhibido(a, b, c), true, `${a}.${b}.${c}.0/24 está reservado`);
  });

  test('rangos IPv6 internos', () => {
    for (const v of ['::1', '::', 'fc00::1', 'fd12:3456::1', 'fe80::1', 'fec0::1',
                     'ff02::1', '64:ff9b::7f00:1', '2002:a00:1::', '::ffff:127.0.0.1', '::7f00:1'])
      assert.equal(ipv6Prohibida(v), true, `${v} es interna o traduce a interna`);
    for (const v of ['2606:2800::1', '2a00:1450:4001::2004', '2001:db8::1'])
      assert.equal(ipv6Prohibida(v), false, `${v} es pública y debe pasar`);
  });

  /* Y la otra mitad de la misma moneda: el rechazo va anclado al final del
     nombre, así que un dominio legítimo que CONTENGA esas letras sigue pasando.
     Sin el anclaje, "nipon.io" o cualquier cliente cuyo dominio terminara en
     "-nip.io" habría dejado de poder auditarse, y un filtro que rechaza clientes
     reales se acaba desactivando entero. */
  test('REGRESIÓN: dominios legítimos parecidos a los comodín sí pasan', () => {
    for (const v of [
      'https://nipon.io/', 'https://minip.io.ejemplo.com/', 'https://sslip.ejemplo.com/',
      'https://localtest.mexico.mx/', 'https://ejemplo.com/nip.io'
    ]) permite(v);
  });
});
