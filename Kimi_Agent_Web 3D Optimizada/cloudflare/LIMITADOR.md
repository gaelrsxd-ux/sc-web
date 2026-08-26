# Limitador de tasa del diagnóstico SEO

Documento para dentro de un año. Explica **por qué** está hecho así, no qué hace
cada línea: eso está en el código.

Estado: **implementado y probado en local. NO desplegado.**

## El problema que resuelve

`audit.sycsolutions.company` analiza la web que le indiquen. Cada análisis abre
entre 1 y 3 conexiones salientes que se facturan a nuestra cuenta, así que el
endpoint necesita un tope por visitante.

Había dos capas y ninguna contaba bien una ráfaga simultánea. Medido en
producción: **de 40 peticiones lanzadas a la vez, pasaron 39**.

| Capa | Por qué no bastaba |
|---|---|
| Regla de Rate Limiting del WAF | Cuenta por centro de datos y con retraso. En una ráfaga instantánea el contador aún no ha subido. |
| Contador propio sobre Cache API | Lee y escribe en dos pasos. Las 40 leen el mismo cero y pasan las 40. |

Ninguna estaba rota: es que ninguna es atómica.

## Las cuatro capas, y qué protege cada una

```
1. WAF de zona (Cloudflare Pro)      20/60s por ip.src+cf.colo.id, en el borde
2. Durable Object SQLite             20/60s por identidad, atómico y global
3. Contador sobre Cache API          20/60s, no atómico
4. Lógica cara (análisis)
```

**1. WAF.** Corta antes de que el Worker se ejecute, así que una petición
bloqueada aquí no cuesta nada: ni invocación de Worker, ni de Durable Object, ni
filas. Es la carcasa gratuita.
*No protege de:* ráfagas instantáneas, y su cuota se multiplica por el número de
centros de datos que toque una misma IP.

**2. Durable Object.** Es el único punto del borde donde «leer, decidir y
escribir» no se puede entrelazar. Aquí está la garantía de que 100 peticiones
simultáneas dejan pasar exactamente 20.
*No protege de:* tráfico que no llegue al Worker, ni de un atacante con muchas
identidades distintas.

**3. Contador sobre Cache API.** Con el Durable Object sano **esta capa ya no
puede rechazar nada**: aquí sólo llegan peticiones que el limitador atómico
admitió, y admite 20 como mucho por ventana, que es el mismo tope que mira ésta.
Se conserva a propósito, como suelo para cuando la capa 2 no esté. Es una red,
no una capa activa.
*Además:* no funciona en `*.workers.dev`, porque la Cache API sólo opera en
dominios propios.

**4.** Lo que se protege.

## Decisiones y por qué

### Por qué el Durable Object va ANTES de la caché

El orden anterior consultaba la caché primero, con buen motivo: servir un
informe ya calculado no cuesta peticiones salientes, así que no había que
penalizarlo.

Pero deja un agujero mayor: **una ráfaga contra una URL ya cacheada se serviría
entera sin tocar ningún limitador.** Una respuesta cacheada no puede ser un
bypass del contador.

Ponerlo delante no endurece nada que no lo estuviera ya: la regla del WAF cuenta
**todas** las peticiones a ese hostname, aciertos de caché incluidos, con el
mismo tope. Esto sólo hace exacto lo que aquella capa ya intenta hacer.

Precio aceptado: recargar un informe ya calculado consume cuota.

### Por qué ventana deslizante y no ventana fija

La ventana fija permite el doble del tope a caballo del borde: 20 al final de un
minuto y 20 al principio del siguiente, 40 en milisegundos. Ese es exactamente
el pico que este trabajo venía a cerrar.

El argumento clásico contra guardar una marca por petición —que el estado crece
con el tráfico— no aplica: aquí lo acota el propio tope, así que la tabla nunca
pasa de 20 filas por identidad.

