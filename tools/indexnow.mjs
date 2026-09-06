/* Avisa a los buscadores que usan IndexNow (Bing, Yandex, Naver, Seznam…) de
   TODAS las URL del sitemap. ChatGPT busca con el índice de Bing, así que este
   aviso es el camino más corto para que una guía nueva exista para él.
   Google no participa en IndexNow: a Google se le avisa con Search Console.

   La clave es pública por diseño: vive en app/<clave>.txt, el buscador la lee
   desde https://sycsolutions.company/<clave>.txt para confirmar que quien avisa
   es el dueño del dominio. No es un secreto y no hay que esconderla.

     node tools/indexnow.mjs           → avisa
     node tools/indexnow.mjs --check   → sólo enseña qué avisaría
     node tools/indexnow.mjs --json    → imprime el cuerpo del aviso (para curl)

   Lo corre .github/workflows/indexnow.yml en cada push a main. */
import fs from 'node:fs';
import path from 'node:path';

const APP = 'Kimi_Agent_Web 3D Optimizada/app';
const HOST = 'sycsolutions.company';

const archivo = fs.readdirSync(APP).find(f => /^[a-f0-9]{32}\.txt$/.test(f));
if (!archivo) { console.error('indexnow: falta app/<clave>.txt (32 caracteres hexadecimales)'); process.exit(1); }
const clave = fs.readFileSync(path.join(APP, archivo), 'utf8').trim();
if (clave !== archivo.replace(/\.txt$/, '')) { console.error('indexnow: la clave dentro del archivo no coincide con su nombre'); process.exit(1); }

const sitemap = fs.readFileSync(path.join(APP, 'sitemap.xml'), 'utf8');
const urls = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(m => m[1]);
if (urls.length === 0 || urls.some(u => !u.startsWith(`https://${HOST}/`))) { console.error('indexnow: el sitemap no trae URL del dominio'); process.exit(1); }

const cuerpo = { host: HOST, key: clave, keyLocation: `https://${HOST}/${archivo}`, urlList: urls };
if (process.argv.includes('--json')) { console.log(JSON.stringify(cuerpo)); process.exit(0); }
if (process.argv.includes('--check')) { console.log(`indexnow: ${urls.length} URL listas para avisar con la clave ${archivo}`); process.exit(0); }

const r = await fetch('https://api.indexnow.org/indexnow', {
  method: 'POST', headers: { 'Content-Type': 'application/json; charset=utf-8' }, body: JSON.stringify(cuerpo),
});
/* 200 = recibido; 202 = recibido, clave pendiente de comprobar. Cualquier otra
   cosa es un aviso que no llegó, y conviene que el job lo diga. */
console.log(`indexnow: ${r.status} ${r.statusText} · ${urls.length} URL de ${HOST}`);
process.exit(r.status === 200 || r.status === 202 ? 0 : 1);
