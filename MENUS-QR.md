# Menús QR permanentes

El QR y el NFC guardan una URL corta de este dominio, no la dirección final del
menú. Cloudflare Pages resuelve esa URL con `app/_redirects`; por eso el destino
puede cambiar sin reimprimir ni reprogramar nada.

## Activar un restaurante

1. Edita `datos/menus.json` y copia una entrada existente.
2. Usa un `id` único (`MENU-002`) y un `codigo` único en minúsculas (`m002`).
3. Pon en `destino` una ruta de este sitio, por ejemplo `/menu/demo`.
4. Deja `activo` en `true` y ejecuta `node tools/menus.mjs`.
5. Ejecuta `node tools/menus.mjs --check` antes de publicar.
6. Haz commit y push. El cambio sólo llega a producción cuando termina el
   deployment correspondiente de Cloudflare Pages.

Para un menú alojado fuera del dominio, agrega primero su origen HTTPS exacto a
`origenesExternosPermitidos`. Ejemplo: `https://menu.restaurante.com`. Después
usa la URL completa en `destino`. El generador rechaza HTTP, credenciales, URLs
mal formadas y cualquier origen externo que no esté en esa lista.

## Cambiar un destino

Cambia sólo `destino` en `datos/menus.json`, vuelve a ejecutar
`node tools/menus.mjs`, haz commit, push y espera a que termine el nuevo
deployment de Cloudflare Pages. Editar el JSON local no cambia producción por
sí solo. No cambies `codigo`: es la parte permanente impresa en el QR y grabada
en el NFC.

Para pausar una ficha, cambia `activo` a `false`. Su URL mostrará “Menú
pendiente de activación”. Los códigos que no existen muestran la misma página.

## MENU-001

- Identificador interno: `MENU-001`
- URL permanente: `https://sycsolutions.company/q/m001`
- Destino actual: `/menu/demo`
- SVG listo para imprimir: `Kimi_Agent_Web 3D Optimizada/app/qrs/menu-001.svg`

El SVG tiene módulos negros sobre fondo blanco y zona silenciosa de cuatro
módulos. Antes de una tirada grande, imprime una muestra al tamaño final y
pruébala con varios teléfonos. No recortes el borde blanco ni deformes el SVG.

## Respaldo

El respaldo es el propio repositorio: conserva `datos/menus.json`, `_redirects`
y `app/qrs/`. Antes de cambiar destinos, crea una rama o descarga una copia del
JSON. Para restaurar, recupera esos archivos y vuelve a publicar la versión.

No se usa KV ni otro Worker: así no hay base de datos, credenciales ni costo de
operación adicional. El intercambio es que un cambio de destino requiere una
nueva publicación de Cloudflare Pages.

Cloudflare Pages admite como máximo 2,000 redirecciones estáticas y 100
dinámicas en `_redirects`: 2,100 reglas combinadas. Este sistema usa una regla
estática por menú activo y una regla dinámica final para los códigos pendientes.
Antes de acercarse al límite habrá que migrar las rutas a Bulk Redirects, KV u
otra solución diseñada para un catálogo mayor.
