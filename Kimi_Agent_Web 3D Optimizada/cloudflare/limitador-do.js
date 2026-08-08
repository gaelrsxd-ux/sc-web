/**
 * Limitador de tasa atómico — Durable Object con almacenamiento SQLite
 *
 * Por qué existe, cómo funciona y qué NO cubre está en LIMITADOR.md, junto al
 * resto de la documentación. Aquí sólo lo imprescindible para no romperlo.
 *
 * La atomicidad sale de dos cosas, y conviene no confundirlas:
 *   1. El objeto es único en todo el mundo para un nombre dado y su runtime es
 *      monohilo, así que las peticiones de una misma identidad se serializan.
 *   2. La sección crítica corre dentro de `transactionSync`, que es SÍNCRONA.
 *
 * La regla que sostiene todo: NINGÚN `await` dentro de la transacción. No es un
 * consejo de estilo. Un `await` ahí devuelve exactamente el fallo que este
 * archivo vino a arreglar —40 peticiones simultáneas leyendo el mismo cero— y
 * está demostrado con una prueba de mutación en test/concurrencia.test.mjs.
 */

import { DurableObject } from 'cloudflare:workers';

/* Tiene que coincidir con VENTANA_MS de seo-audit.js. La limpieza no lee el
   argumento de `consume` porque `alarm()` se ejecuta casi siempre en una
   instancia rehidratada, donde cualquier campo en memoria vale ya su valor
   inicial: una constante honesta es mejor que un campo que parece configurable
   y no lo es. */
const VENTANA_REF_MS = 60_000;

/* Si la alarma saltara justo al cumplirse la ventana encontraría la última
   marca todavía viva y tendría que reprogramarse en bucle. */
const MARGEN_LIMPIEZA_MS = 30_000;

/* Tope duro de filas. La purga por tiempo ya acota la tabla a `tope` marcas,
   pero esto es el cinturón por si una ventana enorme o un reloj raro dejaran
   crecer el estado: el coste de un DELETE de más es irrelevante y el de una
   tabla sin techo, no. */
const FILAS_MAX = 100;

export class LimitadorIP extends DurableObject {
  #alarmaPuesta = false;

  constructor(ctx, env) {
    super(ctx, env);
    /* `sql.exec` es síncrono, así que la tabla existe antes de que el
       constructor devuelva y el runtime no entrega ninguna petición hasta
       entonces. Envolverlo en blockConcurrencyWhile sólo añadiría un punto de
       suspensión donde hoy no hay ninguno. */
    this.#creaTabla();
  }

