# Instalar el cobro en línea sin escribir ni un comando

Todo con el ratón, desde el navegador. Calcula unos 20 minutos la primera vez.

Se hace **mejor en computadora** que en teléfono, sobre todo el paso de pegar el
programa. Si sólo tienes teléfono se puede, pero será incómodo.

Vas a hacer cuatro cosas:

1. Pedirle a Mercado Pago una llave
2. Subir un programa a Cloudflare
3. Guardar la llave ahí dentro
4. Darle una dirección de internet

---

## Antes de empezar

**Lo único delicado de toda la guía es la llave del paso 1.** Es como la llave de
tu caja: quien la tenga puede cobrar en tu nombre. No se la mandes a nadie —**ni
a mí**—, no la pegues en un chat y no la escribas en un correo. Sólo va donde
dice el paso 3.

Si en algún momento crees que se te escapó, entra a Mercado Pago y genera una
nueva: la vieja deja de servir al instante.

---

## Parte 1 · La llave de Mercado Pago

1. Entra a **mercadopago.com.mx/developers** e inicia sesión con tu cuenta de
   siempre.
2. Busca **«Tus integraciones»** y pulsa **«Crear aplicación»**.
3. Ponle un nombre cualquiera, por ejemplo `Web S&C`. Si te pregunta qué vas a
   hacer, elige la opción de **pagos en línea / Checkout Pro**.
4. Entra a la aplicación que acabas de crear y busca **«Credenciales de
   producción»**.
5. Copia el **Access Token**.

> **Ojo con esto.** Hay dos juegos de credenciales: las de **producción** y las
> de **prueba**. Las de producción empiezan por `APP_USR-`. Las de prueba
> empiezan por `TEST-` y **no cobran dinero de verdad**. Si copias las de
> prueba, todo parecerá funcionar y no entrará un solo peso. Asegúrate de estar
> en producción.

Deja esa llave copiada; la vas a pegar en el paso 3.

---

## Parte 2 · Subir el programa a Cloudflare

1. Entra a **dash.cloudflare.com** con tu cuenta.
2. En el menú de la izquierda busca **Workers** (puede aparecer como *Compute* o
   *Workers & Pages*, según la versión del panel).
3. Pulsa **Create** y elige empezar con el ejemplo **«Hello World»**.
4. Ponle de nombre **`syc-pagos`** y pulsa **Deploy**. Tarda unos segundos.
5. Cuando termine, pulsa **Edit code**. Se abre un editor con un programa de
   ejemplo dentro.
6. **Borra todo lo que hay** (clic dentro, `Ctrl+A` o `Cmd+A`, y `Suprimir`).
7. **Pega el contenido de `pagos-para-pegar.js`**, el archivo que te pasé.
8. Pulsa **Deploy** otra vez.

Ya está subido. Todavía no funciona: le falta la llave.

---

## Parte 3 · Guardar la llave dentro

1. Sal del editor y ve a **Settings** del Worker `syc-pagos`.
2. Busca **Variables and Secrets** (o *Variables*) y pulsa **Add**.
3. Rellena así:
   - **Type / Tipo:** `Secret` — es importante que sea *Secret* y no *Text*.
     *Secret* queda cifrada y no se puede volver a leer ni desde el panel;
     *Text* la deja a la vista de cualquiera que entre a tu cuenta.
   - **Name / Nombre:** `MP_ACCESS_TOKEN` — exactamente así, en mayúsculas y con
     los guiones bajos. Si lo escribes distinto, el programa no la encuentra.
   - **Value / Valor:** pega la llave del paso 1.
4. Guarda y pulsa **Deploy** si te lo pide.

---

## Parte 4 · Darle una dirección

1. Sigues en **Settings** del Worker.
2. Busca **Domains & Routes** (o *Triggers* / *Custom Domains*).
3. Pulsa **Add** → **Custom domain**.
4. Escribe **`pagos.sycsolutions.company`** y confirma.

Cloudflare crea la dirección solo. Puede tardar un minuto o dos.

---

## Parte 5 · Comprobar que quedó bien

Abre esta dirección en el navegador, como cualquier página:

```
https://pagos.sycsolutions.company/estado
```

Tiene que responder algo así:

```json
{"ok":true,"secreto":true,"paquetes":11}
```

Qué significa cada cosa:

| Lo que ves | Qué quiere decir |
|---|---|
| `"ok":true` | El programa está vivo. Partes 2 y 4 bien. |
| `"secreto":true` | La llave está puesta. Parte 3 bien. |
| `"paquetes":11` | Conoce tus once paquetes con sus precios. |

**Esta comprobación no cobra nada ni gasta nada.** Y fíjate en que dice
`"secreto":true`, no cuál es la llave: el programa nunca la enseña, ni a ti.

### Si algo no sale

| Lo que ves | Qué pasó | Qué hacer |
|---|---|---|
| La página no carga | La dirección aún no está lista | Espera 2 minutos y recarga |
| `"secreto":false` | Falta la llave o el nombre está mal escrito | Repite la parte 3 y revisa que ponga exactamente `MP_ACCESS_TOKEN` |
| Un error de Cloudflare | El programa no se pegó entero | Vuelve a *Edit code*, borra todo y pega otra vez |

---

## Parte 6 · Avísame

Cuando `/estado` te responda con los tres valores bien, dímelo y **enciendo los
once botones de pago en la web**. Eso lo hago yo, tú no tocas nada más.

Después abriremos un cobro de verdad para **mirar** que ya no aparece ninguna
mensualidad. No lo doy por hecho hasta verlo en pantalla.

---

## Si un botón no se llama como aquí dice

Cloudflare y Mercado Pago cambian sus paneles cada pocos meses, y esta guía se
escribió sin poder entrar a tu cuenta. Si algo no se llama exactamente así,
**mándame una captura de lo que ves** y te digo dónde pulsar. Es más rápido que
dar vueltas.
