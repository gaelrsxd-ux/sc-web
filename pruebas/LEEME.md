# Pruebas de navegador

Cuatro suites, una por cada cosa que puede romperse sola.

Por esta web entra dinero por **dos caminos distintos**, y no comparten casi
nada: uno vende un objeto que se envía, el otro un trabajo que se entrega. El
segundo tiene cuatro páginas de cobro —Google, sitio web, agente de IA y
automatización— con el mismo esqueleto y el mismo script (`assets/servicio.js`).

| | |
|---|---|
| `compra.mjs` | la placa: ficha → `pedido.html` → lo que se le manda al Worker → `gracias.html` |
| `servicio.mjs` | el perfil de Google: `servicio.html` → el cobro → `gracias-servicio.html`. Es la que prueba el MECANISMO del checkout, que las otras tres páginas comparten |
| `paquetes.mjs` | el sitio web, el agente de IA y la automatización: `web.html`, `ia.html`, `automatizacion.html` → el cobro → `gracias-paquete.html`, y que la portada y los términos digan el mismo precio |
| `instalaciones.mjs` | las fotos de clientes de la ficha y el visor |

```sh
node servidor.js 8099 &
node pruebas/compra.mjs
node pruebas/servicio.mjs
node pruebas/paquetes.mjs
node pruebas/instalaciones.mjs
```

Ciento treinta comprobaciones en la primera, la mayoría con JavaScript y un
bloque final sin él; ciento ochenta y dos en la segunda, ciento veintiuna en la
tercera y treinta y una en la cuarta.

⚠ **Los `force: true` de estas suites están sólo en los bloques sin JavaScript
—de `compra.mjs` y de `paquetes.mjs`—, y no es pereza.** Antes de pulsar, Playwright espera a que el
elemento deje de moverse, y lo mide comparando su posición en dos fotogramas
seguidos (`requestAnimationFrame`). Con el JavaScript apagado el navegador no
ejecuta esas llamadas, y en una página quieta —`pedido.html` no tiene ninguna
animación en marcha— no hay nada que fuerce un repintado: los dos fotogramas no
llegan nunca y el clic caduca a los treinta segundos con un «element is not
stable» que no habla de esta web, sino del medidor. Que el botón sea visible y
alcanzable se comprueba aparte, con un `isVisible()`.

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
| **El contador de la portada** | el «−» y el «+» viven en la ficha del producto, que es donde se ve lo que se compra y donde nace la pregunta —cuánto me cuestan las que yo quiero—. La cantidad elegida **viaja** al pedido en `?n=`, así que no se elige dos veces. En los extremos los botones se apagan y no dan la vuelta, y por encima del tope hay un enlace para pedir más |
| **Y NO se repite en el checkout** | a esa pantalla se llega con la cantidad ya puesta; su desplegable es para corregirla, no para recorrerla de uno en uno |
| **Los 25 tramos** | se comprueban en `pedido.html`, que es donde ahora se eligen: cada opción del desplegable enseña el importe de la tabla |
| **El «−» y el «+»** | suben y bajan de uno en uno sobre el mismo desplegable, que sigue siendo el que manda —es lo que permite elegir sin JavaScript y saltar de 1 a 20 sin pulsar veinte veces—. En los extremos se **apagan**, no desaparecen: un botón que se esfuma al llegar a 1 mueve el desplegable justo cuando el dedo va hacia él. Sin JavaScript no están, porque no sumarían nada |
| **«Inicio» en el menú** | faltaba, y «arriba» es la portada con la foto grande: lo único que alguien reconoce cuando se ha perdido dentro de una página larga. Se comprueba que el destino exista de verdad y sea la portada, no un ancla suelta |
| **Las pestañas** | tres paneles turnándose en el mismo hueco, con flechas, Inicio y Fin; `aria-selected` sigue a la abierta; entrar por `#productos` abre la suya; al abrir un panel se descubre lo que lleva `.rv` dentro, o la galería de casos saldría en blanco |
| **Los pasos** | ninguno se salta con campos vacíos; un teléfono de tres cifras no pasa |
| **El resumen** | dice el mismo importe que va a cobrarse, y el HTML pegado en un campo sale como texto y no se ejecuta |
| **La vuelta** | `gracias.html` recupera el pedido y arma el WhatsApp; con `?estado=pendiente` **no** da el pago por hecho |
| **«En blanco»** | salta el paso del negocio **y le quita el `required`** — un campo obligatorio dentro de un bloque escondido bloquea el envío sin decir dónde está el problema |
| **El zoom del doble toque** | la trampa se mudó del «+» del contador a las tres pestañas, que es lo que ahora se toca rápido: llevan `touch-action:manipulation`, un `:active` que sustituye al resaltado retirado y el `:hover` dentro de `@media (hover:hover)` para que no se quede pegado en iOS. El pellizco para ampliar sigue permitido en toda la página |
| **El empujón al envío gratis** | hoy NO sale en ninguna cantidad, porque el envío va dentro del precio y no hay umbral que empujar. El mecanismo sigue escrito y se enciende solo el día que vuelva a cobrarse |
| **La entrega en mano** | con el envío incluido ya no descuenta nada: el importe es el mismo desde la ciudad y desde Ciudad Valles. Lo que cambia es el aviso y la cabecera, que dicen «entrega en mano» — y el aviso **no** promete dinero. Al formulario no se le añade ninguna bandera de «soy local»: eso lo decide el servidor |
| **El contador, sin JavaScript** | nace escondido y lo enciende el script. Sin él, el «+» no sumaría, el campo aceptaría un número que nadie leería y el precio de al lado seguiría diciendo el de una placa: **tres controles mintiendo a la vez**. Escondido, la ficha dice lo que siempre dijo —una placa, su precio y el botón— y la cantidad se elige un toque después, en el `<select>` del pedido |
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


