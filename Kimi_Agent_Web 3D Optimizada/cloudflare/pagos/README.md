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

Trece pruebas, sin red y sin `wrangler`: se sustituye `fetch` por un doble que
captura lo que se le habría mandado a Mercado Pago. Cubren el importe del
servidor, `installments: 1`, los once importes contra la tabla, paquete
inexistente, falta de secreto, origen ajeno, método incorrecto, `/estado` sin
filtrar el token, el fallo de Mercado Pago terminando en WhatsApp y no en un
error, la redirección 303 y el tope por IP.

## Lo que este Worker NO hace

- **No recibe ni un dato de tarjeta.** Eso ocurre entero en el sitio de Mercado
  Pago. Aquí sólo se crea la preferencia y se redirige.
- **No guarda nada.** Ni base de datos, ni KV, ni Durable Object. Lo único que
  escribe es un contador por IP en la Cache API que caduca en un minuto.
- **No recibe webhooks todavía.** Los avisos de cobro llegan por la app y el
  correo de Mercado Pago, que es lo que hacía falta. Si algún día se quiere el
  aviso hacia otro sistema, se añade una ruta `/webhook` **validando la firma**
  `x-signature`: sin esa validación, cualquiera podría anunciar cobros falsos.
