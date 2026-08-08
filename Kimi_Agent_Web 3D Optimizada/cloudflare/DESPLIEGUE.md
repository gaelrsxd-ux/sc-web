# Despliegue del limitador atómico

Procedimiento para cuando esté autorizado. **Nada de esto se ha ejecutado.**

Estado actual verificado: producción corre la versión de `HEAD`, **sin** Durable
Object. Se confirmó porque ninguna respuesta trae la cabecera `X-Limitador`.

## Orden completo

1. Arreglar en el panel de Cloudflare el skip de SEO y `lower(http.host)`.
2. Subir el umbral de la regla de rate limiting a 60/60 s.
3. Crear el widget de Turnstile y pegar la sitekey en el HTML.
4. Crear los **dos** secretos: `SAL_LIMITE` y `TURNSTILE_SECRET`.
5. Commit y push.
6. Desplegar el Worker.
7. Verificar en producción.
8. Apagar `workers.dev` y volver a verificar.
9. Revocar el token temporal de la API.

Los pasos 1, 2 y 3 son de panel: los hace Santiago a mano.

## Antes de empezar: la trampa que más caro sale

Desplegar el Worker **sin los secretos** deja el diagnóstico devolviendo **503 a
todo el mundo**, porque la política es fallo cerrado. Son dos, y falta cualquiera
de ellos produce el mismo resultado:

- `SAL_LIMITE` → sin ella no hay identidad → `X-Limitador: sin-identidad`
- `TURNSTILE_SECRET` → sin él no se valida el token → `X-Limitador: turnstile-sin-secreto`

Por eso los secretos van **primero** y en pasos separados, con comprobación.

## 0. Crear el widget de Turnstile (panel, manos de Santiago)

1. Panel de Cloudflare → **Turnstile** → **Add widget**.
2. Nombre: `sycsolutions-diagnostico`.
3. Hostnames: `sycsolutions.company`, `www.sycsolutions.company`,
   `syc-solutions.pages.dev`.
   Son los del **sitio**, donde se pinta el widget — no `audit.*`, que es la API.
4. Widget Mode: **Managed**.
5. Guardar. La pantalla da dos valores:
   - **Site Key** → es pública, va en el HTML.
   - **Secret Key** → no se copia a ningún archivo; se usa en el paso 2.

**Hecho ya.** La Site Key está puesta en `app/index.html`:

```
const SITEKEY='0x4AAAAAAEKjpagA_DLwswxz';
```

Si alguien la devolviera al marcador `PENDIENTE_SITEKEY`, el formulario avisa en
vez de fingir un análisis, igual que hace `SYC_AUDITOR` cuando está vacío.

Lo que sigue pendiente de este paso es **sólo la Secret Key**, que va al Worker
como secreto (paso 2). No se copia a ningún archivo.

Al tocar ese script hay que regenerar las huellas de la CSP:

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB" && node tools/csp-hashes.mjs && node tools/csp-hashes.mjs --check
```

## 1. Generar la sal, sin que aparezca en pantalla ni en disco

`wrangler secret put` lee de la entrada estándar, así que se le puede pasar el
valor por tubería sin que se escriba en ningún archivo ni quede en el historial
del shell.

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB\Kimi_Agent_Web 3D Optimizada\cloudflare" && node -e "process.stdout.write(require('crypto').randomBytes(32).toString('base64url'))" | npx wrangler@4.120.0 secret put SAL_LIMITE
```

Genera 32 bytes (256 bits) de `crypto.randomBytes`, los codifica en base64url
—43 caracteres, que es justo el mínimo que exige la validación— y los entrega a
Wrangler por la tubería. El valor **no se imprime, no se guarda y no se puede
recuperar** después: si hace falta cambiarlo, se genera otro.

Y el segundo secreto, la Secret Key del widget. `wrangler` la pide por teclado y
no la muestra:

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB\Kimi_Agent_Web 3D Optimizada\cloudflare" && npx wrangler@4.120.0 secret put TURNSTILE_SECRET
```

**Puerta de control.** Comprobar que existen los dos, sin verlos:

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB\Kimi_Agent_Web 3D Optimizada\cloudflare" && npx wrangler@4.120.0 secret list
```

Deben aparecer `SAL_LIMITE` **y** `TURNSTILE_SECRET`. Si falta cualquiera de los
dos, **no sigas**: el despliegue dejaría el diagnóstico en 503 para todos.