## `servicio.mjs`

El segundo camino por el que entra dinero. No reutiliza nada del primero porque
no se le parece: no hay cantidad, no hay envío, no hay dirección — y sí hay una
regla comercial que sólo vale en un caso.

### Las tres que justifican el archivo

> **NO viaja ningún importe en el formulario**

La misma de siempre, y por lo mismo: el precio lo pone el Worker desde su tabla
y el formulario manda sólo qué paquete se quiere. Comprobado por sabotaje: con
un `<input type="hidden" name="total">` dentro, dos pruebas se ponen en rojo.

> **con ficha propia, las dos opciones de anticipo quedan deshabilitadas**

Ésta es de dinero, no de interfaz. En un perfil de Google **no se puede retener
la entrega**: cada foto que se sube es pública y del cliente en el mismo segundo
en que se sube. Si la cuenta es suya y nos quita de administradores, el trabajo
hecho no se deshace y el resto no se cobra. El anticipo sólo se sostiene cuando
la cuenta la creamos nosotros, porque entonces la entrega final —el correo y la
contraseña— sí espera al pago.

Son **tres capas**, y hacen falta las tres porque es dinero: el CSS
(`pointer-events:none`, la única que sigue en pie sin JavaScript), el `disabled`
del script, y el corte del Worker, que ya no marca sino que **rechaza** la
combinación explícita con un 409. El argumento de antes —bloquear no impide
nada, basta con declarar «no»— vale para quien manda el formulario a mano; no
vale para el cliente honesto sin JavaScript, que era quien de verdad llegaba
ahí y a quien se le cobraba la mitad de un trabajo cuya entrega no se puede
retener.

Comprobado por sabotaje: cambiando `o.disabled=tiene` por `o.disabled=false`, se
pone en rojo; quitando las reglas `:has()` del CSS, tres comprobaciones más.

> **la frase de cada paquete deja de prometer el anticipo**

