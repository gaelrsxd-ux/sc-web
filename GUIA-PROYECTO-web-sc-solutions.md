# Web S&C Solutions Company — Documento de entrega

Contexto completo del proyecto para continuar el desarrollo (por ejemplo, en Claude).
Incluye: qué es, cómo está construida, decisiones de diseño, reglas de rendimiento
y pendientes.

---

## 1. Qué es esto

Sitio web **one-page** de **S&C Solutions Company**, agencia que vende:

- Sitios Web Premium para tu Negocio
- Agentes de IA para tu Negocio
- Automatización de Procesos en tu Negocio

Son **tres y sólo tres**, y estos nombres son literales: el desplegable
«¿Qué necesitas?» del formulario manda el valor tal cual al sistema, que lo
compara contra su catálogo.

Dos categorías se retiraron por el camino, y conviene saberlo antes de
«recuperarlas»: el CRM dejó de serlo en agosto de 2026, y **Aplicación Privada
para tu Negocio** en agosto de 2026 también, por decisión comercial. La ficha,
su oferta en el JSON-LD, su opción del desplegable y sus menciones en los
metadatos salieron con ella. Con tres fichas en dos columnas la última ocupa la
fila entera (`.svc:last-child`), que es lo que evita la media fila vacía.

**Eslogan de marca:** Ambición · Estrategia · Resultados
**Tono:** Wolf of Wall Street elegante — seguro, provocador, serio, premium.

## 2. Contenido del paquete

```
app/
├── index.html          (la portada entera: HTML + CSS + JS en un solo archivo)
├── pedido.html         (los pasos de la compra: cantidad, negocio, envío)
├── gracias.html        (la vuelta desde Mercado Pago, con el WhatsApp escrito)
├── terminos.html  ·  aviso-de-privacidad.html  ·  cookies.html  ·  404.html
├── _headers            (CSP con huellas SHA-256 — se GENERA, ver §Herramientas)
├── sw.js               (service worker; hoy desactivado a propósito)
└── assets/
    ├── logo.svg            (logo oficial S&C, art-deco)
    ├── legal.css           (hoja de las páginas legales y del pedido)
    ├── pedido.css          (lo que el pedido añade sobre legal.css)
    ├── hero-bg.webp        (hero: skyline nocturno 4K)
    ├── bg-servicios.webp · bg-proyectos.webp · bg-contacto.webp
    ├── producto-resenas-*.webp   (la placa: frontal, perfil y trasera)
    └── og-placa.jpg        (solo para Open Graph / redes sociales)
```

Fuera de `app/` viven las cosas que no se publican:

```
tools/precios.mjs       ← LA TABLA DE PRECIOS. Única fuente: reescribe la ficha
                          de producto, pedido.html, las cuatro páginas de cobro
                          de los servicios (servicio.html, web.html, ia.html,
                          automatizacion.html), los precios de la portada y la
                          tabla del Worker. Y revienta si terminos.html no dice
                          cada precio.
tools/assets.mjs        ← pone la huella del contenido en el enlace de cada
                          hoja de estilo y script propio, para que no se sirva
                          una versión vieja
tools/csp-hashes.mjs    ← recalcula las huellas de la CSP tras tocar un script
tools/cp.mjs            ← convierte el catálogo de SEPOMEX en las colonias por
                          código postal y la lista de ciudades del formulario
cloudflare/pagos/       ← el Worker que cobra (Checkout Pro de Mercado Pago)
pruebas/compra.mjs      ← la compra de la placa, de punta a punta, en un navegador
pruebas/servicio.mjs    ← el cobro del perfil de Google (con placas dentro)
pruebas/paquetes.mjs    ← el cobro del sitio web, el agente de IA y la automatización
pruebas/instalaciones.mjs ← las fotos de clientes y el visor
servidor.js             ← servidor local para verla con sus cabeceras
```

**Para verla:** `node servidor.js` y abrir la dirección que imprime. No hay
build ni `package.json`: el JS es vanilla y no hay dependencias. Hace falta un
servidor y no abrir el archivo a pelo porque la CSP viaja en cabeceras.

