/* ============================================================================
   EL CHECKOUT DE LOS SERVICIOS — UN SOLO SCRIPT PARA CUATRO PÁGINAS

   servicio.html (Google), web.html, ia.html y automatizacion.html tienen el
   mismo esqueleto —paquete, forma de pago, datos— y este archivo es el que lo
   mueve. Nació dentro de servicio.html; salió de allí el día que hubo cuatro
   páginas, porque cuatro copias del mismo script divergen en cuanto alguien
   toca una.

   Va al final del <body> y no lleva `defer`: cuando corre, el formulario ya
   existe. Lo carga cada página con su huella (tools/assets.mjs), y lo permite
   la CSP por venir del propio origen ('self').

   Todo lo que es de UNA familia se protege con un `if`: el bloque de las
   placas y la pregunta de la ficha sólo existen en la página de Google, y en
   las otras tres el script sigue funcionando sin ellos.
   ========================================================================= */
/* ------------------------------------------------------------------------
   LO QUE ESTE SCRIPT AÑADE, Y LO QUE PASA SI NO CORRE

   El formulario funciona entero sin él: se ven los tres bloques, cada opción
   lleva su importe escrito al lado y se envía de una sola vez con la validación
   del navegador. Ninguna de las tres cosas de abajo es imprescindible.

     1. LOS DATOS APARECEN CUANDO YA HAY PAQUETE. Pedir el nombre del negocio
        antes de que nadie haya elegido qué compra es pedir trabajo por
        adelantado; y nada empieza marcado, así que el primer gesto es elegir.

     2. NADA SE CONTRADICE CON LA FICHA PROPIA. Si el visitante dice que su
        negocio YA aparece en Google, el anticipo deja de existir para él —no
        hay entrega que retener— y entonces: las opciones de anticipo se apagan,
        Y la línea que promete «págalo de contado o deja un anticipo» cambia por
        la que dice la verdad de su caso. Apagar las opciones sin cambiar la
        frase dejaría la página diciendo dos cosas distintas a la vez.

     3. La cifra de arriba, que nace vacía a propósito.

   Si algo revienta, lo peor que pasa es que se vea todo a la vez y las cuatro
   opciones sigan disponibles — que es exactamente la página sin JavaScript.
   --------------------------------------------------------------------- */
