import { describe, expect, it } from "vitest";
import { PgDialect } from "drizzle-orm/pg-core";
import { schema } from "@/lib/db";
import {
  fichaParaRol,
  filtroVendedor,
  parcheDeFichaPermitido,
} from "@/lib/equipo";
import {
  sinMontosHigiene,
  sinMontosVentas,
  type HygieneBlockDto,
  type SalesBlockDto,
} from "@/lib/analytics";
import { condicionContacto, condicionPorContacto } from "@/server/equipo/acceso";
import { crearFiltroDeEventos } from "@/server/equipo/eventos";

/**
 * El equipo de ventas: las reglas puras de quién ve qué. Lo que toca la base
 * de verdad está en equipo-integracion.test.ts (con un Postgres real).
 */

const dialecto = new PgDialect();
const render = (s: Parameters<PgDialect["sqlToQuery"]>[0]) => dialecto.sqlToQuery(s);

describe("filtro por vendedor", () => {
  it("un integrante ve solo lo suyo, pida lo que pida en la URL", () => {
    const yo = { userId: "usr_emi", role: "member" };
    for (const pedido of [undefined, null, "", "todos", "sin", "usr_omar"]) {
      expect(filtroVendedor(yo, pedido)).toEqual({ tipo: "de", userId: "usr_emi" });
    }
  });

  it("el propietario ve todo, o lo de un vendedor, o lo sin asignar", () => {
    const omar = { userId: "usr_omar", role: "owner" };
    expect(filtroVendedor(omar)).toEqual({ tipo: "todos" });
    expect(filtroVendedor(omar, "todos")).toEqual({ tipo: "todos" });
    expect(filtroVendedor(omar, "sin")).toEqual({ tipo: "sinAsignar" });
    expect(filtroVendedor(omar, "usr_emi")).toEqual({ tipo: "de", userId: "usr_emi" });
    // `admin` es rol de configuración: ve como el propietario.
    expect(filtroVendedor({ userId: "a", role: "admin" })).toEqual({ tipo: "todos" });
  });

  it("en SQL: el dueño del contacto, o sin dueño, o nada que filtrar", () => {
    expect(condicionContacto({ tipo: "todos" })).toBeUndefined();
    const de = render(condicionContacto({ tipo: "de", userId: "usr_emi" })!);
    expect(de.sql).toContain('"owner_user_id" = $1');
    expect(de.params).toEqual(["usr_emi"]);
    expect(render(condicionContacto({ tipo: "sinAsignar" })!).sql).toContain(
      '"owner_user_id" is null'
    );
  });

  it("las tablas que cuelgan de un contacto se filtran por su dueño", () => {
    expect(condicionPorContacto({ tipo: "todos" }, schema.lead.contactId)).toBeUndefined();
    const q = render(
      condicionPorContacto({ tipo: "de", userId: "usr_emi" }, schema.booking.contactId)!
    );
    expect(q.sql).toMatch(/exists \(\s*select 1 from "contact" dueno/);
    expect(q.sql).toContain('dueno."owner_user_id" =');
    expect(q.params).toEqual(["usr_emi"]);
  });
});

describe("la ficha según quién mira", () => {
  const ficha = {
    empresa: "Ternium",
    vendedor: "lo que alguien tecleó",
    comision: "30%",
    costoImplementacion: "$1,200,000",
    costoMensual: "$80,000",
    servicios: "Ingesta de documentos",
  };

  it("un integrante no ve comisión ni montos; «Vendedor» sale del dueño", () => {
    expect(fichaParaRol(ficha, "member", "Emiliano")).toEqual({
      empresa: "Ternium",
      servicios: "Ingesta de documentos",
      vendedor: "Emiliano",
    });
  });

  it("el propietario ve todo; sin dueño no hay «Vendedor»", () => {
    expect(fichaParaRol(ficha, "owner", null)).toEqual({
      empresa: "Ternium",
      comision: "30%",
      costoImplementacion: "$1,200,000",
      costoMensual: "$80,000",
      servicios: "Ingesta de documentos",
    });
  });

  it("lo que un integrante manda de dinero o de vendedor se descarta", () => {
    const parche = {
      empresa: "Otra",
      comision: null,
      costoImplementacion: null,
      costoMensual: "$1",
      vendedor: "Yo mero",
      fechaFirma: "2026-11-19",
    };
    expect(parcheDeFichaPermitido(parche, "member")).toEqual({
      empresa: "Otra",
      fechaFirma: "2026-11-19",
    });
    // El propietario sí captura el dinero, pero «Vendedor» tampoco lo teclea:
    // se cambia reasignando el contacto.
    expect(parcheDeFichaPermitido(parche, "owner")).toEqual({
      empresa: "Otra",
      comision: null,
      costoImplementacion: null,
      costoMensual: "$1",
      fechaFirma: "2026-11-19",
    });
  });
});

describe("Resultados sin dinero para un integrante", () => {
  it("ventas: conserva los conteos y borra los montos", () => {
    const b = {
      kpis: {
        newLeads: { current: 3, previous: 1 },
        won: { current: 1, previous: 0 },
        lost: { current: 0, previous: 0 },
        wonCents: { current: 120_000_000, previous: 5 },
        winRate: { value: 1, numerator: 1, denominator: 1 },
        avgTicketCents: 120_000_000,
      },
      pipeline: { openCents: 99, withoutAmount: 2, otherCurrency: 1 },
      series: [{ bucket: "2026-11-19", newLeads: 3, won: 1, wonCents: 120_000_000 }],
    } as unknown as SalesBlockDto;
    const r = sinMontosVentas(b);
    expect(r.kpis.newLeads).toEqual({ current: 3, previous: 1 });
    expect(r.kpis.won.current).toBe(1);
    expect(r.kpis.wonCents).toEqual({ current: 0, previous: 0 });
    expect(r.kpis.avgTicketCents).toBeNull();
    expect(r.pipeline.openCents).toBe(0);
    expect(r.series[0]).toEqual({ bucket: "2026-11-19", newLeads: 3, won: 1, wonCents: 0 });
    expect(r.montosOcultos).toBe(true);
    expect(JSON.stringify(r)).not.toContain("120000000");
  });

  it("pendientes: la lista sin montos", () => {
    const b = {
      silent: [{ leadId: "l", contactId: "c", name: "GG", days: 9, amountCents: 500 }],
      silentCount: 1,
      silentAmountCents: 500,
      failedMessages: [],
      closingWindows: [],
      clean: false,
    } as HygieneBlockDto;
    const r = sinMontosHigiene(b);
    expect(r.silent[0]!.amountCents).toBeNull();
    expect(r.silentAmountCents).toBe(0);
    expect(r.montosOcultos).toBe(true);
  });
});

describe("avisos en tiempo real para un integrante", () => {
  const mias = new Set(["cv_mia"]);
  const citas = new Set(["bk_mia"]);
  const consultas = {
    conversacion: async (id: string) => mias.has(id),
    cita: async (id: string) => citas.has(id),
  };

  it("solo pasan los de SUS conversaciones y citas", async () => {
    const filtro = crearFiltroDeEventos(consultas);
    const msg = (conversationId: string) => ({
      type: "message.new" as const,
      data: { conversationId, message: { text: "precio: $1.2 M" } },
    });
    expect(await filtro(msg("cv_mia"))).toBe(true);
    expect(await filtro(msg("cv_de_otro"))).toBe(false);
    expect(
      await filtro({ type: "conversation.updated", data: { conversation: { id: "cv_de_otro" } } })
    ).toBe(false);
    expect(
      await filtro({ type: "note.new", data: { conversationId: "cv_mia", note: {} } })
    ).toBe(true);
    expect(await filtro({ type: "booking.updated", data: { bookingId: "bk_mia" } })).toBe(true);
    expect(await filtro({ type: "booking.updated", data: { bookingId: "bk_otra" } })).toBe(false);
    expect(
      await filtro({
        type: "lab.run",
        data: { runId: "r", status: "done", progress: { done: 1, total: 1 } },
      })
    ).toBe(false);
  });

  it("recuerda unos segundos y vuelve a preguntar (una reasignación llega)", async () => {
    let t = 0;
    let llamadas = 0;
    let esMia = false;
    const filtro = crearFiltroDeEventos(
      {
        conversacion: async () => {
          llamadas++;
          return esMia;
        },
        cita: async () => false,
      },
      { ttlMs: 1000, ahora: () => t }
    );
    const ev = { type: "message.status" as const, data: { conversationId: "cv", messageId: "m", status: "read" } };
    expect(await filtro(ev)).toBe(false);
    expect(await filtro(ev)).toBe(false);
    expect(llamadas).toBe(1);
    esMia = true; // el propietario se la asignó
    t = 1500;
    expect(await filtro(ev)).toBe(true);
    expect(llamadas).toBe(2);
  });

  it("si la consulta falla, no se manda", async () => {
    const filtro = crearFiltroDeEventos({
      conversacion: async () => {
        throw new Error("sin base");
      },
      cita: async () => true,
    });
    expect(
      await filtro({ type: "message.new", data: { conversationId: "cv", message: {} } })
    ).toBe(false);
  });
});