⚠ **Los precios no se editan a mano en ningún HTML.** Se cambian en la tabla de
`tools/precios.mjs` y se ejecuta `node tools/precios.mjs`. Un `--check` en el
hook de commit y en el CI falla si alguien lo hace al revés: sin él, la web
puede enseñar un precio y el cobro salir por otro.

## 3. Sistema de diseño

| Token | Valor | Uso |
|---|---|---|
| `--bg` | `#0A0B0E` | fondo principal (negro tinta) |
| `--bg2` | `#111318` | secciones alternadas |
| `--panel` | `#13161C` | tarjetas |
| `--ink` | `#F4F1EA` | texto principal (marfil) |
| `--muted` | `#9A958A` | texto secundario |
| `--bronze` | `#C8A96A` | acento: líneas, números, hovers |
| `--bronze-hi` | `#E4CD9A` | acento claro (itálicas) |
| `--line` | `rgba(200,169,106,.22)` | hairlines |

- **Tipografía:** Cormorant Garamond (titulares, itálicas de acento) + Inter
  (etiquetas en mayúsculas con letter-spacing amplio). Google Fonts con
  `display=swap`.
- **Motivos:** diamantes ◆ (rombos CSS rotados), líneas hairline, números
  fantasma en contorno (`-webkit-text-stroke`), secciones numeradas 01–04,
  watermarks tipográficos gigantes ("&" en manifiesto, comilla en reseñas),
  rayos art-deco (conic-gradient) en reseñas — el logo es art-deco.

## 4. Estructura de secciones (en orden)

1. **Preloader** — logo + línea de carga bronce + eslogan
2. **Navbar fija** — logo, links, botón "Hablemos"
3. **Hero** — foto 4K con overlay, titular centrado en 2 líneas:
   "Tu competencia / *ya nos llamó.*", subtítulo, 2 CTAs, parallax sutil
4. **Manifiesto** — "Mientras tú lees esto, alguien está cerrando tus
   clientes. *Nosotros construimos el sistema para que sea al revés.*"
   con "&" gigante en contorno
5. **Bait** — "…pero si tuviéramos que elegir uno, sería este." + botón
   "◆ Nuestro mejor proyecto ◆" con anillos pulsantes → lleva a #contacto
6. **Servicios (01)** — grid 2×2, fondo circuito, cada tarjeta con su precio
   (lo escribe tools/precios.mjs) y un botón que lleva a su página de cobro:
   servicio.html, web.html, ia.html, automatizacion.html
7. **Cifras** — 4 contadores animados (40+, 98%, 1200+, 24/7)
8. **Proyectos (02)** — 4 casos con número fantasma, categoría, resultado
9. **Reseñas (03)** — carrusel de 3 testimonios + rayos art-deco + comilla
   gigante en contorno
10. **Contacto (04)** — datos + formulario (nombre, email, select servicio,
    mensaje). Fondo escritorio, formulario casi sólido para legibilidad
11. **Footer** — marca tipográfica, eslogan, links

## 5. Efectos implementados (mantenerlos)

- Zoom de entrada por sección (scale .8→1 + fade, clase `.zoomsec`/`.zin`,
  IntersectionObserver, se ejecuta una sola vez)
- Titulares revelados palabra por palabra (`data-split`, spans `.w`)
- Fade-up genérico (`.rv` + `.in`)
- Parallax sutil del hero (scroll + rAF, solo transform, pausado fuera de vista)
- Contadores con easeOut cúbico
- Anillos pulsantes en botones (keyframes `ringp`/`ringp-s`, solo
  transform/opacity)
- Carrusel de reseñas con autoplay

## 6. Reglas de rendimiento (INNEGOCIABLES — ya optimizada)

- **PROHIBIDO:** WebGL/Three.js, backdrop-filter, blur >20px en elementos
  grandes, mix-blend-mode en capas full-screen, scroll horizontal con pin,
  listeners de mousemove con repintado, videos de fondo
- Solo animar `transform` y `opacity` (composición GPU)
- `content-visibility: auto` en secciones (render bajo demanda)
- `will-change` se libera tras la transición del zoom
- Respetar `prefers-reduced-motion`
- Imágenes WebP, hero con `preload` + `fetchpriority="high"`
- Cero dependencias JS externas