Apagar las opciones no basta. Si la línea de arriba sigue diciendo «págalo de
contado o deja $750 de anticipo» mientras las opciones de anticipo están grises,
la página está diciendo dos cosas a la vez. Cada paquete lleva sus dos textos y
el script cambia el entero, no sólo el estado de los controles.

Son **tres** textos, no dos, y el tercero es el que va escrito en el HTML: el
que lee quien no ejecuta scripts. Ése tiene que ser cierto en los dos casos a la
vez —«deja $750 de anticipo **si la cuenta la creamos nosotros**»—, porque ahí
no hay nadie que vaya a cambiarlo. Estaba escrita la versión de «no tengo
ficha», que ofrece el anticipo sin condición.

> **el importe se guarda en crudo, no formateado**

`servicio.html` guarda el pedido y `gracias.html` lo enseña, y el importe pasa
de una a otra por `sessionStorage`. Guardándolo ya formateado —«$1,150», que es
lo que se pinta en la cifra grande—, `Number('$1,150')` da `NaN` y el comprador
leía **«$NaN»** en el resumen de lo que acababa de pagar. Van dos atributos: uno
para pintar y otro, entero, para guardar.

Esta prueba existe porque la que había **se inventaba** el objeto que la primera
página escribe, así que comprobaba que la segunda sabe leer y nunca que la
primera sepa escribir. Ahora se compra de verdad —el POST al cobro está
interceptado, la pestaña vuelve al mismo origen y el `sessionStorage` sigue
ahí— y se lee lo que haya salido.

> **el canario del bloque «sin JavaScript»**

Cinco de las seis comprobaciones de ese bloque daban **idéntico con JavaScript
encendido** —contar `.ped-f` no mira `hidden`, y la cifra grande también nace
vacía con script cuando no hay nada marcado—, así que el día que la emulación no
se aplicara el bloque se habría quedado en verde sin haber probado nada. Y pasó:
bajo carga, el contexto arrancó con JavaScript vivo en dos de cinco ejecuciones.

Ahora lo primero que hace el bloque es afirmar algo que es **falso con script**
—que el bloque de datos se ve—, así que si la emulación no se aplicó, falla en
voz alta. Comprobado por sabotaje: poniendo `javaScriptEnabled: true` en ese
contexto, el canario se pone en rojo.

> **sin JavaScript, el formulario SE ENVÍA**

Todo lo demás de ese bloque mira la página quieta. Lo que hace que «sin
JavaScript se sigue vendiendo» sea verdad es que el POST salga con lo que hay
que mandar, y eso no lo comprobaba nadie.

### Lo que cubren las otras