  #creaTabla() {
    /* Sin índice sobre ts: cada actualización de índice se factura como fila
       escrita extra y con 20 filas el escaneo completo sale más barato. */
    this.ctx.storage.sql.exec('CREATE TABLE IF NOT EXISTS golpes (ts INTEGER NOT NULL)');
  }

  /**
   * Única superficie pública y por tanto lo único que expone el RPC.
   * Devuelve siempre { ok: true, permitido, restantes, esperaS }.
   *
   * El `ok: true` no es decorativo: el Worker falla CERRADO, así que necesita
   * poder distinguir "el limitador contestó y decidió" de "llegó cualquier otra
   * cosa". Sin una marca explícita, un `undefined` por un fallo de la
   * plataforma sería indistinguible de una respuesta legítima.
   */
  async consume(tope, ventanaMs) {
    /* Los dos rangos se acotan a lo que la implementación sostiene de verdad, y
       no a lo que suena razonable. Ambos límites vienen de fallos medidos:

       - Un `tope` mayor que FILAS_MAX volvía el limitador ILIMITADO: la purga de
         cinturón deja siempre las 100 filas más nuevas, así que `usados` nunca
         llegaba al tope y todo se aceptaba. Comprobado con tope=101 y tope=200:
         400 de 400 permitidas.
       - Una `ventanaMs` mayor que la de referencia hacía que la alarma borrara
         datos VIVOS, porque la limpieza mide con VENTANA_REF_MS. Comprobado con
         ventana de 10 minutos: a los ~90 s el contador se reseteaba solo.

       Acotar en vez de rechazar es deliberado: el único llamante es nuestro
       Worker y siempre pasa los valores correctos, así que esto es un cinturón
       para el futuro, y un cinturón no debe tumbar el servicio. */
    const t = Number.isInteger(tope) && tope > 0 && tope <= FILAS_MAX ? tope : 20;
    const w = Number.isInteger(ventanaMs) && ventanaMs >= 100 && ventanaMs <= VENTANA_REF_MS
      ? ventanaMs : VENTANA_REF_MS;

    const veredicto = this.#seccionCritica(t, w);

    /* El cable trampa que el runtime NO pone. `transactionSync` acepta un
       callback `async` sin quejarse: devuelve la Promise, `consume` la asimila
       por ser async, y el Worker recibe una respuesta de forma impecable. La
       atomicidad desaparece sin una sola excepción ni aviso de wrangler.
       Comprobado: con esa mutación, 100 simultáneas permiten 100.
       La documentación de Cloudflare exige que el callback sea síncrono, pero
       no lo impone; esto sí. Cuesta una comparación y convierte un fallo mudo
       en un fallo cerrado. */
    if (veredicto && typeof veredicto.then === 'function') {
      throw new Error('la sección crítica devolvió una promesa: no es atómica');
    }

    /* Sólo aquí se puede ceder el turno: el veredicto ya está decidido y las
       filas escritas. La limpieza es higiene de facturación; que falle no puede
       convertirse en un error que tumbe el diagnóstico. */
    try {
      await this.#programaLimpieza();
    } catch {
      /* se reintenta en la siguiente petición, ver #programaLimpieza */
    }

    return veredicto;
  }

  /**
   * SECCIÓN CRÍTICA. Todo dentro de `transactionSync` y sin un solo `await`.
   *
   * Hoy `sql.exec` ya es síncrono, así que estrictamente la transacción no
   * añade exclusión: la añade la ausencia de puntos de suspensión. Está aquí
   * porque marca la frontera de forma explícita y verificable —quien meta un
   * `await` dentro tiene que convertir esta función en `async` y romper la
   * llamada de arriba— y porque agrupa las tres sentencias en una unidad que
   * revierte entera si una falla. Sin ella, un fallo en el INSERT dejaría el
   * DELETE aplicado y la ventana medio borrada.
   */
  #seccionCritica(tope, ventanaMs) {
    return this.ctx.storage.transactionSync(() => {
      /* `deleteAll()` de la alarma se lleva también el esquema, y la instancia
         puede seguir viva. Comprobarlo aquí cuesta nada. */
      this.#creaTabla();

      const sql = this.ctx.storage.sql;
      const ahora = Date.now();
      const corte = ahora - ventanaMs;

      /* Purga perezosa: mantiene la tabla acotada sin depender de que la alarma
         llegue a tiempo. La limpieza correcta no puede delegarse en un
         temporizador que puede fallar. */
      sql.exec('DELETE FROM golpes WHERE ts <= ?', corte);

      /* Tras el DELETE todo lo que queda está vivo por definición. */
      const usados = Number(sql.exec('SELECT COUNT(*) AS n FROM golpes').one().n);

      if (usados >= tope) {
        /* Al rechazar NO se inserta. Contar los rechazos convertiría a quien
           martillea en un bloqueo permanente —injusto cuando la IP es
           compartida, que es el caso de cualquier oficina o CGNAT— y dispara la
           única métrica que escala mal en la factura: las filas escritas. */
        const masViejo = Number(sql.exec('SELECT MIN(ts) AS t FROM golpes').one().t);
        const esperaMs = Math.max(0, masViejo + ventanaMs - ahora);
        return { ok: true, permitido: false, restantes: 0, esperaS: Math.ceil(esperaMs / 1000) || 1 };
      }

      sql.exec('INSERT INTO golpes (ts) VALUES (?)', ahora);

      if (usados + 1 > FILAS_MAX) {
        sql.exec(
          'DELETE FROM golpes WHERE rowid NOT IN (SELECT rowid FROM golpes ORDER BY ts DESC LIMIT ?)',
          FILAS_MAX
        );
      }

      return { ok: true, permitido: true, restantes: tope - usados - 1, esperaS: 0 };
    });
  }

  /** Una sola alarma por encarnación. La bandera se marca DESPUÉS de que
   *  `setAlarm` haya salido bien: marcarla antes dejaba el objeto sin alarma
   *  para siempre si la operación fallaba, porque la guarda impedía reintentar. */
  async #programaLimpieza() {
    if (this.#alarmaPuesta) return;
    if ((await this.ctx.storage.getAlarm()) === null) {
      await this.ctx.storage.setAlarm(Date.now() + VENTANA_REF_MS + MARGEN_LIMPIEZA_MS);
    }
    this.#alarmaPuesta = true;
  }

  /**
   * Borra el estado cuando la identidad deja de pedir. Sin esto, cada identidad
   * que pasa por aquí deja sus marcas dentro para siempre y el almacenamiento
   * crece con el número de identidades distintas sin bajar nunca.
   *
   * Las alarmas se entregan "al menos una vez" y se reintentan solas con espera
   * creciente, así que esto puede ejecutarse más de una vez y tiene que
   * aguantarlo. Y puede llegar en una instancia rehidratada cuya tabla ya no
   * exista, porque `deleteAll()` se lleva el esquema: de ahí el CREATE.
   */
  async alarm() {
    try {
      const quedan = this.ctx.storage.transactionSync(() => {
        this.#creaTabla();
        const sql = this.ctx.storage.sql;
        sql.exec('DELETE FROM golpes WHERE ts <= ?', Date.now() - VENTANA_REF_MS);
        return Number(sql.exec('SELECT COUNT(*) AS n FROM golpes').one().n);
      });

      if (quedan > 0) {
        /* Siguen llegando peticiones: se vuelve a dormir en vez de borrar datos
           vivos. Esto es lo que permite programar la alarma una sola vez por
           encarnación y que aun así nunca borre de más. */
        this.#alarmaPuesta = false;
        await this.ctx.storage.setAlarm(Date.now() + VENTANA_REF_MS + MARGEN_LIMPIEZA_MS);
        return;
      }

      await this.ctx.storage.deleteAll();
      this.#alarmaPuesta = false;
    } catch {
      /* NO se delega el reintento en el runtime, aunque lo parezca. Cloudflare
         sólo reintenta una alarma que termina con una excepción SIN capturar;
         capturarla y volver normalmente la da por buena y cancela el reintento.
         Y hay dos ramas de fallo que salen de aquí sin haber puesto la bandera
         a false, así que la guarda de #programaLimpieza impedía volver a
         programar nada durante el resto de la vida del objeto: la limpieza
         moría en silencio y el almacenamiento de esa identidad no se liberaba
         nunca. Se restaura el estado y se reprograma a mano. */
      this.#alarmaPuesta = false;
      try {
        await this.ctx.storage.setAlarm(Date.now() + VENTANA_REF_MS + MARGEN_LIMPIEZA_MS);
      } catch {
        /* Si tampoco se puede reprogramar, lo recoge la siguiente petición:
           #programaLimpieza vuelve a intentarlo con la bandera ya en false. */
      }
    }
  }
}
