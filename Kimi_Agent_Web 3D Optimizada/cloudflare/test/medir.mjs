/**
 * Medición de latencia del limitador. No es un test: imprime números.
 *
 *   cd "Kimi_Agent_Web 3D Optimizada/cloudflare"
 *   node test/medir.mjs
 *
 * Sirve para elegir el presupuesto de tiempo (PRESUPUESTO_DO_MS) con datos en
 * vez de a ojo. Aviso importante sobre lo que estos números NO son: en local el
 * Durable Object vive en el mismo proceso, así que esto mide el coste de la
 * sección crítica y del despacho, NO la red. En producción hay que sumar el
 * viaje de ida y vuelta al centro de datos donde viva el objeto, que puede
 * estar en otro continente, más el arranque en frío la primera vez.
 */

import { arranca, para } from './arranque.mjs';

const PUERTO = 8981;

function pct(orden, p) {
  if (!orden.length) return 0;
  return orden[Math.min(orden.length - 1, Math.ceil((p / 100) * orden.length) - 1)];
}

function resume(nombre, ms) {
  const o = [...ms].sort((a, b) => a - b);
  const media = o.reduce((a, b) => a + b, 0) / o.length;
  console.log(
    `${nombre.padEnd(34)} n=${String(o.length).padStart(4)}  ` +
    `media=${media.toFixed(1).padStart(6)}ms  p50=${String(pct(o, 50)).padStart(4)}  ` +
    `p95=${String(pct(o, 95)).padStart(5)}  p99=${String(pct(o, 99)).padStart(5)}  max=${String(o[o.length - 1]).padStart(5)}`
  );
  return { p50: pct(o, 50), p95: pct(o, 95), p99: pct(o, 99), max: o[o.length - 1] };
}

let lab = null;
try {
  lab = await arranca({ config: 'test/wrangler.test.toml', puerto: PUERTO });
  const B = lab.base;

  /* 1. Coste del limitador aislado, objeto ya caliente. */
  const calienta = 'medida-caliente';
  await fetch(`${B}/__consume?clave=${calienta}&tope=100000&ventana=60000`);
  const caliente = [];
  for (let i = 0; i < 200; i++) {
    const r = await (await fetch(`${B}/__consume?clave=${calienta}&tope=100000&ventana=60000`)).json();
    caliente.push(r.ms);
  }
  resume('DO caliente (solo consume)', caliente);

  /* 2. Coste con el objeto frío: clave nueva cada vez. */
  const frio = [];
  for (let i = 0; i < 60; i++) {
    const r = await (await fetch(`${B}/__consume?clave=frio-${i}-${Date.now()}&tope=20&ventana=60000`)).json();
    frio.push(r.ms);
  }
  resume('DO frío (objeto nuevo)', frio);

  /* 3. Camino completo del Worker: primera petición (MISS, análisis real) y
        siguientes (HIT de caché). Se usa un dominio que no resuelve, así que el
        "análisis" es el coste de intentarlo y fallar, no el de una web real. */
  const ipA = '203.0.113.201';
  const miss = [];
  for (let i = 0; i < 15; i++) {
    const t = Date.now();
    await fetch(`${B}/?url=${encodeURIComponent('https://ejemplo.test/m' + i)}`,
      { headers: { 'CF-Connecting-IP': ipA } });
    miss.push(Date.now() - t);
  }
  resume('Worker, caché MISS', miss);

  const ipB = '203.0.113.202';
  await fetch(`${B}/?url=${encodeURIComponent('https://ejemplo.test/hit')}`,
    { headers: { 'CF-Connecting-IP': ipB } });
  const hit = [];
  for (let i = 0; i < 15; i++) {
    const t = Date.now();
    await fetch(`${B}/?url=${encodeURIComponent('https://ejemplo.test/hit')}`,
      { headers: { 'CF-Connecting-IP': ipB } });
    hit.push(Date.now() - t);
  }
  resume('Worker, caché HIT', hit);

  /* 4. Peticiones ya limitadas: deben ser lo más barato de todo. */
  const ipC = '203.0.113.203';
  for (let i = 0; i < 20; i++) {
    await fetch(`${B}/?url=${encodeURIComponent('https://ejemplo.test/x')}`,
      { headers: { 'CF-Connecting-IP': ipC } });
  }
  const limitadas = [];
  for (let i = 0; i < 40; i++) {
    const t = Date.now();
    const r = await fetch(`${B}/?url=${encodeURIComponent('https://ejemplo.test/x')}`,
      { headers: { 'CF-Connecting-IP': ipC } });
    if (r.status !== 429) throw new Error('esperaba 429, llegó ' + r.status);
    limitadas.push(Date.now() - t);
  }
  resume('Worker, petición ya limitada', limitadas);

  /* 5. Bajo presión: 100 simultáneas contra la MISMA identidad, que es el peor
        caso para el objeto porque las serializa todas. */
  const q = new URLSearchParams({ n: '100', ip: '203.0.113.204', sub: '/?url=https%3A%2F%2Fejemplo.test' });
  const r = await (await fetch(`${B}/__rafaga?${q}`)).json();
  console.log(
    `${'100 simultáneas, misma identidad'.padEnd(34)} ` +
    `p50=${String(r.p50).padStart(4)}  p95=${String(r.p95).padStart(5)}  p99=${String(r.p99).padStart(5)}  ` +
    `total=${r.totalMs}ms  solape=${r.maxEnVuelo}`
  );

  console.log('\nRecordatorio: estos números NO incluyen la red. En producción hay que sumar');
  console.log('el viaje al centro de datos del objeto y el arranque en frío la primera vez.');
} finally {
  await para(lab);
}