| | |
|---|---|
| **Primero el paquete, después cómo se paga** | al entrar sólo se ven los **dos paquetes**; las formas de pago viven dentro de cada uno y no se descubren hasta elegirlo, y entonces el otro paquete se aparta. Con las cuatro desplegadas a la vez la pantalla pedía dos decisiones al mismo tiempo. Comprobado por sabotaje: si el paquete elegido deja de cerrar al otro, o si los pagos nacen visibles, se pone en rojo |
| **La tarjeta entera se toca** | el control cubre el bloque completo (347×220 sobre 349×222) y lleva `appearance:none` como primera declaración, que es lo único que garantiza que iOS no pinte su propio botón encima si el resto de la regla no llegara a aplicarse. Antes había que acertarle a un rectángulo de 200 px |
| **Qué incluye, en la tarjeta** | plegado en un `<details>` y no en la página de términos, donde había que salir, leer un texto legal con plazos y cancelación mezclados, y volver. Va **por encima** del control que cubre la tarjeta —`z-index`—, así que abrirlo no es además elegir el paquete: son dos gestos en el mismo sitio y cada uno hace lo suyo. Se comprueba preguntando qué hay en ese punto (`elementFromPoint`), no dejando que el clic reviente: un choque de capas tiene que salir como un rojo con nombre |
| **El resumen no habla sólo de fotos** | decía «Con las fotos que tú nos mandes» y «Vamos a tu negocio y tomamos las fotos». Quien no sabe qué es configurar un perfil de Google leía eso y entendía que el paquete **son** fotos; lo que compra es la ficha entera montada, y lo de las fotos es una condición |
| **El paso en el que se está** | «Paso 1 de 3» → 2 al abrir un paquete → 3 al elegir cómo se paga. Una pantalla que va descubriendo bloques no dice cuánto falta, y no saber cuánto falta es por lo que se abandona un cobro |
| **Y se ve que se toca** | en reposo un resplandor recorre el borde cada seis segundos, y cada tarjeta dice «toca para elegir». Al soltar, una **ola sale del punto exacto que se tocó** —el script escribe las coordenadas— y recorre la tarjeta. Si no se toca no pasa nada: no hay `:hover` en una pantalla táctil |
| **La marcha atrás** | «← Cambiar de paquete» devuelve los dos y **desmarca** lo que hubiera: un cobro sin marcha atrás es un cobro que se abandona, y una forma de pago marcada de un paquete que ya no está en pantalla es cobrar a ciegas |
| **Los datos, al abrir el paquete** | no esperan a la forma de pago: es lo que se pidió —«cuando seleccione el paquete que aparezca todo lo demás»— y evita que el bloque salte al cambiar de una opción a la otra |
| **Dos paquetes, no cuatro opciones** | cada uno con sus dos formas de pago dentro. En una lista plana de cuatro, el ojo compara importes en vez de paquetes, y «$750» junto a «$1,490» parece un descuento cuando es un anticipo |
| **La visita, con su matiz al lado** | «Todo hecho» promete ir al negocio a tomar las fotos y eso sólo vale en San Luis Potosí y Soledad. Un matiz que sólo vive en la página de términos se lee **después** de pagar, y quien lo descubre ahí tiene razón en enfadarse |
| **Lo que falta por cobrar** | quien deja un anticipo se va sin saber cuánto debe si nadie se lo dice — y la cifra grande que acaba de ver es la del anticipo, no la del paquete. Va en el resumen y en el WhatsApp |
| **El enlace de la ficha** | al corregir a «todavía no aparezco», el campo se **vacía**, no sólo se esconde: un campo escondido conserva su valor y lo manda igual, y el aviso de la venta llegaba diciendo «SIN ficha: la creamos» con el enlace a la ficha que ya existía debajo |
| **El aviso antes de elegir** | cada paquete dice cómo se puede pagar **antes** de que nadie pulse. Enterarse de que había otra forma de pagar después de haber decidido que no se puede es un cliente perdido por no haberlo dicho a tiempo |
| **Nada preseleccionado** | ninguna opción nace marcada —en una pantalla de cobro, una opción marcada de fábrica es una que alguien puede comprar sin haberla elegido— y las cuatro llevan `required`, así que sin JavaScript el navegador exige elegir |
| **Los datos, después** | el bloque del negocio no se pide hasta que hay paquete elegido |
| **La cifra grande** | sigue a la opción elegida y coincide con la del catálogo |
| **Lo que llega al cobro** | el paquete elegido y si tiene ficha o no —que es lo que hace legítimo el anticipo—, y **ninguna dirección de envío**: un servicio no se envía |
| **El teléfono** | el mismo `pattern` que en el pedido, con los escapes puestos; tres cifras rebotan |
| **La vuelta** | `gracias.html` le dice que nos añada como administrador **y con qué correo**, y **no** le habla de paquetería. El WhatsApp trae escrito si su ficha existe y **no declara ningún importe** |
| **Volver atrás** | el navegador restaura el paquete elegido pero **no vuelve a ejecutar el script** al salir de la caché de páginas: el bloque de datos se quedaba escondido y con él el botón de pagar. Un paquete elegido y ninguna forma de pagarlo, en la pantalla de cobro. Lo arregla `pageshow`, que es el evento que sí llega ahí |
| **El pago pendiente** | con `?estado=pendiente` la página **no da el pago por hecho**. La rama del servicio pisaba ese aviso y dejaba «Tu pago está pendiente» arriba y «no tienes que hacer nada más» debajo — quien lee eso no vuelve a la tienda a pagar |
| **Sin JavaScript** | los tres bloques se ven, las cuatro opciones están, **cada una lleva su precio escrito** —no calculado—, la cifra grande queda vacía, **la frase cambia con la respuesta** (lo hace el CSS con `:has()`, no el script), la opción de anticipo no se deja pulsar con ficha propia, el enlace de la ficha sólo se pide cuando hay ficha, y el **formulario se envía** con el paquete, la respuesta y ningún importe |
| **`gracias-servicio.html`** | un servicio vuelve a **su propia página**, elegida por el Worker en `back_urls` y no por un script. Antes las dos compras volvían a la misma, que las distingue leyendo el `sessionStorage` que escribe un script: sin JavaScript se le decía «preparamos tus placas» a quien contrató un perfil de Google y **nunca** veía el correo al que tenía que añadirnos — que es lo que arranca el plazo de entrega. Pagaba y se quedaba esperando algo que dependía de él |
| **El pago pendiente y el anticipo** | con `?estado=pendiente` **no** se anuncia «Falta por pagar $1,150»: quien tiene un recibo de efectivo sin pagar en la mano no debe sólo el resto — no ha pagado nada, y el primero de los dos pagos hay que hacerlo ahora. Decirle que lo único pendiente es el resto es la forma de que no pague el anticipo |


