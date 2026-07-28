# Web S&C Solutions Company — Documento de entrega

Contexto completo del proyecto para continuar el desarrollo (por ejemplo, en Claude).
Incluye: qué es, cómo está construida, decisiones de diseño, reglas de rendimiento
y pendientes.

---

## 1. Qué es esto

Sitio web **one-page** de **S&C Solutions Company**, agencia que vende:

- Sitios web premium
- Automatización con IA
- CRM a medida
- Otros (proyectos a medida / consultoría)

**Eslogan de marca:** Ambición · Estrategia · Resultados
**Tono:** Wolf of Wall Street elegante — seguro, provocador, serio, premium.

## 2. Contenido del paquete

```
web-sc-solutions.zip
├── index.html          (TODO el sitio: HTML + CSS + JS en un solo archivo)
└── assets/
    ├── logo.svg            (logo oficial S&C, art-deco)
    ├── hero-bg.webp        (hero: skyline nocturno 4K)
    ├── bg-servicios.webp   (fondo servicios: circuito macro 4K)
    ├── bg-proyectos.webp   (fondo proyectos: planos/drafting 4K)
    ├── bg-contacto.webp    (fondo contacto: escritorio cálido 4K)
    └── hero-og.jpg         (solo para Open Graph / redes sociales)
```

**Para verla:** descomprime y abre `index.html` en el navegador. No requiere
servidor, build, ni dependencias. El JS es 100% vanilla (sin librerías).

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
6. **Servicios (01)** — grid 2×2, fondo circuito, cada tarjeta con botón
   "Solicitar" que lleva al formulario y **pre-selecciona el servicio**
   en el `<select>` (data-service → options)
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
- Pre-selección del servicio desde botones "Solicitar"

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
- Open Graph + Twitter Cards (con hero-og.jpg)
- JSON-LD Schema.org `Organization` con los 4 servicios en `makesOffer`
- HTML semántico, un solo h1, alt/aria en imágenes

## 8. PENDIENTES (datos a reemplazar)

- **Email:** `hola@sycsolutions.company` (placeholder) → el real
- **WhatsApp:** `+52 000 000 0000` → el real
- **Proyectos y reseñas:** son de ejemplo → casos reales con sus resultados
- **Formulario:** actualmente solo muestra confirmación visual
  (preventDefault). Para producción conectar a: endpoint propio,
  Formspree, EmailJS, o webhook (n8n/Zapier) según el stack que elijan
- **Canonical/OG URL:** `https://sycsolutions.company/` → dominio final

## 9. Prompt maestro original (por si quieres regenerar o crear variaciones)

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