(()=>{
  const form=document.getElementById('sv-form');
  if(!form)return;
  const tot=document.querySelector('[data-sv-tot]');
  const que=document.querySelector('[data-sv-que]');
  const datos=document.querySelector('[data-sv-datos]');
  const ficha=document.querySelector('[data-sv-ficha]');
  const aviso=document.querySelector('[data-sv-aviso]');
  const rotulo=document.querySelector('[data-sv-paso]');
  const ops=[...form.querySelectorAll('input[name="paquete"]')];
  if(!ops.length)return;
  const planes=[...form.querySelectorAll('.sv-plan')];
  const vuelta=form.querySelector('[data-sv-vuelta]');
  const intro=form.querySelector('[data-sv-intro]');
  const cambiar=form.querySelector('[data-sv-cambiar]');
  const pagar=form.querySelector('button[type="submit"]');
  /* ── LAS PLACAS DEL PAQUETE ──
     Un solo contador para los dos paquetes, con sus números escritos por el
     generador (precio, tope y la escalera de sueltas contra la que se anuncia
     el ahorro). Todo lo que pinta dinero pasa por `pinta()`, placas incluidas:
     una sola función, para que la cifra grande, el rótulo del radio y el botón
     no puedan discrepar. */
  const placasCaja=form.querySelector('[data-sv-placas]');
  const placasVis=form.querySelector('[data-sv-placa-vis]');
  const placasSr=form.querySelector('[data-sv-placa-sr]');
  const placasAhorro=form.querySelector('[data-sv-ahorro]');
  const PLACA=placasCaja?Number(placasCaja.dataset.precio):0;
  const PLACAS_MAX=placasCaja?Number(placasCaja.dataset.max):0;
  const PLACAS_ESC=placasCaja?placasCaja.dataset.esc.split(',').map(Number):[];
  const UMBRAL_CUOTAS=placasCaja?Number(placasCaja.dataset.umbral)||Infinity:Infinity;
  let placas=0;
  /* Cuándo se abrió el último paquete. Al abrirlo la página reflowa y se
     desplaza: el segundo toque del impaciente —el gesto de quien no vio
     reaccionar al primero— caería sobre el «+» recién aparecido y sumaría una
     placa sin querer. Durante ese asentamiento, el contador no escucha. */
  let asentada=0;
  const miles=n=>n.toLocaleString('en-US');
  const extraPlacas=()=>placas*PLACA;

  /* NADA NACE MARCADO, y es deliberado en una pantalla de cobro: una opción
     preseleccionada es una que alguien puede comprar sin haberla elegido. Los
     cuatro radios llevan `required`, así que sin JavaScript el propio navegador
     bloquea el envío hasta que se marque una — no hace falta script para que
     esto se cumpla. */
  if(datos)datos.hidden=true;
  /* La pista de «toca para elegir» sólo es cierta con el script vivo. */
  for(const p of form.querySelectorAll('[data-sv-pista]'))p.hidden=false;

  /* ══════ PRIMERO EL PAQUETE, DESPUÉS CÓMO SE PAGA ══════
     Con las cuatro formas de pago a la vista a la vez, la pantalla pedía dos
     decisiones al mismo tiempo —qué compro y cómo lo pago— y el ojo comparaba
     importes entre paquetes distintos: «$750» junto a «$1,490» parece un
     descuento cuando es un anticipo.

     `abre(null)` es el estado de partida: los dos paquetes con su botón y sin
     sus pagos. Con un id, ese paquete se queda solo, enseña sus dos formas de
     pago y aparece la salida para volver. Todo esto lo monta el script, así
     que sin JavaScript no existe y se ven las cuatro opciones — el orden se
     pierde, la venta no. */
  function abre(id){
    asentada=performance.now();
    for(const p of planes){
      const suyo=p.dataset.plan===id;
      /* Sin nada elegido están los dos; con uno elegido, sólo él. */
      p.hidden=!!id&&!suyo;
      p.classList.toggle('abierto',suyo);
      const btn=p.querySelector('.sv-elige');
      const pagos=p.querySelector('.sv-pagos');
      const pista=p.querySelector('[data-sv-pista]');
      if(btn)btn.hidden=suyo;
      /* La pista dice «toca para elegir»: mientras el paquete está abierto ya
         se tocó, y repetirlo sobra. */
      if(pista)pista.hidden=suyo;
      if(pagos)pagos.hidden=!suyo;
      /* Al cerrar un paquete se le quita la marca: si no, quedaría elegida una
         forma de pago de un paquete que ya no está en pantalla, y el botón de
         pagar cobraría algo que el visitante no ve. */
      if(!suyo)for(const o of p.querySelectorAll('input[name="paquete"]'))o.checked=false;
    }
    if(vuelta)vuelta.hidden=!id;
    /* El párrafo de la comparación se va con ella: con un paquete abierto ya
       no orienta, estorba entre el rótulo y la tarjeta. */
    if(intro)intro.hidden=!!id;
    pinta();
  }

  function pinta(){
    const m=ops.find(o=>o.checked);
    /* Los datos aparecen con el PAQUETE abierto, no con la forma de pago
       marcada: es lo que el titular pidió —que al elegir paquete aparezca todo
       lo demás— y además evita que el bloque salte al entrar y salir de una
       opción a otra dentro del mismo paquete. */
    const abierto=form.querySelector('.sv-plan.abierto');
    const hay=!!abierto;

    /* ⚠⚠ EL BOTÓN DE PAGAR NO HACÍA NADA, Y ESTE ERA EL MOTIVO.
       Los cuatro radios se llaman `paquete` y llevan `required`. Al abrir un
       paquete, el OTRO se esconde con sus dos radios dentro. Si nadie había
       marcado forma de pago —y es facilísimo: los datos aparecen al abrir el
       paquete, así que se baja hasta el botón sin pasar por las opciones—, el
       navegador tenía que señalar el primer control inválido, que es uno de los
       ESCONDIDOS. No se puede enfocar lo que no se ve, así que cancelaba el
       envío EN SILENCIO: el botón se pulsaba y no pasaba nada, sin mensaje. En
       la consola quedaba «An invalid form control with name='paquete' is not
       focusable», que es un sitio donde no mira quien está comprando.

       Un control `disabled` queda fuera de la validación, así que los del
       paquete escondido dejan de estorbar. El de contado del paquete abierto
       NUNCA se apaga, de modo que el grupo sigue siendo obligatorio: esto no
       abre la puerta a pagar sin elegir. */
    const tiene=(form.querySelector('input[name="ficha_tiene"]:checked')||{}).value==='si';
    for(const o of ops)
      o.disabled=(hay&&o.closest('.sv-plan')!==abierto)||
                 (o.dataset.anticipo==='1'&&tiene);

    /* ⚠ CADA IMPORTE A LA VISTA CRECE CON LAS PLACAS, y los cuatro salen de la
       MISMA suma: base del catálogo + placas. Si uno se calculara aparte, el
       radio diría $750 y el botón $1,250 y nadie sabría cuál va a cobrarse.

       Y EL `value` DEL RADIO SE RECOMPONE: gp-ta → gp-ta2. El importe sigue
       saliendo del catálogo del Worker —aquí sólo viaja el id— y con un Worker
       viejo sin combos la venta falla en voz alta («Ese paquete no existe»)
       en vez de cobrar el paquete sin placas en silencio. */
    for(const o of ops){
      if(o.dataset.id)o.value=o.dataset.id+(placas||'');
      const caja=o.closest('.ped-op');
      const r=caja&&caja.querySelector('b[data-sv-op]');
      if(r)r.textContent='Pagar $'+miles(Number(r.dataset.base)+extraPlacas())+
        (o.dataset.anticipo?' de anticipo':' de contado');
      /* ⚠ «UN SOLO PAGO Y LISTO» DEJA DE SER VERDAD cuando el combo cruza el
         umbral de las dos mensualidades: la fila del catálogo las lleva y
         Mercado Pago las va a ofrecer. Un pie que promete un solo pago junto a
         un checkout que ofrece dos es la clase de contradicción que este
         proyecto no se permite. El texto original se guarda la primera vez y
         vuelve solo cuando el importe baja del umbral. */
      const pie=caja&&!o.dataset.anticipo&&caja.querySelector('small');
      if(pie){
        if(pie.dataset.solo===undefined)pie.dataset.solo=pie.textContent;
        const t=Number(r.dataset.base)+extraPlacas()>=UMBRAL_CUOTAS
          ?'En un pago, o hasta en 2 mensualidades con tu tarjeta.'
          :pie.dataset.solo;
        if(pie.textContent!==t)pie.textContent=t;
      }
    }
    /* La frase de cada paquete («…o deja $750 de anticipo…») crece con las
       placas por la misma suma que todo lo demás: lo que se deja HOY es
       anticipo + placas. El resto escrito al lado no se toca — es verdad. */
    for(const fr of form.querySelectorAll('[data-sv-frase-ant]'))
      fr.textContent='$'+miles(Number(fr.dataset.base)+extraPlacas())+' de anticipo';
    const sufijo=placas?' + '+placas+' placa'+(placas>1?'s':''):'';
    const importe=m?Number(m.dataset.num)+extraPlacas():0;
    if(tot)tot.textContent=m?'$'+miles(importe):'';
    if(que)que.textContent=m?(m.dataset.que||'')+sufijo:'Elige tu paquete abajo';
    /* Y EL BOTÓN DICE LO QUE FALTA en vez de prometer un cobro que todavía no
       puede hacer. Un «Pagar» que no paga es la peor versión de este fallo:
       parece que la web está rota. Con la forma de pago marcada lleva su
       importe, como en la página de la placa. */
    if(pagar)pagar.textContent=m?'Pagar $'+miles(importe):'Elige c\u00f3mo lo pagas';

    /* El bloque de las placas vive con el paquete abierto, como el de los
       datos. El rótulo del contador y la línea del ahorro son los únicos dos
       textos que escribe este script aquí; el ahorro sale de la escalera de
       sueltas que escribió el generador — la MISMA tabla que las vende. */
    if(placasCaja){
      /* ⚠ CON PLACAS ELEGIDAS, LA CAJA NO SE ESCONDE NI EN LA COMPARACIÓN.
         Escondida, «← Cambiar de paquete» dejaba dos placas vivas e
         INVISIBLES: las tarjetas decían $1,490 y $2,300 mientras sus frases
         del anticipo ya sumaban los $500 de unas placas que nada en pantalla
         nombraba. Visible con su «2 placas · +$500», las cifras se explican
         solas — y con cero, se esconde como siempre. */
      placasCaja.hidden=!hay&&!placas;
      /* Región viva con guarda: pinta() corre en CADA interacción, y reasignar
         el mismo texto también es una mutación que el lector de pantalla
         anuncia — sin la guarda, marcar la forma de pago hacía oír «2 placas»
         de la nada. La mitad invisible lleva la consecuencia en dinero, que es
         lo que el rótulo visible calla. */
      const vis=placas?placas+' placa'+(placas>1?'s':''):'Sin placas';
      if(placasVis&&placasVis.textContent!==vis)placasVis.textContent=vis;
      const sr=placas?' \u2014 +$'+miles(extraPlacas())+' hoy, ahorras $'+
        miles(PLACAS_ESC[placas-1]-extraPlacas()):'';
      if(placasSr&&placasSr.textContent!==sr)placasSr.textContent=sr;
      for(const btn of placasCaja.querySelectorAll('[data-sv-placa]')){
        const apagar=Number(btn.dataset.svPlaca)<0?placas<=0:placas>=PLACAS_MAX;
        /* Si el botón que se apaga es el que tiene el foco, el navegador lo
           expulsa a <body> y el siguiente Tab arranca desde el principio de la
           página — en mitad del cobro. El foco pasa al hermano, que en ese
           instante siempre está encendido. */
        if(apagar&&document.activeElement===btn){
          const otro=[...placasCaja.querySelectorAll('[data-sv-placa]')].find(x=>x!==btn);
          if(otro)otro.focus();
        }
        btn.disabled=apagar;
      }
      if(placasAhorro){
        placasAhorro.hidden=!placas;
        /* Concordado con el contador, y la coletilla del anticipo sólo cuando
           el anticipo existe: a quien marcó «ya aparece en Google» se le acaba
           de decir que el anticipo no aplica — repetírselo aquí es
           contradecirse dos renglones después. */
        if(placas)placasAhorro.textContent='+$'+miles(extraPlacas())+
          ' \u00b7 te ahorras $'+miles(PLACAS_ESC[placas-1]-extraPlacas())+
          ' frente a comprarla'+(placas>1?'s':'')+' aparte \u00b7 '+
          (placas>1?'se pagan hoy':'se paga hoy')+(tiene?'':', tambi\u00e9n con anticipo');
      }
    }
    /* Tres pasos, y el rótulo dice en cuál se está: elegir paquete, elegir cómo
       se paga, y escribir los datos. Se cuenta por lo que YA está decidido, no
       por lo que se ve: es lo mismo que hace la página de pedido. */
    if(rotulo)rotulo.textContent='Paso '+(m?3:hay?2:1)+' de 3';
    if(datos){
      const antes=datos.hidden;
      datos.hidden=!hay;
      /* Sólo al descubrirlo, y sólo si cambia: una región viva que se reescribe
         en cada clic se convierte en un loro y se acaba desconectando. */
      if(aviso&&antes&&hay)aviso.textContent=
        'Listo. Elige c\u00f3mo pagarlo y abajo te pedimos los datos de tu negocio.';
      if(aviso&&!hay)aviso.textContent='';
    }
  }

  function ajusta(){
    const tiene=(form.querySelector('input[name="ficha_tiene"]:checked')||{}).value==='si';
    let perdida=false;
    for(const o of ops){
      if(o.dataset.anticipo!=='1')continue;
      /* El `disabled` ya no se escribe aquí: lo decide `pinta()`, que es quien
         conoce los DOS motivos por los que un radio queda fuera —su paquete
         está escondido, o es un anticipo que no aplica— y tiene que combinarlos.
         Escribirlo en dos sitios era volver a encender el que el otro apagó. */
      const caja=o.closest('.ped-op');
      if(caja)caja.classList.toggle('apagada',tiene);
      if(tiene&&o.checked){o.checked=false;perdida=true;}
    }
    /* ⚠ LA FRASE DE CADA PAQUETE YA NO LA ESCRIBE ESTE SCRIPT. Antes era un solo
       <p> con las dos versiones en atributos `data-` que este bucle reescribía,
       y sin JavaScript sólo existía una de las dos verdades: quien marcaba «ya
       aparece en Google» seguía leyendo «deja $750 de anticipo». Ahora son tres
       párrafos hermanos y los turna el CSS con `:has()`, que corre sin script.
       Lo mismo con el enlace de la ficha, que se esconde por CSS.

       Lo que sí sigue haciendo falta aquí es VACIARLO: un campo escondido
       conserva su valor y lo envía igual, así que quien pegaba su ficha y luego
       corregía a «todavía no aparezco» mandaba las dos cosas a la vez. Eso el
       CSS no lo puede hacer. */
    if(ficha&&!tiene)for(const c of ficha.querySelectorAll('input'))c.value='';
    /* Si se le cayó la forma de pago por decir que su ficha ya existe, el
       paquete SIGUE abierto: sólo tiene que elegir la otra forma de pago, que
       está justo ahí. Cerrarlo entero le deshacía dos decisiones por una. */
    if(perdida)lleva(form.querySelector('.sv-plan.abierto'));
    pinta();
  }

  /* Un desplazamiento suave y sólo cuando el destino no se ve ya: mover la
     página debajo de alguien que ya está mirando donde tiene que mirar es
     desorientarlo. Y se respeta a quien pidió menos animación. */
  const lento=matchMedia('(prefers-reduced-motion: reduce)').matches;
  function lleva(el){
    if(!el)return;
    const c=el.getBoundingClientRect();
    if(c.top>=0&&c.bottom<=innerHeight)return;
    el.scrollIntoView({behavior:lento?'auto':'smooth',block:'start'});
  }

  form.addEventListener('click',e=>{
    const b=e.target.closest('.sv-elige');
    if(b){
      /* ⚠ EL DESTELLO PRIMERO, Y LUEGO SE ABRE. Es lo que hace que un toque se
         sienta atendido: sin él, entre el dedo y el cambio de pantalla no pasa
         nada y quien tiene prisa vuelve a pulsar. La clase se quita al terminar
         la animación —o por reloj, por si el navegador no manda el evento— para
         que el siguiente toque vuelva a dispararla. */
      const tarjeta=b.closest('.sv-plan');
      if(tarjeta){
        /* La ola sale DEL PUNTO QUE SE TOCÓ, no del centro: es la diferencia
           entre una animación que decora y una que contesta al dedo. Si el
           clic viene del teclado —`e.detail` vale 0— no hay punto, y entonces
           sale del centro, que es lo que pone el CSS por defecto. */
        if(e.detail){
          const c=tarjeta.getBoundingClientRect();
          tarjeta.style.setProperty('--x',(e.clientX-c.left)+'px');
          tarjeta.style.setProperty('--y',(e.clientY-c.top)+'px');
        }else{
          tarjeta.style.removeProperty('--x');
          tarjeta.style.removeProperty('--y');
        }
        tarjeta.classList.remove('pulsada');
        void tarjeta.offsetWidth;          /* reinicia la animación */
        tarjeta.classList.add('pulsada');
        const limpia=()=>tarjeta.classList.remove('pulsada');
        tarjeta.addEventListener('animationend',limpia,{once:true});
        setTimeout(limpia,700);
      }
      abre(b.dataset.elige);
      /* Al paquete elegido, no a los datos todavía: debajo acaban de aparecer
         sus dos formas de pago y saltárselas sería elegir por él. */
      lleva(tarjeta);
      return;
    }
    if(e.target.closest('[data-sv-cambiar]')){
      abre(null);
      lleva(form.querySelector('.sv-plan'));
    }
  });

  if(placasCaja)placasCaja.addEventListener('click',e=>{
    const b=e.target.closest('[data-sv-placa]');
    if(!b||b.disabled)return;
    /* El doble toque del impaciente: abre un paquete, no ve reaccionar y toca
       otra vez. Entre toque y toque la página ya reflowó y el «+» quedó bajo
       su dedo — sin esta ventana, ese segundo toque sumaba una placa que nadie
       pidió. 350 ms: más que el desplazamiento, menos de lo que tarda una
       decisión de verdad. */
    if(performance.now()-asentada<350)return;
    placas=Math.min(PLACAS_MAX,Math.max(0,placas+Number(b.dataset.svPlaca)));
    /* La cuenta se guarda para la vuelta desde Mercado Pago SIN bfcache: el
       navegador restaura el radio marcado (está en el formulario) pero
       `placas` vive en el script y renacía en cero — la pantalla decía $1,150
       donde el comprador dejó $1,650, sin explicación. */
    try{sessionStorage.setItem('syc_placas',String(placas));}catch(_){}
    pinta();
  });

  form.addEventListener('change',e=>{
    if(e.target.name==='ficha_tiene')ajusta();
    else if(e.target.name==='paquete'){
      pinta();
      /* AHORA sí, a los datos: ya está decidido qué se compra y cómo se paga,
         y lo único que queda es escribir. */
      lleva(datos);
    }
  });

  /* El estado de partida lo monta `abre`, que además llama a `pinta`. Si el
     navegador restauró un paquete marcado —volver atrás—, se reabre el suyo en
     vez de cerrarlo todo y dejar al visitante sin su elección. */
  function arranca(){
    const m=ops.find(o=>o.checked);
    /* Un radio ya marcado al arrancar es el navegador restaurando el
       formulario —volver atrás desde el cobro sin bfcache—. Sólo entonces se
       restaura también la cuenta de placas: en una visita limpia no hay radio
       marcado y las placas nacen en cero, como siempre. */
    if(m){
      try{placas=Math.min(PLACAS_MAX,Math.max(0,
        Number(sessionStorage.getItem('syc_placas'))||0));}catch(_){}
    }
    abre(m?(m.closest('.sv-plan')||{}).dataset.plan||null:null);
    ajusta();
  }
  arranca();

  /* ⚠ AL VOLVER ATRÁS DESDE MERCADO PAGO. El navegador restaura el formulario
     con su paquete todavía marcado, pero de la caché de páginas (bfcache) no
     vuelve a ejecutar el script: `datos` se quedaba escondido, y con él el
     botón de pagar. Resultado: un paquete elegido y ninguna forma de pagarlo —
     un callejón sin salida en la pantalla de cobro, que es el peor sitio donde
     puede haberlo.
     `pageshow` es el evento que sí llega en ese caso; `load` no. */
  addEventListener('pageshow',arranca);

  /* El pedido se guarda para gracias.html en sessionStorage y no en la
     dirección: así no queda un pedido con nombre y teléfono dentro del
     historial del navegador ni en la pestaña que se quedó abierta. */
  /* ⚠ Y SI AUN ASÍ SE PULSA SIN HABER ELEGIDO, SE LLEVA A LAS OPCIONES.
     El globo que saca el navegador se dibuja sobre el control inválido, y aquí
     los círculos de verdad miden CERO píxeles y son transparentes —lo que se
     ve y se toca es la tarjeta entera, que es como se diseñó—. Un globo sobre
     un punto sin tamaño acaba en cualquier sitio de la pantalla, o en ninguno.

     `invalid` NO burbujea: hay que escucharlo en fase de captura sobre el
     formulario. `preventDefault()` sólo quita el globo; el envío sigue
     bloqueado, que es lo correcto — no se paga sin elegir cómo. */
  let pidiendo=false;
  form.addEventListener('invalid',e=>{
    if(e.target.name!=='paquete')return;
    e.preventDefault();
    /* Los cuatro radios avisan a la vez; el salto y el aviso, una sola vez. */
    if(pidiendo)return;
    pidiendo=true;
    setTimeout(()=>{pidiendo=false;},0);
    const abierto=form.querySelector('.sv-plan.abierto');
    const pagos=abierto&&abierto.querySelector('.sv-pagos');
    lleva(pagos||abierto||form.querySelector('.sv-plan'));
    if(pagos){
      /* Un salto sin nada que mirar al llegar se lee como que la página se
         movió sola. Se reinicia la animación por si se pulsa dos veces. */
      pagos.classList.remove('pide');
      void pagos.offsetWidth;
      pagos.classList.add('pide');
    }
    /* Y dicho, para quien no ve la pantalla: el salto no le dice nada. */
    if(aviso)aviso.textContent='Falta elegir c\u00f3mo lo pagas.';
  },true);

  form.addEventListener('submit',()=>{
    const m=ops.find(o=>o.checked);
    if(!m)return;
    /* ⚠ EL ENTERO, NO EL TEXTO. Aquí se guardaba `data-tot` —«$1,490», ya con
       su coma— y gracias.html lo vuelve a formatear con `Number(v)`, que sobre
       eso da NaN: el comprador leía «$NaN» en el resumen de lo que acababa de
       pagar. `data-num` es el mismo importe en crudo. */
    /* El total INCLUYE las placas —es lo que se acaba de pagar— y `_placas`
       viaja aparte: gracias-servicio.html le pinta su fila («te escribimos
       para acordar la entrega») y la mete en el WhatsApp redactado. El resto
       del anticipo NO cambia con placas: se pagan hoy, no se deben. */
    const d={_servicio:1,
             _t:(m.dataset.que||'')+(placas?' + '+placas+' placa'+(placas>1?'s':''):''),
             _tot:(Number(m.dataset.num)+extraPlacas())||''};
    if(placas)d._placas=placas;
    /* Y lo que falta por cobrar, para que la página de gracias pueda decirlo:
       quien deja un anticipo se va sin saber cuánto debe si nadie se lo dice. */
    if(m.dataset.resto)d._resto=Number(m.dataset.resto)||'';
    /* TODOS los campos con nombre, salvo el paquete —que ya va en `_t`—. Cada
       familia tiene los suyos (la ficha en Google, el giro en la web, la tarea
       en la automatización) y la página de gracias pinta los que traigan algo:
       una lista escrita aquí se quedaría corta con la primera página nueva. De
       un grupo de radios se guarda sólo el marcado. */
    for(const c of form.querySelectorAll('[name]')){
      const n=c.name;
      if(!n||n==='paquete')continue;
      if(c.type==='radio'){if(c.checked)d[n]=c.value;continue;}
      d[n]=c.value;
    }
    /* La familia, para que la página de gracias sepa qué paso sigue: el correo
       de administrador en Google, el material en la web, la llamada en la
       automatización. La escribe el marcado de cada página. */
    d._fam=form.dataset.svFamilia||'';
    try{sessionStorage.setItem('syc_pedido',JSON.stringify(d));}catch(_){}
  });
})();