## 2. Confirmar que todo pasa en local

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB\Kimi_Agent_Web 3D Optimizada\cloudflare" && node --test --test-concurrency=1 "test/*.test.mjs"
```

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB" && node tools/scan-secretos.mjs --todo && node tools/csp-hashes.mjs --check
```

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB\Kimi_Agent_Web 3D Optimizada\cloudflare" && npx wrangler@4.120.0 deploy --dry-run --outdir "%TEMP%\syc-dry"
```

## 3. Commit y push

El commit incluye la migración del Durable Object, así que no se parte en dos.

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB" && git add .gitignore tools/scan-secretos.mjs "Kimi_Agent_Web 3D Optimizada/cloudflare" && git status --short
```

Revisa el `status` antes de commitear. **No debe aparecer** ningún `.dev.vars`,
`.env` ni nada con la sal real.

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB" && git commit -m "Limitador atomico con Durable Object: la rafaga simultanea deja de colarse"
```

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB" && git push origin main
```

## 4. Desplegar el Worker

Este paso crea la clase del Durable Object mediante la migración `v1`.

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB\Kimi_Agent_Web 3D Optimizada\cloudflare" && npx wrangler@4.120.0 deploy
```

**Ojo con la variable de entorno.** `CLOUDFLARE_API_TOKEN` está en el entorno,
wrangler la prefiere sobre la sesión OAuth, y ese token no tiene permisos de
Workers: el comando de arriba falla con *"Failed to automatically retrieve
account IDs"*. Comprobado. La sesión OAuth **sí** puede desplegar. Hay que
lanzarlo sin esa variable, en Git Bash:

```bash
cd "/c/Users/gaelr/OneDrive/Desktop/WEB/Kimi_Agent_Web 3D Optimizada/cloudflare" && env -u CLOUDFLARE_API_TOKEN npx wrangler@4.120.0 deploy
```

**Sin `--env`, y es deliberado.** `wrangler.toml` no define ningún bloque
`[env.*]`, así que sólo existe el entorno de arriba, con `ENTORNO = "prod"`. Las
configuraciones con `ENTORNO = "dev"` viven en archivos aparte dentro de `test/`,
con nombres de Worker distintos (`syc-seo-audit-test`, `-sinsal`, `-sinbinding`,
`-sinentorno`) y sin ninguna `route` ni `custom_domain`: no son desplegables por
accidente ni apuntan a ningún hostname real.

Aviso sobre `[limits]`: el bloque sólo se admite en el modelo de uso Standard. Si
la cuenta estuviera en Bundled, el despliegue fallaría ahí; en ese caso, quitar
el bloque y desplegar, y tratarlo aparte.

## 5. Comprobar en producción

La cabecera `X-Limitador` es lo que distingue un limitador vivo de uno apagado.
**Sin ella, un 200 no demuestra nada.**

Nota: Super Bot Fight Mode bloquea a curl y PowerShell con 403 en este
hostname. Estas comprobaciones hay que hacerlas desde el navegador, con la
consola abierta en `https://sycsolutions.company`, o desde una herramienta que
Cloudflare no clasifique como automatizada.

```js
// En la consola del navegador, en https://sycsolutions.company
const r = await fetch('https://audit.sycsolutions.company/?url=' + encodeURIComponent('https://sycsolutions.company'));
console.log(r.status, r.headers.get('X-Limitador'));   // esperado: 200 "ok"
```

| Comprobación | Esperado |
|---|---|
| Un análisis desde el formulario del sitio | funciona, sin ver el widget (modo gestionado) |
| Petición sin cabecera `X-Turnstile-Token` | `403`, `X-Limitador: turnstile-precheck` |
| Token inventado | `403`, `X-Limitador: turnstile-rechazado` |
| Repetir el MISMO token dos veces | el segundo da `403` (los tokens son de un solo uso) |
| `/robots.txt?url=…` | `200` con el robots, **nunca un informe** |
| `/sitemap.xml?url=…` y cualquier otra ruta | `404` |
| **El token de ejemplo `XXXX.DUMMY.TOKEN.XXXX`** | **`403`, `X-Limitador: turnstile-rechazado`** |
| Una petición normal | `200`, `X-Limitador: ok` |
| 21 seguidas | la 21 da `429`, `X-Limitador: limite` |
| 40 simultáneas, ventana limpia | **20 aceptadas como máximo**. Antes pasaban 39 |
| 100 simultáneas | 20 aceptadas como máximo |
| Repetir la misma URL ya cacheada, en ráfaga | sigue cortando en 20 |
| Esperar 60 s sin tráfico | vuelve a `200` |

### Comprobación de que NO hay una clave de prueba desplegada

Es la que más barata sale de olvidar y la que más caro cuesta: con la clave de
prueba «siempre pasa», Turnstile aceptaría cualquier cosa y el control quedaría
en un adorno sin que nada lo delate.

La comprobación se apoya en un hecho de Cloudflare: **una secret key de
producción rechaza el token de ejemplo**. Así que basta con enviarlo.

```js
// En la consola del navegador, en https://sycsolutions.company
const r = await fetch('https://audit.sycsolutions.company/?url=' + encodeURIComponent('https://sycsolutions.company'),
  { headers: { 'X-Turnstile-Token': 'XXXX.DUMMY.TOKEN.XXXX' } });
console.log(r.status, r.headers.get('X-Limitador'));
```

Tres salidas posibles, y las tres significan cosas distintas:

| Respuesta | Qué significa | Qué hacer |
|---|---|---|
| **`403` + `turnstile-rechazado`** | La secret real está puesta y rechazó el token de ejemplo. | Correcto, seguir. |
| **`503` + `turnstile-claves-de-prueba`** | Hay una clave de PRUEBA desplegada. El gate la detectó y cerró. | **PARAR** y poner la secret real. |
| **`200`** | Hay una clave de prueba desplegada **y** el gate no funcionó. | **PARAR**. Lo peor de los tres. |

Ojo con el segundo: `503` **no** significa aquí «siteverify caído». Ese caso sale
como `turnstile-inalcanzable` o `turnstile-http-<estado>`. Es la cabecera
`X-Limitador` la que distingue, no el código.

Ráfaga desde la consola del navegador:

```js
const u = 'https://audit.sycsolutions.company/?url=' + encodeURIComponent('https://sycsolutions.company');
const r = await Promise.all(Array.from({length: 40}, () => fetch(u).then(x => x.status)));
console.log(r.filter(s => s === 200).length + ' aceptadas de 40');
```

### Multi-colo

No se puede forzar desde una sola máquina. Lo que sí se puede: repetir la ráfaga
desde una red distinta (datos del móvil) y comprobar que esa IP tiene su propia
cuota de 20, no que comparte la anterior.

## 6. Security Events

Panel → **sycsolutions.company → Security → Events**, últimos 30 minutos.
Filtrar por `Service: Rate limiting` y por el hostname `audit.sycsolutions.company`.

Con el Durable Object desplegado, la mayoría de los bloqueos deberían venir del
**Worker** (429 sin evento de WAF), no de la regla del WAF: el limitador atómico
corta antes y de forma más precisa. Ver un número de eventos de WAF **menor** que
antes es la señal esperada, no un problema.

## 7. Rollback

| Nivel | Cuándo | Cómo |
|---|---|---|
| 1 | El diagnóstico devuelve 503 y no se sabe por qué | `LIMITE_ATOMICO = "off"` en `wrangler.toml` + `wrangler deploy` |
| 2 | Algo peor | `git revert` del commit + `wrangler deploy` |
| 3 | Retirar la clase | Migración con `deleted_classes` |

Aviso: `wrangler deploy --var` **no persiste**; el interruptor hay que cambiarlo
en el archivo para que sobreviva al siguiente despliegue.

Lo que **no** vuelve atrás: el `tag` de la migración no se reutiliza, y los datos
de los objetos ya creados no se recuperan (son marcas de tiempo de menos de un
minuto, así que no se pierde nada que importe).

## 8. Apagar workers.dev — DESPUÉS, y no antes

Comprobado que **hoy sigue vivo y sirve el Worker completo sin ningún bloqueo**:
`https://syc-seo-audit.<subdominio>.workers.dev/?url=…` devolvió `200` con el
informe entero mientras el mismo `curl` contra `audit.sycsolutions.company`
recibía `403`.

Ese hostname **no lo cubre el WAF de la zona, ni la regla de rate limit, ni
Super Bot Fight Mode**. Mientras siga encendido, toda la capa de borde es
opcional para quien conozca la dirección.

El cambio, en `wrangler.toml`:

```toml
workers_dev = false
```

Antes de apagarlo:

```bash
cd "C:\Users\gaelr\OneDrive\Desktop\WEB" && git grep -n "workers.dev"
```

No debe quedar ninguna referencia viva en configuración —sólo comentarios y
documentación—. Ya se verificó: `SYC_AUDITOR` en `app/index.html` y el
`connect-src` de `app/_headers` apuntan al dominio propio.

Después de apagarlo, comprobar que el hostname deja de responder y que el
diagnóstico sigue funcionando desde el sitio.
