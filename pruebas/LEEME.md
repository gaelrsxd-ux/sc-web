# Pruebas de navegador

Una sola suite, `compra.mjs`, sobre el único camino de esta web por el que
entra dinero: **contador de la ficha → pedido.html → lo que se le manda al
Worker → gracias.html.**

```sh
node servidor.js 8099 &
node pruebas/compra.mjs
```

Treinta y tres comprobaciones, la mitad con JavaScript y la otra mitad sin él.

## Por qué en un navegador

Casi nada de lo que puede romperse aquí se ve leyendo el HTML. El fallo que
motivó escribir esto fue un `pattern` de teléfono:

```html
pattern="[0-9\s()+-]{10,15}"     <!-- inválido -->
```

Los navegadores compilan ese atributo con la bandera `v`, que prohíbe `( ) + -`
sin escapar dentro de una clase. Lanza un `SyntaxError`, **se salta la
validación entera de ese campo** y acepta «hola» como número de teléfono. No hay
error visible en la página: sale en la consola. Por eso la suite trata un
mensaje de error de consola como un fallo.

## La comprobación que justifica el archivo

> **NO viaja ningún importe en el formulario**

Todo lo demás es que el flujo funcione. Ésa es la que evita que alguien abra las
herramientas del navegador, cambie un número y pague un peso por veinte placas.
El precio lo pone el Worker desde su propia tabla, y el formulario manda
solamente qué paquete se quiere. La suite comprueba que ningún campo con pinta
de importe —`total`, `precio`, `monto`, `importe`, `unit_price`,
`transaction_amount`— llegue al cobro.

Comprobado por sabotaje: metiendo un `<input type="hidden" name="total">` en el
formulario, esa prueba se pone en rojo.

## Lo que cubren las otras

| | |
|---|---|
| **El contador** | los once tramos enseñan el importe y el enlace de la tabla; los botones se deshabilitan en los extremos en vez de dar la vuelta |
| **Los pasos** | ninguno se salta con campos vacíos; un teléfono de tres cifras no pasa |
| **El resumen** | dice el mismo importe que va a cobrarse, y el HTML pegado en un campo sale como texto y no se ejecuta |
| **La vuelta** | `gracias.html` recupera el pedido y arma el WhatsApp; con `?estado=pendiente` **no** da el pago por hecho |
| **«En blanco»** | salta el paso del negocio **y le quita el `required`** — un campo obligatorio dentro de un bloque escondido bloquea el envío sin decir dónde está el problema |
| **Sin JavaScript** | la lista de once tramos se ve, los cuatro bloques del pedido salen a la vez y el formulario se envía entero |

Ese último bloque es el suelo del que cuelga todo lo demás: si un script falla
al cargar, la web tiene que seguir vendiendo.

## Lo que NO cubre

- **Mercado Pago.** La petición al Worker se intercepta para poder mirar qué se
  le manda; no se habla con nadie. Lo que pasa *después* del envío lo cubren las
  pruebas del Worker, `cloudflare/pagos/test/pagos.test.mjs`, que corren sin red
  y sí están en el CI.
- **El aspecto.** No hay comparación de capturas. Que un botón esté descolocado
  no lo ve esto.

## Por qué no está en el CI

El CI de este repositorio corre sólo lo que no necesita red ni levantar nada:
escáner de secretos, huellas de la CSP, tabla de precios y las pruebas del
Worker. Esta suite necesita Playwright, un Chromium y el servidor local
levantado, y un CI que tarda o falla por motivos que no son suyos se acaba
ignorando. Se corre a mano antes de tocar el flujo de compra.

Playwright se instala aparte —no hay `package.json` en este repositorio a
propósito: la web es HTML, CSS y JS a mano, sin compilar—:

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright
```

Si el Chromium está en otra ruta, se le dice con `CHROME_PATH`. Si el servidor
está en otro puerto, con `BASE`.
