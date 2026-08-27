# Pruebas de navegador

Dos suites. `compra.mjs` cubre el único camino de esta web por el que entra
dinero: **contador de la ficha → pedido.html → lo que se le manda al Worker →
gracias.html.** `instalaciones.mjs` cubre las fotos de clientes de la ficha.

```sh
node servidor.js 8099 &
node pruebas/compra.mjs
node pruebas/instalaciones.mjs
```

Sesenta y ocho comprobaciones en la primera, la mayoría con JavaScript y un
bloque final sin él; dieciocho en la segunda.

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
| **El precio de la portada** | la cifra «desde» es la de 1 placa de la tabla, el botón lleva al pedido, y el contador **ya no está** en la portada: no hay dos sitios donde elegir cantidad |
| **Los 25 tramos** | se comprueban en `pedido.html`, que es donde ahora se eligen: cada opción del desplegable enseña el importe de la tabla |
| **Las pestañas** | tres paneles turnándose en el mismo hueco, con flechas, Inicio y Fin; `aria-selected` sigue a la abierta; entrar por `#productos` abre la suya; al abrir un panel se descubre lo que lleva `.rv` dentro, o la galería de casos saldría en blanco |
| **Los pasos** | ninguno se salta con campos vacíos; un teléfono de tres cifras no pasa |
| **El resumen** | dice el mismo importe que va a cobrarse, y el HTML pegado en un campo sale como texto y no se ejecuta |
| **La vuelta** | `gracias.html` recupera el pedido y arma el WhatsApp; con `?estado=pendiente` **no** da el pago por hecho |
| **«En blanco»** | salta el paso del negocio **y le quita el `required`** — un campo obligatorio dentro de un bloque escondido bloquea el envío sin decir dónde está el problema |
| **El zoom del doble toque** | la trampa se mudó del «+» del contador a las tres pestañas, que es lo que ahora se toca rápido: llevan `touch-action:manipulation`, un `:active` que sustituye al resaltado retirado y el `:hover` dentro de `@media (hover:hover)` para que no se quede pegado en iOS. El pellizco para ampliar sigue permitido en toda la página |
| **El empujón al envío gratis** | hoy NO sale en ninguna cantidad, porque el envío va dentro del precio y no hay umbral que empujar. El mecanismo sigue escrito y se enciende solo el día que vuelva a cobrarse |
| **La entrega en mano** | con el envío incluido ya no descuenta nada: el importe es el mismo desde la ciudad y desde Ciudad Valles. Lo que cambia es el aviso y la cabecera, que dicen «entrega en mano» — y el aviso **no** promete dinero. Al formulario no se le añade ninguna bandera de «soy local»: eso lo decide el servidor |
| **Sin JavaScript** | los tres paneles de Soluciones se ven a la vez —el `hidden` lo pone el script, no el marcado—, la cifra grande del pedido queda **vacía** en vez de mentir, las 25 cantidades siguen enteras en su `<select>`, los cuatro bloques del pedido salen a la vez y el formulario se envía entero |

Ese último bloque es el suelo del que cuelga todo lo demás: si un script falla
al cargar, la web tiene que seguir vendiendo.

## `instalaciones.mjs`

Las tres fotos de placas ya entregadas —Kabuki en Plaza Sendero, Kabuki en
Villamagna y Tito's en Villamagna—. Son la única prueba de la página de que
esto existe fuera de un render, así que se comprueba que estén y que no
mientan.

### La comprobación que justifica el archivo

> **no hay ninguna frase entrecomillada atribuida a nadie**

Un testimonio inventado es más fácil de escribir que de conseguir, y esta
sección es exactamente donde aparecería. Lo único que la página afirma ahí es
lo que se ve en la foto: que la placa está en ese negocio. Mientras no haya
frases reales, con nombre y con permiso, esa prueba impide que se cuele una.

Comprobado por sabotaje: metiendo «Subimos de 12 a 90 reseñas en un mes» —
Juan, Kabuki en la entradilla, se pone en rojo.

### Lo que cubren las otras

| | |
|---|---|
| **Que las fotos existan** | las tres cargan de verdad; una ruta mal escrita da un 404 que aquí sale, y un hueco en esta sección es peor que no tenerla |
| **El encuadre** | las tres en 3:4. La de Villamagna venía en 2:3 y se recorta al convertir; si alguien repone el archivo sin recortar, la rejilla se descuadra y esto avisa |
| **Los pies** | cada uno dice el negocio y la plaza. Sin el nombre es otra foto bonita |
| **Dos galerías, no una** | el visor las agrupa por `data-galeria`. Mezclarlas dejaría el reverso de la placa a la derecha del mostrador de un cliente. Comprobado por sabotaje: renombrando el grupo, el visor pasa a contar 6 y las dos pruebas se ponen en rojo |
| **El móvil** | las tres van en una tira que se arrastra, en un solo renglón. Apiladas serían tres pantallas y media en mitad de la ficha de compra |
| **Sin JavaScript** | las tres están en el HTML: no las fabrica ningún script |

⚠ Esa última **no** comprueba que se vean. `index.html` entero nace con
`.rv{opacity:0}` y lo descubre un `IntersectionObserver`: sin JavaScript la
portada está en blanco de arriba abajo, y eso es de antes de esta sección.
Lo que sí se comprueba es que la sección nueva no sea *peor* que sus vecinas
—se compara su opacidad con la de la ficha del producto—, así que el día que
se arregle el descubrimiento, ésta viene incluida. `pedido.html`, que es la
que cobra, no tiene ese problema y su bloque sin JavaScript sigue en
`compra.mjs`.


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
Worker. Estas suites necesitan Playwright, un Chromium y el servidor local
levantado, y un CI que tarda o falla por motivos que no son suyos se acaba
ignorando. Se corren a mano antes de tocar el flujo de compra o la ficha.

Playwright se instala aparte —no hay `package.json` en este repositorio a
propósito: la web es HTML, CSS y JS a mano, sin compilar—:

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright
```

Si el Chromium está en otra ruta, se le dice con `CHROME_PATH`. Si el servidor
está en otro puerto, con `BASE`.