**Overshoot máximo teórico: 20** en cualquier ventana *semiabierta* de 60 s.
Matiz honesto: en un intervalo *cerrado* de exactamente 60 000 ms caben 40 (20
en `T` y 20 en `T+60000`), porque la marca de `T` caduca justo en ese instante.
Es el borde inherente a la ventana deslizante.
**Overshoot observado: 0** (10 rondas de 100 simultáneas).

### Por qué falla CERRADO

Si el limitador no puede garantizar que la petición cabe en la cuota, el
diagnóstico **no se ejecuta**: 503 con `Retry-After`.

Tiene un precio real: cualquier problema del Durable Object deja el diagnóstico
indisponible. Se acepta porque la operación de detrás es cara y se factura a
nuestra cuenta, y porque un limitador que se desactiva solo justo cuando algo
falla es exactamente el que querría un atacante.

El sitio público **no se ve afectado**: vive en Cloudflare Pages, en otro
hostname, y no pasa por aquí.

La única vía que abre es el interruptor manual `LIMITE_ATOMICO=off`, y abre
porque es una decisión humana explícita, no un fallo.

Estados posibles, visibles en la cabecera `X-Limitador`:

| Estado | Código | Significado |
|---|---|---|
| `ok` | 200/502 | contó y admitió |
| `limite` | 429 | cuota agotada — funcionamiento normal |
| `sin-identidad` | 503 | sin sal válida, sin `CF-Connecting-IP`, o IP imposible |
| `sin-binding` | 503 | el binding del Durable Object no existe |
| `respuesta-invalida` | 503 | el objeto contestó algo con forma inesperada |
| `saturado` / `error` | 503 | excepción o presupuesto de tiempo agotado |
| `turnstile-precheck` | 403 | el token no puede ser válido; no se gasta red |
| `turnstile-rechazado` | 403 | siteverify dijo que no (inválido, caducado o repetido) |
| `turnstile-hostname` / `turnstile-accion` | 403 | el token es de otro sitio o de otro flujo |
| `turnstile-sin-secreto` | 503 | falta `TURNSTILE_SECRET` |
| `turnstile-claves-de-prueba` | 503 | clave de prueba fuera de desarrollo |
| `turnstile-http-<estado>` | 503 | siteverify contestó algo que no es 200; con secreto inválido devuelve **400** |
| `turnstile-inalcanzable` | 503 | no contestó: red, tiempo agotado o cuerpo ilegible |
| `apagado` | 200/502 | interruptor manual |

La cabecera no es adorno: sin ella, un limitador vivo y uno apagado producen la
misma salida observable y no hay forma de saber cuál corre en producción.

### Por qué SAL_LIMITE es obligatoria

El nombre del Durable Object se deriva de la IP. Sin sal, ese nombre sería una
codificación pública y reversible por cualquiera, y llamarlo seudónimo sería
mentira. Con sal secreta, quien no la tenga no puede revertirlo.

Requisitos: **mínimo 43 caracteres** (32 bytes en base64 sin relleno, o sea que
por debajo es imposible que haya 256 bits) y **al menos 16 símbolos distintos**,
para descartar rellenos tipo `aaaa…`. Eso descarta el descuido, no al adversario:
la entropía real no se puede medir desde el runtime.

Se usa **HMAC-SHA256 con la sal como clave**, no un hash de sal+IP concatenados:
en un HMAC la clave entra por un camino distinto al mensaje.

**Seudonimización no es anonimización.** Sólo hay 2³² direcciones IPv4: quien
tenga la sal las recorre todas en segundos. Lo que sí se garantiza es que la IP
en claro no sale del Worker: no viaja al objeto, no está en su nombre, no se
escribe en ninguna tabla.

### Por qué IPv6 se trunca a /64

A un cliente IPv6 se le suele asignar un `/64` entero. Limitar por dirección
completa regalaría cuota infinita a cualquiera con IPv6, y además crearía un
Durable Object por dirección. Se trunca a `/64`, que es lo que hace el propio
Cloudflare en sus reglas de rate limiting.

Consecuencia conocida y aceptada: quien tenga un `/48` dispone de 65 536 bloques
`/64`. Bajar el truncado a `/48` castigaría a operadores legítimos.

