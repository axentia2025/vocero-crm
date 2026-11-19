# Historia: equipo de ventas por vendedor

Cada integrante del equipo (`member`) trabaja SOLO sus contactos; el
propietario (`owner`) ve todo concentrado, filtra por vendedor y reasigna.
Reglas en `src/lib/equipo.ts` y `src/server/equipo/`.

## Automatizado

- `tests/unit/equipo-reglas.test.ts` — reglas puras (filtro, ficha sin dinero,
  Resultados sin montos, avisos en tiempo real).
- `tests/unit/equipo-guardias.test.ts` — cada ruta de `/api` está clasificada
  (del propietario, por id con visibilidad, lista filtrada o abierta).
- `tests/unit/equipo-integracion.test.ts` — contra un Postgres REAL y
  desechable (la borra entera):

  ```bash
  TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/vocero_test pnpm test
  ```

## A mano, con la app viva (verificado el 19-nov-2026)

Cuentas: Omar (propietario), Emiliano y Juan (creados en Ajustes → Equipo).
Un contacto de cada quien y uno que llega solo por WhatsApp (sin dueño).

Como **Emiliano**:
1. El menú muestra Bandeja, Pipeline, Contactos y Resultados. No hay Guía,
   Agente, Laboratorio ni Ajustes; `/settings/*`, `/agent` y `/lab` regresan a
   la Bandeja.
2. Contactos: solo los suyos. Sin «Importar», «Ver archivados», archivar,
   borrar ni «Escribir primero».
3. Editar: «Vendedor» fijo con su nombre; sin Comisión, Costo de
   implementación ni Costo mensual; sin «El agente no le responde».
4. Registrar un teléfono que ya es de otro: avisa que ya está registrado, sin
   decir de quién.
5. Pipeline: solo sus tratos, sin montos ni totales, sin «Gestionar etapas».
6. Resultados: sus conteos, sin «Dinero ganado» ni «Ticket promedio», sin las
   secciones de anuncios y del agente.
7. Bandeja: solo las conversaciones de sus contactos; la caja solo guarda
   notas internas; sin interruptor de la IA; la ficha no muestra dinero.

Como **Omar**:
1. Contactos, Pipeline y Resultados con «Vendedor: todos / cada quien / sin
   asignar»; la elección se conserva entre pantallas.
2. Cada contacto y tarjeta dice su vendedor; ve y captura montos y comisión.
3. Editar → Vendedor: asignar el contacto de WhatsApp a Emiliano. Emiliano lo
   ve en su lista y en su Bandeja, y empieza a recibir sus avisos en vivo;
   Juan no.
