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

### Comprobación de que el Worker DESPLEGADO valida Turnstile — 18 ago 2026

Contexto: el panel de Cloudflare mostró el aviso *«Siteverify isn't being called
for SyC Diagnostico SEO. Without a server-side siteverify call, widget tokens
aren't validated. The forms these widgets protect remain open to bots.»*

**El código sí llama a siteverify.** Entró en `ccfedc6` (8 ago 2026):
`verificaTurnstile()` en `seo-audit.js` hace `POST` a
`https://challenges.cloudflare.com/turnstile/v0/siteverify` con
`env.TURNSTILE_SECRET`, comprueba `success`, `hostname` y `action`, rechaza las
secret keys de prueba fuera de desarrollo, y **falla cerrado**: sin secreto no
analiza, responde `503`.

**Y el Worker desplegado lleva ese código.** Se comprobó con un canario nuevo
que funciona desde fuera, sin navegador y sin cabeceras propias:

```bash
curl -sS -D- https://audit.sycsolutions.company/robots.txt
```

Respuesta obtenida el 18 ago 2026, 06:39 UTC:

```
HTTP/2 200
content-type: text/plain; charset=utf-8
content-length: 26
cache-control: public, max-age=86400
x-content-type-options: nosniff

User-agent: *
Disallow: /
```

Por qué esto demuestra la versión: la ruta `/robots.txt` del Worker **no existía
antes de `ccfedc6`** (verificado con `git show ccfedc6^:…/seo-audit.js`), y esas
tres cabeceras exactas más los 26 bytes exactos sólo los produce el bloque
introducido en ese commit. Y por qué funciona cuando lo demás no: Super Bot
Fight Mode deja pasar las extensiones estáticas —`.txt`, `.js`, `.xml`— y bloquea
con `403` todo lo demás, incluida la ruta `/` del diagnóstico. Es la única
sonda de versión que sobrevive a esa capa.

**Lo que el canario NO demuestra:** que `TURNSTILE_SECRET` esté puesto, y que sea
el del widget correcto. Eso no se puede ver desde fuera. Y son justamente las dos
causas que producirían el aviso del panel con el código ya desplegado:

| Estado del secreto | Qué hace el Worker | Qué ve el visitante | Qué ve el panel |
|---|---|---|---|
| Correcto (widget `SyC Diagnostico SEO`) | valida y analiza | el informe | siteverify llamado |
| **Ausente** | `503` `X-Limitador: turnstile-sin-secreto` | «El diagnóstico no está disponible ahora mismo» | **cero llamadas → el aviso** |
| **El del widget del CONTACTO** | siteverify responde `invalid-input-response` → `403` | «La verificación anti-bots caducó» | **cero llamadas para ESTE widget → el aviso** |

**La comprobación, y no hace falta ninguna herramienta.** Abre
`https://sycsolutions.company`, baja al diagnóstico, escribe cualquier dirección
y pulsa **Analizar**:

- **Sale el informe** → el secreto es el correcto. No hay nada que hacer; el
  aviso del panel es anterior al despliegue del 8 de agosto.
- **«El diagnóstico no está disponible ahora mismo»** → falta `TURNSTILE_SECRET`.
- **«La verificación anti-bots caducó»**, y se repite al reintentar → el secreto
  puesto es de otro widget.

En los dos casos malos, el arreglo es el mismo y **lo tiene que hacer Santiago**,
porque implica manejar una clave:

1. Panel de Cloudflare → **Turnstile** → widget **`SyC Diagnostico SEO`**
   (sitekey `0x4AAAAAAEKjpagA_DLwswxz`) → copiar su **Secret Key**.
   ⚠ El widget del formulario de contacto es OTRO (`SyC OS Gateway`, sitekey
   `0x4AAAAAAEK4XVI_9s0X_JX9`) y su secreto vive en el gateway, no aquí.
   Confundirlos es exactamente el fallo de la tercera fila de la tabla.