## 7. SEO (ya incluido)

- Title, meta description, keywords, canonical, robots
- Open Graph + Twitter Cards (con og-placa.jpg)
- JSON-LD Schema.org `Organization` con los 3 servicios en `makesOffer`
- HTML semántico, un solo h1, alt/aria en imágenes

## 8. PENDIENTES (datos a reemplazar)

- **Email:** `hola@sycsolutions.company` (placeholder) → el real
- **WhatsApp:** `+52 000 000 0000` → el real
- **Proyectos y reseñas:** son de ejemplo → casos reales con sus resultados
- **Formulario:** actualmente solo muestra confirmación visual
  (preventDefault). Para producción conectar a: endpoint propio,
  Formspree, EmailJS, o webhook (n8n/Zapier) según el stack que elijan
- **Canonical/OG URL:** `https://sycsolutions.company/` → dominio final

## 8 bis. Añadido en julio de 2026

Archivos nuevos fuera de `app/index.html`:

```
app/robots.txt          app/sitemap.xml
cloudflare/seo-audit.js cloudflare/wrangler.toml cloudflare/README.md
```

Secciones nuevas y renumeración: **01 Sobre nosotros** (entre el hero y el
manifiesto) y **03 Diagnóstico** (tras servicios). Servicios pasó de 01 a 02,
proyectos de 02 a 04, reseñas de 03 a 05 y contacto de 04 a 06.

> Registro de julio; se deja fechado. «Sobre nosotros» y el manifiesto ya no
> existen: ver «Sobre nosotros y los certificados: RETIRADOS» más abajo para la
> numeración vigente.

- **Diagnóstico** audita la web que le indiquen. El análisis lo hace el Worker
  de `cloudflare/`; ver su README. El único valor a tocar es `SYC_AUDITOR`.
- **Música ambiente**: sintetizada con Web Audio, sin archivos. Cuatro voces de
  dos osciladores desafinados, cada una con su vaivén a una velocidad distinta
  y prima con las demás: como nunca vuelven a coincidir, no hay punto de
  repetición. El acorde se desliza al siguiente cada 26 s. Arranca **encendida**
  y solo calla si se apagó en una visita anterior (`localStorage`).
  Ningún navegador permite sonar antes de que el visitante interactúe —política
  de autoplay, no se puede rodear—, así que el grafo se monta a volumen cero y
  sube en el primer gesto (rueda, scroll, tecla o toque).
- **Índice del recorrido**: el riel izquierdo numera los seis tramos, enciende
  el actual y deja encendidos los ya vistos. Es `<nav>`, por eso el bloque de
  la barra superior usa `nav:not(.rail)`: sin ese `:not` le caía encima la
  altura de 82 px y el índice se salía por arriba.
- **Casos con resultado tapado**: la cifra está en el HTML desde el principio
  —solo desenfocada por CSS—, así que Google la indexa igual.

### Sobre nosotros y los certificados: RETIRADOS (agosto de 2026)

La sección **04 Sobre nosotros** —«¿Quién construye tu proyecto?», con las dos
fichas de los cofundadores y la antesala de cuatro certificados— se retiró
entera por decisión de producto: la página contaba quiénes somos antes de que
nadie lo preguntara, y entre los casos y el diagnóstico metía dos pantallas de
scroll que no ayudaban a decidir.

Con ella salieron las fichas `.member`, la baraja `.team`, el bloque `.creds`,
los cuatro sellos `.cred` con su visor, los dos nodos `Person` del JSON-LD con
sus `hasCredential`, el tramo del riel, las cuatro imágenes de
`app/assets/certs/` y el manejador de JS del visor de credenciales.

**El recorrido quedó en cinco tramos:** 01 Servicios, 02 Productos, 03
Proyectos, 04 Diagnóstico, 05 Contacto. Si algún día vuelve, hay que renumerar
otra vez los rótulos visibles, el riel (`.idxr`) y la lista de tramos del JS.

Los nombres de los dos cofundadores siguen publicados, pero en otro sitio y por
otro motivo: son los responsables del tratamiento de datos en el aviso de
privacidad y en los términos. Eso no depende de esta sección.

