# Diagnóstico SEO — Worker de Cloudflare

Analiza la página pública que le indiquen y devuelve una nota de 0 a 100 con los
hallazgos. Es lo que alimenta la sección **03 — Diagnóstico** del sitio.

Existe como Worker y no como código de navegador porque el navegador no puede
leer otro dominio: la política de origen cruzado lo impide. Cualquier auditor
que se anuncie como «100 % en el navegador» o miente o no analiza nada.

## Desplegar

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB\Kimi_Agent_Web 3D Optimizada\cloudflare"
npx wrangler login
npx wrangler deploy
```

`deploy` imprime una URL de `*.workers.dev`, pero **no es la que usa la web**.
El Worker se sirve desde un subdominio propio configurado en el panel de
Cloudflare (Workers → Domains & Routes):

```
https://audit.sycsolutions.company
```

Eso no es cosmético. Servirlo desde la zona propia es lo que hace que funcione
la Cache API —y con ella el límite de peticiones, que en `*.workers.dev` no
contaba nada—, permite añadir reglas de WAF de zona, y evita publicar el
subdominio de la cuenta de Cloudflare en la cabecera de seguridad de la web.

Si ese subdominio cambia hay que tocarlo en **dos** sitios, y los dos importan:

```js
// app/index.html  (busca SYC_AUDITOR)
window.SYC_AUDITOR='https://audit.sycsolutions.company';
```

```
# app/_headers  -> directiva connect-src de la CSP
connect-src 'self' https://audit.sycsolutions.company
```

Si sólo se cambia el primero, la CSP bloquea la petición y el diagnóstico deja
de funcionar sin decir por qué. Mientras `SYC_AUDITOR` siga vacía, el
formulario avisa de que no está conectado en lugar de fingir un análisis.

La dirección de `*.workers.dev` sigue activa y respondiendo; simplemente ya no
la usa la web.

## Probar en local

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB\Kimi_Agent_Web 3D Optimizada\cloudflare"
npx wrangler dev --port 8788 --local
```

```bash
curl "http://127.0.0.1:8788/?url=https%3A%2F%2Fejemplo.com"
```

## Qué comprueba y cuánto pesa

| Comprobación | Peso |
|---|---:|
| Título (30–65 caracteres) | 12 |
| Meta descripción (110–165) | 12 |
| Un único H1 | 10 |
| Datos estructurados (schema.org) | 10 |
| Open Graph completo | 8 |
| Texto alternativo en imágenes | 8 |
| URL canónica | 6 |
| Meta viewport | 6 |
| HTTPS | 6 |
| robots.txt | 5 |
| sitemap.xml | 5 |
| Tiempo de respuesta | 5 |
| Idioma declarado | 4 |
| Peso del HTML | 3 |

Cada comprobación puntúa entero (`ok`), la mitad (`warn`) o cero (`bad`).
Un `noindex` no resta: **limita la nota a 15**, porque de nada sirve lo demás si
la página le está pidiendo a Google que la ignore.

## Seguridad

Verificado contra el Worker en ejecución:

- solo `http` y `https` — `file:`, `ftp:` y `javascript:` se rechazan;
- se bloquean `localhost`, `.local`, `.internal`, IPv6 literal y los rangos
  privados 10/8, 127/8, 172.16–31, 192.168, 169.254 y 100.64–127;
- redirecciones seguidas a mano, máximo 3 saltos, **revalidando cada salto**
  (si no, una redirección a `127.0.0.1` sortearía el filtro de entrada);
- se exige `Content-Type` de HTML;
- corte de lectura a 1,5 MB y de espera a 12 s;
- CORS restringido a los orígenes de `ORIGENES` en `seo-audit.js`.

**Limitaciones conocidas, sin resolver:**

- **No hay límite de peticiones por IP.** El resultado se cachea una hora por
  URL, lo que corta el abuso más obvio (martillear el mismo sitio), pero no
  impide que alguien recorra miles de dominios distintos. Si el Worker se
  expone públicamente y se nota tráfico raro, hay que añadir el binding de
  Rate Limiting de Cloudflare.
- **Reenlace de DNS.** Un dominio público que resuelva a una IP privada no lo
  detecta el filtro, que solo mira la cadena del host. En la práctica los
  Workers no alcanzan redes privadas desde el borde, así que el riesgo real es
  bajo, pero el filtro por sí solo no lo cubre.
- El plan de 5 USD cubre 10 millones de peticiones al mes; cada análisis gasta
  entre 1 y 3 peticiones salientes.