### CGNAT e IP compartidas

Una IP pública compartida implica **cuota compartida**: una oficina o un CGNAT
entero comparten 20/min. Es el precio de limitar por IP y no se arregla
debilitando el límite. Antes esto no ataba porque el WAF cuenta por centro de
datos; ahora sí.

## Qué guarda cada objeto

| Qué | Cuánto | Cuánto tiempo | Quién lo borra |
|---|---|---|---|
| Marcas de tiempo (enteros) | ≤ 20 por identidad | 60 s | Purga en cada petición + alarma |
| Nombre del objeto (seudónimo) | 16 bytes | Hasta la limpieza | `deleteAll()` desde la alarma |

No se guarda la IP. No se registran IPs ni seudónimos en logs.

La alarma se programa a ventana + 30 s de margen: si saltara justo al cumplirse
la ventana encontraría la última marca viva y tendría que reprogramarse en
bucle. Si al despertar quedan marcas vivas, se vuelve a dormir en vez de borrar
datos vivos.

Un fichero SQLite de un Durable Object ocupa entre 8 y 16 KB medidos, así que
sin limpieza el almacenamiento crecería con el número de identidades distintas
sin bajar nunca.

## Presupuesto de tiempo

`PRESUPUESTO_DO_MS = 1500`.

Superarlo **no abre**: falla cerrado. Así que quedarse corto no es un agujero,
es indisponibilidad — y por eso el valor se elige por arriba.

Medido en local (`test/medir.mjs`):

| Escenario | p50 | p95 | p99 |
|---|---|---|---|
| Limitador, objeto caliente | 5 ms | 7 ms | 7 ms |
| Limitador, objeto recién creado | 26 ms | 28 ms | 30 ms |
| Worker, caché MISS | 31 ms | 132 ms | 132 ms |
| Worker, caché HIT | 31 ms | 39 ms | 39 ms |
| Worker, petición ya limitada | 11 ms | 12 ms | 16 ms |
| 100 simultáneas, misma identidad | 112 ms | 1107 ms | 1108 ms |

El caso caro no es el arranque en frío: es la cola. Con el presupuesto en
800 ms —el valor inicial— las peticiones excedidas devolvían 503 en vez del 429
que les corresponde. **Estos números no incluyen la red**: en producción hay que
sumar el viaje al centro de datos donde viva el objeto.

## Cómo se prueba

```bash
cd "Kimi_Agent_Web 3D Optimizada/cloudflare"
node --test --test-concurrency=1 "test/*.test.mjs"
```

**`--test-concurrency=1` no es opcional.** Sin ella, Node ejecuta los ficheros en
paralelo y cada suite levanta su propio `wrangler dev`; con cuatro o cinco a la
vez la máquina se satura y pruebas de 3 segundos tardan 60, hasta fallar por
tiempo. En serie tarda unos 4 minutos y sale estable.

Cero dependencias: `node:test` viene con Node.

| Suite | Qué cubre |
|---|---|
| `concurrencia.test.mjs` | volumen, ventana, aislamiento, caché, métodos |
| `fallo-cerrado.test.mjs` | que ninguna rama de error ejecuta el análisis |
| `mutacion.test.mjs` | que la suite **detecta** una sección crítica rota |
| `ssrf.test.mjs` | el filtro de destinos, con regresiones reales |

### Lo más importante de todo esto

**Entrando por TCP contra `wrangler dev`, workerd atiende las peticiones de una
en una.** Medido: 40 lanzadas a la vez, máximo 1 en vuelo. Por ese camino el
contador viejo —el que en producción dejaba pasar 39 de 40— sacaba un 20/40
impecable.

De ahí dos cosas que no se deben quitar:

1. Las ráfagas van por `/__rafaga`, que las abanica desde dentro del isolate.
2. El primer test comprueba que **hubo solape de verdad**. Si eso se cae, ningún
   otro verde de la suite significa nada.

