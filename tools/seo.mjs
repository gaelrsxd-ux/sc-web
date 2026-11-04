#!/usr/bin/env node
/**
 * Comprobación SEO sin dependencias ni red. Examina lo que se publica en Cloudflare Pages.
 * Ejecutar: node tools/seo.mjs
 */
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const appDir = resolve(dirname(fileURLToPath(import.meta.url)), '../Kimi_Agent_Web 3D Optimizada/app');
const origin = 'https://sycsolutions.company';
const problems = [];
const check = (ok, message) => { if (!ok) problems.push(message); };
const read = (name) => readFileSync(join(appDir, name), 'utf8');
const sitemap = read('sitemap.xml');
const entries = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
check(entries.length > 0, 'sitemap.xml vacío');
check(new Set(entries).size === entries.length, 'URLs repetidas en sitemap.xml');

for (const loc of entries) {
  let url;
  try { url = new URL(loc); } catch { problems.push('URL inválida en sitemap: ' + loc); continue; }
  check(url.origin === origin && !url.search && !url.hash, 'URL no canónica en sitemap: ' + loc);
  const name = url.pathname === '/' ? 'index.html' : url.pathname.slice(1).replace(/\/$/, '') + '.html';
  const filepath = join(appDir, name);
  if (!existsSync(filepath)) { problems.push(loc + ': HTML inexistente ' + name); continue; }
  const html = read(name);
  const count = (re) => [...html.matchAll(re)].length;
  const title = html.match(/<title>([\s\S]*?)<\/title>/i)?.[1]?.trim();
  const description = html.match(/<meta\s+name=["']description["']\s+content=["']([^"']+)["']/i)?.[1];
  const canonical = html.match(/<link\s+rel=["']canonical["']\s+href=["']([^"']+)["']/i)?.[1];
  check(Boolean(title), name + ': sin título');
  check(Boolean(description), name + ': sin metadescripción');
  check(count(/<h1(?:\s|>)/gi) === 1, name + ': debe tener exactamente un H1');
  check(canonical === loc, name + ': canonical incorrecta (' + canonical + ')');
  check(!/<meta[^>]*name=["']robots["'][^>]*content=["'][^"']*noindex/i.test(html), name + ': noindex en URL del sitemap');

  for (const match of html.matchAll(/<script\b[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi)) {
    try { JSON.parse(match[1]); } catch (e) { problems.push(name + ': JSON-LD inválido: ' + e.message); }
  }

  // Comprueba las páginas enlazadas, evitando falsos positivos en anclas,
  // teléfonos, WhatsApp y servicios externos.
  for (const match of html.matchAll(/<a\b[^>]*href=["']([^"'<>]+)["']/gi)) {
    const href = match[1];
    if (!href || href.startsWith('#') || /^(?:https?:|mailto:|tel:|javascript:|data:)/i.test(href)) continue;
    let path = href.split(/[?#]/)[0];
    if (!path || path === '/') continue;
    if (!path.startsWith('/')) path = '/' + path;
    let linkedFile = path.slice(1);
    if (!linkedFile.endsWith('.html')) linkedFile += '.html';
    if (!existsSync(join(appDir, linkedFile))) problems.push(name + ': enlace interno roto: ' + href);
  }
}

if (problems.length) {
  for (const p of problems) console.error('SEO ERROR: ' + p);
  process.exitCode = 1;
} else {
  console.log('SEO OK: ' + entries.length + ' URLs verificadas (sitemap, títulos, H1, canonicals, metadescripciones, JSON-LD y enlaces).');
}