2. En este directorio:

```bash
npx wrangler@4.120.0 secret put TURNSTILE_SECRET
```

   El nombre exacto de la variable es **`TURNSTILE_SECRET`**, y va como **secreto
   del Worker `syc-seo-audit`**, nunca en un archivo del repositorio. Wrangler la
   pide por teclado y no la muestra.
3. Confirmar sin verla, junto con la otra:

```bash
npx wrangler@4.120.0 secret list
```

   Tienen que aparecer `SAL_LIMITE` y `TURNSTILE_SECRET`.
4. Repetir la comprobación del navegador.

**No se ha quitado el widget, y no es una opción.** Este endpoint abre hasta 13
subpeticiones salientes por análisis contra dominios que elige quien llama, y
gasta invocaciones de Worker y operaciones de Durable Object: es una factura
esperando a ocurrir. Un endpoint así se valida y se limita; no se deja sin
candado.

### El 429 con mensaje propio: pendiente de verificación en producción

No se puede provocar a mano con facilidad y **no se relaja nada para poder
probarlo**. Hacen falta 20 tokens de Turnstile válidos en 60 segundos, y cada
token es de un solo uso: no se pueden reutilizar ni fabricar. La única forma
honesta es pulsar «Analizar» veinte veces en un minuto, resolviendo el widget
cada vez.

Queda cubierto en local por 33 pruebas de concurrencia —incluidas 40, 100 y 500
simultáneas con sobrepaso cero— y por la ráfaga real de 35 secuenciales que ya se
midió contra producción antes de existir Turnstile: 20 pasaron, 15 dieron 429.

Si alguna vez se provoca en producción, anótalo aquí con la fecha.

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

**El canario se lee por el CÓDIGO, no por la cabecera.** Y conviene saber por
qué, porque la primera versión de este documento decía lo contrario y no era
ejecutable:

- `X-Limitador` **no se puede leer desde el navegador**: es una cabecera propia y
  no está en `Access-Control-Expose-Headers`, así que el navegador la esconde.
- Desde `curl` o PowerShell **tampoco**: Super Bot Fight Mode bloquea a los
  clientes que no son navegador antes de que el Worker llegue a ejecutarse, y
  devuelve su propio 403 sin ninguna cabecera nuestra.

Entre las dos cosas, la cabecera no es observable en producción por nadie que
esté haciendo el despliegue. El código de estado sí, y basta:

| Respuesta | Qué significa | Qué hacer |
|---|---|---|
| **`403`** | La secret real está puesta y rechazó el token de ejemplo. | Correcto, seguir. |
| **`503`** | El Worker no pudo validar. Ver el desempate de abajo. | **PARAR**. |
| **`200`** | Hay una clave de prueba desplegada **y** el gate no funcionó. | **PARAR**. Lo peor de los tres. |

**Desempate del 503.** Hay dos causas y se distinguen sin leer cabeceras:

1. Espera un minuto y repite. Si pasa a `403`, era **siteverify caído o lento**:
   transitorio, no hay nada que arreglar.
2. Si sigue en `503`, es una **clave de prueba desplegada**. Confírmalo con
   `npx wrangler secret list` —el nombre estará— y vuelve a poner la secret real
   del panel. Una clave de prueba empieza por `1x`, `2x` o `3x`.

El `403` es además una prueba positiva fuerte: sólo puede salir de que siteverify
haya **rechazado** el token de ejemplo, y eso sólo lo hace una secret real. Con la
clave de prueba «siempre pasa» la respuesta sería `503`, nunca `403`.

*Mejora posible, deliberadamente NO hecha:* añadir `X-Limitador` a
`Access-Control-Expose-Headers` haría el diagnóstico legible desde el navegador.
Se descartó por ahora porque obliga a un despliegue más del Worker y amplía a
cualquier origen la visibilidad del estado interno de la defensa, a cambio de
comodidad. Si algún día se hace, este canario puede volver a leerse por cabecera.

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