Y de ahí `mutacion.test.mjs`: rompe el limitador a propósito en una copia
temporal y comprueba que la suite lo ve. Con la sección crítica rota, 100
simultáneas permiten 100. Un test de concurrencia sin prueba negativa no
demuestra que el código sea correcto, sólo que el arnés no encontró nada.

Dato medido que conviene conocer: **con la sección crítica rota, el test de 40
simultáneas PASA y el de 100 FALLA.** Con 40 el entrelazado depende de cómo
caiga el planificador. Si algún día hay que quitar un test por tiempo, se quita
el de 40, nunca el de 100.

## Riesgos residuales aceptados

Dos cosas que **no** están resueltas y se asumen a propósito. Se documentan aquí
para que dentro de un año nadie las descubra creyendo que son un descuido.

### 1. Un tiempo agotado consume cuota, y no se devuelve

Si la consulta al Durable Object supera el presupuesto, el Worker responde 503
sin analizar nada — pero el objeto **ya ha contado esa petición**. La plaza está
gastada. `Promise.race` no cancela la llamada que ya salió.

Se decidió **no** implementar un protocolo de devolución (un token que anule la
marca). Razones, en orden:

- menos condiciones de carrera: devolver cuota es un segundo camino de escritura
  sobre el mismo contador, y cada camino nuevo es una carrera nueva;
- menos superficie: un método `anula()` es una operación pública más que hay que
  proteger;
- impide un abuso concreto: si el fallo del análisis devolviera la cuota,
  provocar errores a propósito saldría gratis y se podría reintentar sin límite.

Consecuencia que hay que aceptar: si el limitador se degrada, un visitante puede
gastar sus 20 plazas en 503 y quedarse después con 429 sin haber recibido un solo
informe. Es indisponibilidad temporal, no un agujero.

### 2. El sitio analizado ve la IP del visitante

Cloudflare añade por su cuenta la IP real de quien pidió el diagnóstico a toda
subpetición dirigida a un sitio que no es cliente suyo. Va en dos cabeceras,
`CF-Connecting-IP` y `x-real-ip`, y la documentación es explícita: sólo la
segunda se puede alterar.

- `x-real-ip`: **mitigado**. Se fija a `0.0.0.0` en la subpetición, que es la vía
  soportada (el valor debe ser una IP sintácticamente válida).
- `CF-Connecting-IP`: **sin mitigación**. No se puede quitar ni vaciar desde el
  Worker. El Managed Transform «Remove visitor IP headers» no sirve: aplica al
  tráfico *entrante* hacia el origen, no al egress de un Worker.
- `CF-Worker`: además se envía el nombre de nuestra zona, así que el sitio
  analizado también sabe quién lo analizó.

Referencia: la sección «CF-Connecting-IP in Worker subrequests» de la página de
cabeceras HTTP de Cloudflare.

**HECHO (agosto de 2026):** el aviso de privacidad ya lo recoge, en la sección
«Cuando usas el diagnóstico gratuito», con estas palabras: el servidor del sitio
analizado recibe la dirección IP desde la que se pidió el análisis, es inherente
al funcionamiento de una petición y no se puede evitar.

Redacción original del pendiente, que se conserva por trazabilidad:
**Esto tiene que reflejarse en el aviso de privacidad del sitio**: quien usa el
diagnóstico debe saber que su dirección IP llega al sitio que pide analizar. Es
una acción de negocio, fuera de este repositorio.

## Rollback

| Nivel | Qué hacer | Alcance |
|---|---|---|
| 1 | `LIMITE_ATOMICO = "off"` en `wrangler.toml` + deploy | El Worker deja de consultar el objeto y vuelve a las capas anteriores |
| 2 | `git checkout` de `cloudflare/` + deploy | Vuelve el Worker anterior |
| 3 | Migración `deleted_classes` | Elimina la clase del Durable Object |

Aviso: `wrangler deploy --var` **no persiste**. Para que el interruptor
sobreviva al siguiente despliegue rutinario hay que cambiarlo en el archivo.

Lo que **no** es trivialmente reversible: el `tag` de la migración no se reutiliza
una vez desplegado, y los datos de los objetos ya creados no vuelven.
