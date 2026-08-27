# Worker de cobros — Checkout Pro

Cobra la placa de reseñas **en una sola exhibición**, que es lo único que los
enlaces de pago del panel de Mercado Pago no permiten.

## Por qué existe

Los enlaces creados desde la app tienen las mensualidades **bloqueadas**: el
botón «Modificar» de esa fila sale en gris una vez creado el enlace, la casilla
de tarjetas no separa crédito de débito, y la fila «Mercado Pago — Dinero
disponible y Cuotas sin Tarjeta» no se puede desmarcar. Comprobado en pantalla,
no deducido.

Por API sí se puede, con un campo:

```js
payment_methods: { installments: 1 }   // installments = máximo de cuotas
```

Y como el campo va por paquete, se puede afinar: los dos más caros ofrecen
**dos** mensualidades. Ver «Quién paga el interés» más abajo, que es donde está
el dinero.

Y de paso desaparece el trabajo manual: **ya no hay que crear un enlace por
paquete**. El cobro se genera al vuelo para los once desde la misma tabla que
pinta la web.

## Lo que hay que hacer para encenderlo

### 1 · El token de Mercado Pago

En el panel de desarrolladores de Mercado Pago, crear una aplicación y copiar
su **Access token de producción**. Después, desde este directorio:

```sh
npx wrangler secret put MP_ACCESS_TOKEN
```

El comando lo pide por teclado. **El valor no se escribe en ningún archivo de
este repositorio, no entra en el historial de git y no se pega en un chat.**
Si alguna vez se expone, se rota en el panel de Mercado Pago y se vuelve a
poner con el mismo comando.

### 2 · Desplegar

```sh
npx wrangler deploy
```

### 3 · El dominio

En el panel de Cloudflare: **Workers & Pages → syc-pagos → Settings → Domains &
Routes → Custom domain**, y dar de alta `pagos.sycsolutions.company`. Es el
mismo paso que se hizo con `audit.sycsolutions.company`.

El dominio importa: `workers_dev = false` a propósito, para que el Worker no
quede además publicado en una dirección `workers.dev` que nadie vigila y por la
que se podrían crear cobros saltándose el sitio propio.

### 4 · Comprobar el despliegue sin cobrar nada

```sh
curl -sS https://pagos.sycsolutions.company/estado
```

Debe responder `{"ok":true,"secreto":true,"paquetes":11}`. `secreto` dice si el
token **existe**, nunca cuál es. Si sale `false`, falta el paso 1.

### 5 · Encender los botones en la web

En `tools/precios.mjs`, poner la dirección del Worker:

```js
const COBRO_EN_LINEA = 'https://pagos.sycsolutions.company/ir';
```

y ejecutar `node tools/precios.mjs`. Los once paquetes pasan a botón de pago de
golpe. Con la constante vacía no se pinta ningún botón: **la web nunca enseña un
botón de cobro que no cobre**.

### 6 · Lo que hay que MIRAR, no suponer

Abrir un cobro real y comprobar en la pantalla de Mercado Pago que **no aparece
ninguna opción de mensualidades**. `installments: 1` debería limitar también las
«Cuotas sin Tarjeta» —el crédito propio de Mercado Pago—, pero eso no está
verificado. Si siguieran saliendo, se excluye ese tipo de pago en
`creaPreferencia` y se vuelve a mirar.

## Quién paga el interés

Es la decisión con dinero dentro de este directorio, y no se ve en el código si
uno no sabe qué mirar. En México:

| Cuotas | Quién financia | Qué te cuesta |
|---|---|---|
| **1** | nadie | nada |
| **2** | el banco **del comprador** | **nada** — cobras el total íntegro |
| **3 o más** | **tú** | 4.69 % a tres meses, hasta 27.29 % a veinticuatro |

De tres en adelante ya es el catálogo de *meses sin intereses*, y ahí el
descuento sale del vendedor. Por eso `TOPE_CUOTAS = 2` en `pagos.js` recorta
cualquier valor de la tabla: poner un `3` de más en una fila de precios no
puede convertirse en una comisión permanente que nadie note.

Subir ese tope es una decisión comercial. Se toma en `pagos.js`, a la vista, no
de refilón editando `tools/precios.mjs`.

## La regla que no se puede romper

**El importe lo pone el Worker, nunca el navegador.** El formulario de la web
manda únicamente `paquete=1`; el precio sale de `paquetes.json`. Si el importe
viajara en el formulario, cualquiera lo editaría y pagaría un peso por veinte
placas.

Hay una prueba dedicada a esto que manda `total=1`, `unit_price=1`, `precio=1` y
`monto=1` junto al paquete de 20 y exige que el cobro salga por $3,399.

## paquetes.json se genera, no se edita

Lo escribe `tools/precios.mjs`, que es la misma fuente de la que sale la lista
de precios del HTML. Dos tablas mantenidas por separado divergen, y el día que
diverjan la web diría un precio y el cobro sería otro. `precios.mjs --check`
compara las dos y falla si no coinciden; corre en el hook y en el CI.

## Pruebas

```sh
node --test test/pagos.test.mjs
```

Dieciocho pruebas, sin red y sin `wrangler`: se sustituye `fetch` por un doble
que captura lo que se le habría mandado a Mercado Pago. Cubren el importe del
servidor, las cuotas de cada paquete contra la tabla, el recorte a dos, la
caída a pago único con la columna rota o ausente, `default_installments` en 1,
los once importes contra la tabla, paquete inexistente, falta de secreto,
origen ajeno, método incorrecto, `/estado` sin filtrar el token, el fallo de
Mercado Pago terminando en WhatsApp y no en un error, la redirección 303 y el
tope por IP.

Las cuatro de cuotas están comprobadas por sabotaje: con el tope en 24, con
`installments` fijo a 1 y con `default_installments` siguiendo a la tabla, cada
sabotaje pone en rojo justo la prueba que le toca.

## Lo que este Worker NO hace

- **No recibe ni un dato de tarjeta.** Eso ocurre entero en el sitio de Mercado
  Pago. Aquí sólo se crea la preferencia y se redirige.
- **No guarda nada.** Ni base de datos, ni KV, ni Durable Object. Lo único que
  escribe es un contador por IP en la Cache API que caduca en un minuto.
- **No recibe webhooks todavía.** Los avisos de cobro llegan por la app y el
  correo de Mercado Pago, que es lo que hacía falta. Si algún día se quiere el
  aviso hacia otro sistema, se añade una ruta `/webhook` **validando la firma**
  `x-signature`: sin esa validación, cualquiera podría anunciar cobros falsos.