### Servicios + Productos + casos: FUSIONADOS en Soluciones (agosto de 2026)

Las secciones **01 Servicios** y **02 Productos** —y la `.cat-barra` fija que
flotaba sobre las dos para decir en cuál estabas— son ahora una sola:
**01 Soluciones**, con un conmutador de tres pestañas dentro.

El motivo es medido, no de gusto. En un móvil de 390 px las dos secciones
sumaban **3.266 px, casi cuatro pantallas**, para contar tres cosas. La página
entera eran 8.683 px. Hoy Soluciones mide **762 px** y la página **6.183 px**:
un 29 % menos de portada.

| | Antes | Ahora |
|---|---|---|
| Servicios (móvil 390) | 738 px | panel de 762 px |
| Productos (móvil 390) | 2.528 px | panel de 1.397 px |
| Casos | dentro de Productos | panel de 880 px |
| Página entera (móvil) | 8.683 px · 10,3 pantallas | 6.183 px · 7,3 pantallas |

Qué cambió y qué NO:

- **Los ids `servicios` y `productos` siguen existiendo**, ahora en los paneles.
  No son decorativos: nueve enlaces de la propia página apuntan a ellos y
  `#productos` está dentro del JSON-LD de la cabecera. El script abre la pestaña
  que toque al llegar por uno de ellos.
- **El recorrido pasó de cinco tramos a cuatro**: 01 Soluciones, 02 Proyectos,
  03 Diagnóstico, 04 Contacto.
- **El contador de cantidad se fue de la portada.** Vivía en la ficha con las 25
  cantidades y su tabla JSON, y duplicaba lo que `pedido.html` ya hacía: un
  `<select>` de 25 opciones y el WhatsApp de «más de 25». No se perdió ninguna
  ruta. En la portada queda el precio de entrada y el botón.
- **`tools/precios.mjs` sigue mandando sobre el precio de la portada.** Genera
  ahora una ficha corta en vez del contador, y `--check` sigue fallando si
  alguien escribe una cifra a mano. Con el contador se fueron `listaTramos()`,
  `mensaje()`, `mensajeMas()`, `url()`, `WHATSAPP`, `PAQUETE_DESDE` y `cifra()`
  —esta última ya estaba muerta antes—.
- **Sin JavaScript los tres paneles se ven**, uno debajo de otro. El `hidden` lo
  pone el script, no el marcado: así un script caído no esconde dos tercios del
  catálogo y un buscador encuentra el contenido entero.
- **Los cuatro «Solicitar» ya no existen**: cada tarjeta lleva precio y un
  botón a su página de cobro. El WhatsApp sigue en «Hablemos», para lo que no
  quepa en un paquete.
- Lo que sí se acortó es el **copy** de cada servicio: de dos frases a una. Es
  la única pérdida de contenido del cambio y está anotada como riesgo de SEO.

## 9. Prompt maestro original (por si quieres regenerar o crear variaciones)

> Se conserva **tal cual se escribió**, como registro histórico. Ojo al leerlo:
> menciona el CRM, que ya no es una de las categorías (ver sección 1).

Crear sitio one-page en español para agencia de webs/IA/CRM. Estilo: lujo
editorial sobrio tipo firma boutique (SERIO, ELEGANTE, CARO). Paleta: negro
tinta #0A0B0E, marfil #F4F1EA, acento único bronce champán #C8A96A usado con
moderación. Tipografía: Cormorant Garamond para titulares enormes con
itálicas de acento + Inter para etiquetas. Mucho aire, hairlines, secciones
numeradas, watermarks tipográficos gigantes. Fotos 4K oscuras con overlay
90%+: skyline nocturno (hero), circuito (servicios), planos (proyectos),
escritorio (contacto) — narrativa: ambición → tecnología → ejecución →
conversación. Efectos: zoom por sección, revelado palabra por palabra,
parallax sutil, contadores, anillos pulsantes en CTAs. Reglas: nada de
WebGL/backdrop-filter/blur pesado, solo transform/opacity, content-visibility,
prefers-reduced-motion, un solo HTML sin dependencias, SEO completo con
JSON-LD. Tono de copy: provocador premium ("Tu competencia ya nos llamó").