### Por qué no hay ni un reloj fijo

Esta suite se sincronizaba con **20 `waitForTimeout`** de entre 140 y 800 ms. Bajo
carga —otro Chromium en la misma máquina— se ponía roja dos de cada cinco veces,
cada vez por parejas distintas de comprobaciones. El rojo no era la página: era
el reloj. Un margen fijo o sobra —y la suite tarda de más— o falta, y entonces
miente.

Ahora se espera **a la condición** que la comprobación siguiente necesita
(`hasta()`), y si no llega lo dice con su nombre en vez de dejar que falle la
línea de al lado. Comprobado: tres copias de la suite a la vez, las tres en
verde.

### La huella de las hojas de estilo

Las hojas se sirven bajo un nombre que no cambia nunca, y Safari en iOS las
reutiliza sin volver a preguntar. El resultado es **HTML nuevo con CSS viejo**,
que no se parece a un fallo de caché: se parece a un diseño roto. Pasó **tres
veces en el mismo teléfono**, y cada vez costó descartar que el CSS estuviera
mal escrito, mal servido o mal desplegado — estaba bien las tres veces:

- un contador de cantidad salió apilado en vertical y en versalitas,
- un botón salió como la pastilla blanca del sistema de iOS,
- y ese mismo botón, ya sin rótulo visible, salió como **una rayita de cuatro
  píxeles** que había que acertar para poder comprar.

`tools/assets.mjs` le pone a cada enlace la huella del contenido del archivo
(`pedido.css?v=c0026f3b`). Cambia el CSS → cambia la dirección → no hay nada que
reutilizar. Está en el hook y en el CI, y la suite comprueba además que las
direcciones con huella **carguen de verdad**: una huella mal puesta es un 404 y
una página sin estilos.

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
Worker. Las tres suites necesitan Playwright, un Chromium y el servidor local
levantado, y un CI que tarda o falla por motivos que no son suyos se acaba
ignorando. Se corren a mano antes de tocar el flujo de compra o la ficha.

Playwright se instala aparte —no hay `package.json` en este repositorio a
propósito: la web es HTML, CSS y JS a mano, sin compilar—:

```sh
PLAYWRIGHT_SKIP_BROWSER_DOWNLOAD=1 npm i playwright
```

Si el Chromium está en otra ruta, se le dice con `CHROME_PATH`. Si el servidor
está en otro puerto, con `BASE`.
