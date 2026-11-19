import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";

/**
 * El equipo de ventas contra un Postgres DE VERDAD: las rutas de la API, tal
 * cual corren en producción, con tres cuentas —Omar (propietario), Emiliano y
 * Juan (integrantes)— y un contacto que llegó solo por WhatsApp.
 *
 * Demuestra que un integrante NO puede leer ni modificar los contactos de
 * otro (ni su trato, su conversación, sus notas, sus adjuntos ni sus citas),
 * ni ver el dinero, ni tocar lo que es del propietario; y que el propietario
 * lo ve todo, filtra por vendedor y reasigna.
 *
 * Necesita una base VACÍA y desechable (la borra entera al empezar):
 *
 *   TEST_DATABASE_URL=postgres://postgres@127.0.0.1:54329/vocero_test pnpm test
 *
 * Sin `TEST_DATABASE_URL` se salta (CI no tiene base); las reglas puras y la
 * clasificación de rutas corren siempre (equipo-reglas, equipo-guardias).
 */

const TEST_URL = process.env.TEST_DATABASE_URL;

type Sesion = { userId: string; organizationId: string; role: string };
const estado = vi.hoisted(() => ({ sesion: null as Sesion | null }));

vi.mock("@/lib/auth/session", async (original) => {
  const m = await original<typeof import("@/lib/auth/session")>();
  return {
    ...m,
    requireSession: async () => {
      if (!estado.sesion) throw new m.UnauthorizedError();
      return estado.sesion;
    },
    getSessionOrNull: async () => estado.sesion,
  };
});

const ORG = "org_axentia";
const OMAR = { userId: "usr_omar", organizationId: ORG, role: "owner" };
const EMI = { userId: "usr_emi", organizationId: ORG, role: "member" };
const JUAN = { userId: "usr_juan", organizationId: ORG, role: "member" };
const como = (s: Sesion | null) => {
  estado.sesion = s;
};

type Handler = (req: Request, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function llamar(
  handler: unknown,
  url: string,
  opciones: { method?: string; body?: unknown; params?: Record<string, string> } = {}
) {
  const init: RequestInit = { method: opciones.method ?? "GET" };
  if (opciones.body !== undefined) {
    init.headers = { "content-type": "application/json" };
    init.body = JSON.stringify(opciones.body);
  }
  const res = await (handler as Handler)(new Request(`http://localhost${url}`, init), {
    params: Promise.resolve(opciones.params ?? {}),
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    body = text;
  }
  return { status: res.status, body: body as Record<string, unknown> };
}

/* eslint-disable @typescript-eslint/no-explicit-any */
let sql: any;
let api: Record<string, any> = {};

describe.skipIf(!TEST_URL)("equipo de ventas contra Postgres real", () => {
  beforeAll(async () => {
    // El entorno mínimo que valida `getEnv()`; la base es la desechable.
    process.env.DATABASE_URL = TEST_URL!;
    process.env.APP_BASE_URL = "http://localhost:3000";
    process.env.BETTER_AUTH_SECRET = "secreto-de-prueba-equipo-0123456789";
    process.env.ENCRYPTION_KEY = Buffer.alloc(32, 7).toString("base64");
    process.env.META_WEBHOOK_VERIFY_TOKEN = "verificar-equipo";
    process.env.AGENDA = "on";
    delete process.env.LIBRADA_WEBHOOK_URL;

    const postgres = (await import("postgres")).default;
    const { drizzle } = await import("drizzle-orm/postgres-js");
    const { migrate } = await import("drizzle-orm/postgres-js/migrator");
    sql = postgres(TEST_URL!, { max: 1, onnotice: () => {}, connection: { TimeZone: "UTC" } });
    await sql`drop schema if exists public cascade`;
    await sql`create schema public`;
    await sql`drop schema if exists drizzle cascade`;
    await migrate(drizzle(sql), { migrationsFolder: "drizzle" });

    // Tres cuentas y un negocio.
    await sql`insert into "user"(id, name, email) values
      ('usr_omar', 'Omar', 'omar@prueba.test'),
      ('usr_emi', 'Emiliano', 'emi@prueba.test'),
      ('usr_juan', 'Juan', 'juan@prueba.test'),
      ('usr_fuera', 'De otra empresa', 'fuera@prueba.test')`;
    await sql`insert into organization(id, name) values (${ORG}, 'Axentia'), ('org_otra', 'Otra')`;
    await sql`insert into member(id, organization_id, user_id, role) values
      ('mb_omar', ${ORG}, 'usr_omar', 'owner'),
      ('mb_emi', ${ORG}, 'usr_emi', 'member'),
      ('mb_juan', ${ORG}, 'usr_juan', 'member'),
      ('mb_fuera', 'org_otra', 'usr_fuera', 'owner')`;
    await sql`insert into pipeline_stage(id, organization_id, name, position, kind) values
      ('st_int', ${ORG}, 'Interesado', 0, 'open'),
      ('st_poc', ${ORG}, 'POC', 1, 'open'),
      ('st_won', ${ORG}, 'Ganado', 2, 'won'),
      ('st_lost', ${ORG}, 'Perdido', 3, 'lost')`;

    // Un contacto de cada quien, y uno que llegó solo por WhatsApp.
    const ficha = (vendedor: string | null) =>
      JSON.stringify({
        empresa: "Empresa",
        ...(vendedor ? { vendedor } : {}),
        comision: "30%",
        costoImplementacion: "$1,200,000",
        costoMensual: "$80,000",
      });
    await sql`insert into contact(id, organization_id, wa_identity, phone, name, owner_user_id, ficha) values
      ('ct_omar', ${ORG}, '525500000001', '525500000001', 'Ternium', 'usr_omar', ${ficha("Omar")}::jsonb),
      ('ct_emi', ${ORG}, '525500000002', '525500000002', 'Prospecto de Emiliano', 'usr_emi', ${ficha("Emiliano")}::jsonb),
      ('ct_juan', ${ORG}, '525500000003', '525500000003', 'Prospecto de Juan', 'usr_juan', ${ficha("Juan")}::jsonb),
      ('ct_wa', ${ORG}, '525500000004', '525500000004', 'Llegó por WhatsApp', null, null)`;
    for (const q of ["omar", "emi", "juan", "wa"]) {
      await sql`insert into lead(id, organization_id, contact_id, stage_id, amount_cents, currency)
        values (${"ld_" + q}, ${ORG}, ${"ct_" + q}, 'st_int', 120000000, 'MXN')`;
      await sql`insert into lead_stage_event(id, organization_id, lead_id, contact_id, to_stage_id, to_stage_name, to_stage_kind)
        values (${"ev_" + q}, ${ORG}, ${"ld_" + q}, ${"ct_" + q}, 'st_int', 'Interesado', 'open')`;
      await sql`insert into conversation(id, organization_id, contact_id, last_inbound_at, last_message_at)
        values (${"cv_" + q}, ${ORG}, ${"ct_" + q}, now(), now())`;
      await sql`insert into message(id, organization_id, conversation_id, direction, text, status)
        values (${"msg_" + q}, ${ORG}, ${"cv_" + q}, 'in', ${"Hola, soy " + q}, 'delivered')`;
    }
    await sql`insert into media_asset(id, organization_id, kind, mime_type, fetch_status, storage_path)
      values ('ma_juan', ${ORG}, 'image', 'image/png', 'available', 'no-existe.png')`;
    await sql`update message set media_asset_id = 'ma_juan' where id = 'msg_juan'`;
    await sql`insert into conversation_note(id, organization_id, conversation_id, author_user_id, texto)
      values ('nt_juan', ${ORG}, 'cv_juan', 'usr_juan', 'Le ofrecí 5 % de descuento')`;
    await sql`insert into booking(id, organization_id, kind, status, source, contact_id, conversation_id, scheduled_at, duration_minutes)
      values ('bk_juan', ${ORG}, 'session', 'agendada', 'manual', 'ct_juan', 'cv_juan', now() + interval '2 days', 30),
             ('bk_emi', ${ORG}, 'session', 'agendada', 'manual', 'ct_emi', 'cv_emi', now() + interval '3 days', 30),
             ('bk_bloqueo', ${ORG}, 'block', 'agendada', 'manual', null, null, now() + interval '1 day', 60)`;

    api = {
      contacts: await import("@/app/api/contacts/route"),
      contact: await import("@/app/api/contacts/[id]/route"),
      importar: await import("@/app/api/contacts/import/route"),
      board: await import("@/app/api/pipeline/board/route"),
      lead: await import("@/app/api/pipeline/leads/[id]/route"),
      stages: await import("@/app/api/pipeline/stages/route"),
      conversations: await import("@/app/api/conversations/route"),
      conversation: await import("@/app/api/conversations/[id]/route"),
      messages: await import("@/app/api/conversations/[id]/messages/route"),
      notes: await import("@/app/api/conversations/[id]/notes/route"),
      note: await import("@/app/api/conversations/[id]/notes/[noteId]/route"),
      media: await import("@/app/api/media/[assetId]/route"),
      bookings: await import("@/app/api/bookings/route"),
      booking: await import("@/app/api/bookings/[id]/route"),
      sales: await import("@/app/api/analytics/sales/route"),
      hygiene: await import("@/app/api/analytics/hygiene/route"),
      bot: await import("@/app/api/analytics/bot/route"),
      team: await import("@/app/api/settings/team/route"),
      whatsapp: await import("@/app/api/settings/whatsapp/route"),
      agente: await import("@/app/api/agent/profile/route"),
      equipoAcceso: await import("@/server/equipo/acceso"),
    };
  }, 60_000);

  afterAll(async () => {
    if (!TEST_URL) return;
    await (await import("@/lib/db")).getSql().end();
    await sql?.end();
  });

  const ids = (r: { body: Record<string, unknown> }, lista: string) =>
    ((r.body[lista] as { id: string }[]) ?? []).map((x) => x.id).sort();

  /* ── Leer ─────────────────────────────────────────────────────── */

  it("un integrante lista solo sus contactos, aunque pida los de otro", async () => {
    como(EMI);
    expect(ids(await llamar(api.contacts.GET, "/api/contacts"), "contacts")).toEqual(["ct_emi"]);
    for (const q of ["?vendedor=usr_juan", "?vendedor=todos", "?vendedor=sin", "?q=Juan"]) {
      const r = await llamar(api.contacts.GET, `/api/contacts${q}`);
      expect(ids(r, "contacts"), q).toEqual(q === "?q=Juan" ? [] : ["ct_emi"]);
    }
  });

  it("el contacto de otro vendedor no existe para él (404), ni por id", async () => {
    como(EMI);
    for (const id of ["ct_juan", "ct_omar", "ct_wa"]) {
      const r = await llamar(api.contact.GET, `/api/contacts/${id}`, { params: { id } });
      expect(r.status, id).toBe(404);
      expect(JSON.stringify(r.body)).not.toContain("Prospecto de Juan");
    }
    const propio = await llamar(api.contact.GET, "/api/contacts/ct_emi", { params: { id: "ct_emi" } });
    expect(propio.status).toBe(200);
  });

  it("su ficha llega sin comisión ni montos, con su nombre como vendedor", async () => {
    como(EMI);
    const r = await llamar(api.contact.GET, "/api/contacts/ct_emi", { params: { id: "ct_emi" } });
    const ficha = (r.body.contact as { ficha: Record<string, unknown> }).ficha;
    expect(ficha).toEqual({ empresa: "Empresa", vendedor: "Emiliano" });
    expect(JSON.stringify(r.body)).not.toMatch(/1,200,000|80,000|30%/);
  });

  it("Pipeline: solo sus tratos y sin montos", async () => {
    como(EMI);
    const r = await llamar(api.board.GET, "/api/pipeline/board?vendedor=todos");
    expect(r.body.montosVisibles).toBe(false);
    const leads = r.body.leads as { id: string; amountCents: number | null }[];
    expect(leads.map((l) => l.id)).toEqual(["ld_emi"]);
    expect(leads[0]!.amountCents).toBeNull();
    // Todas las columnas siguen ahí: el embudo es el mismo para todos.
    expect((r.body.stages as unknown[]).length).toBe(4);
  });

  it("Bandeja: solo sus conversaciones; las ajenas, sus mensajes, notas y adjuntos son 404", async () => {
    como(EMI);
    expect(ids(await llamar(api.conversations.GET, "/api/conversations"), "conversations")).toEqual([
      "cv_emi",
    ]);
    const p = { params: { id: "cv_juan" } };
    expect((await llamar(api.messages.GET, "/api/conversations/cv_juan/messages", p)).status).toBe(404);
    expect((await llamar(api.notes.GET, "/api/conversations/cv_juan/notes", p)).status).toBe(404);
    const m = await llamar(api.media.GET, "/api/media/ma_juan", { params: { assetId: "ma_juan" } });
    expect(m.status).toBe(404);
    // Los suyos, sí.
    const propios = await llamar(api.messages.GET, "/api/conversations/cv_emi/messages", {
      params: { id: "cv_emi" },
    });
    expect(propios.status).toBe(200);
    expect(JSON.stringify(propios.body)).toContain("Hola, soy emi");
  });

  it("Citas: solo las de sus contactos (ni las de otro, ni los bloqueos)", async () => {
    como(EMI);
    expect(ids(await llamar(api.bookings.GET, "/api/bookings"), "bookings")).toEqual(["bk_emi"]);
    como(OMAR);
    expect(ids(await llamar(api.bookings.GET, "/api/bookings"), "bookings")).toEqual([
      "bk_bloqueo",
      "bk_emi",
      "bk_juan",
    ]);
  });

  it("Resultados: cuenta solo lo suyo y sin dinero; lo del agente no es suyo", async () => {
    como(EMI);
    const ventas = await llamar(api.sales.GET, "/api/analytics/sales");
    expect(ventas.status).toBe(200);
    const kpis = ventas.body.kpis as { newLeads: { current: number }; wonCents: { current: number } };
    expect(kpis.newLeads.current).toBe(1);
    expect(kpis.wonCents.current).toBe(0);
    expect(ventas.body.montosOcultos).toBe(true);
    const pendientes = await llamar(api.hygiene.GET, "/api/analytics/hygiene");
    expect(pendientes.body.silentAmountCents).toBe(0);
    expect((await llamar(api.bot.GET, "/api/analytics/bot")).status).toBe(403);

    como(OMAR);
    const todo = await llamar(api.sales.GET, "/api/analytics/sales");
    expect((todo.body.kpis as typeof kpis).newLeads.current).toBe(4);
    expect(todo.body.montosOcultos).toBeUndefined();
    const deJuan = await llamar(api.sales.GET, "/api/analytics/sales?vendedor=usr_juan");
    expect((deJuan.body.kpis as typeof kpis).newLeads.current).toBe(1);
  });

  /* ── Modificar ────────────────────────────────────────────────── */

  it("no puede editar, mover, anotar ni agendar sobre lo de otro (404) y nada cambia", async () => {
    como(EMI);
    const patch = await llamar(api.contact.PATCH, "/api/contacts/ct_juan", {
      method: "PATCH",
      body: { name: "Robado", notes: "mío", ficha: { empresa: "X" } },
      params: { id: "ct_juan" },
    });
    expect(patch.status).toBe(404);
    const mover = await llamar(api.lead.PATCH, "/api/pipeline/leads/ld_juan", {
      method: "PATCH",
      body: { stageId: "st_lost", lossReason: "precio" },
      params: { id: "ld_juan" },
    });
    expect(mover.status).toBe(404);
    const nota = await llamar(api.notes.POST, "/api/conversations/cv_juan/notes", {
      method: "POST",
      body: { texto: "ya es mío" },
      params: { id: "cv_juan" },
    });
    expect(nota.status).toBe(404);
    const borrarNota = await llamar(api.note.DELETE, "/api/conversations/cv_juan/notes/nt_juan", {
      method: "DELETE",
      params: { id: "cv_juan", noteId: "nt_juan" },
    });
    expect(borrarNota.status).toBe(404);
    const leida = await llamar(api.conversation.PATCH, "/api/conversations/cv_juan", {
      method: "PATCH",
      body: { markRead: true },
      params: { id: "cv_juan" },
    });
    expect(leida.status).toBe(404);
    const cita = await llamar(api.booking.PATCH, "/api/bookings/bk_juan", {
      method: "PATCH",
      body: { action: "cancel" },
      params: { id: "bk_juan" },
    });
    expect(cita.status).toBe(404);
    const nueva = await llamar(api.bookings.POST, "/api/bookings", {
      method: "POST",
      body: { kind: "session", contactId: "ct_juan", startUtc: new Date(Date.now() + 5 * 86400000).toISOString() },
    });
    expect(nueva.status).toBe(404);

    const [c] = await sql`select name, notes, ficha from contact where id = 'ct_juan'`;
    expect(c.name).toBe("Prospecto de Juan");
    expect(c.notes).toBeNull();
    expect(c.ficha.empresa).toBe("Empresa");
    const [l] = await sql`select stage_id from lead where id = 'ld_juan'`;
    expect(l.stage_id).toBe("st_int");
    const notas = await sql`select id from conversation_note where conversation_id = 'cv_juan'`;
    expect(notas.map((n: { id: string }) => n.id)).toEqual(["nt_juan"]);
    const [b] = await sql`select status from booking where id = 'bk_juan'`;
    expect(b.status).toBe("agendada");
  });

  it("no puede borrar, archivar, importar, pausar al agente ni reasignar", async () => {
    como(EMI);
    for (const id of ["ct_emi", "ct_juan"]) {
      const r = await llamar(api.contact.DELETE, `/api/contacts/${id}`, { method: "DELETE", params: { id } });
      expect(r.status, id).toBe(403);
    }
    for (const body of [{ archived: true }, { aiPaused: true }, { ownerUserId: "usr_emi" }]) {
      const r = await llamar(api.contact.PATCH, "/api/contacts/ct_emi", {
        method: "PATCH",
        body,
        params: { id: "ct_emi" },
      });
      expect(r.status, JSON.stringify(body)).toBe(403);
    }
    const imp = await llamar(api.importar.POST, "/api/contacts/import", {
      method: "POST",
      body: { rows: [{ phone: "5215511112222", name: "X" }] },
    });
    expect(imp.status).toBe(403);
    const ia = await llamar(api.conversation.PATCH, "/api/conversations/cv_emi", {
      method: "PATCH",
      body: { aiEnabled: false },
      params: { id: "cv_emi" },
    });
    expect(ia.status).toBe(403);
    const etapas = await llamar(api.stages.POST, "/api/pipeline/stages", {
      method: "POST",
      body: { name: "Mi etapa" },
    });
    expect(etapas.status).toBe(403);
    const vivos = await sql`select id, archived_at, ai_paused from contact where id in ('ct_emi','ct_juan')`;
    expect(vivos).toHaveLength(2);
    expect(vivos.every((v: { archived_at: Date | null }) => v.archived_at === null)).toBe(true);
  });

  it("no captura dinero: los montos y la comisión se le ignoran o niegan", async () => {
    como(EMI);
    const r = await llamar(api.contact.PATCH, "/api/contacts/ct_emi", {
      method: "PATCH",
      body: {
        ficha: {
          empresa: "Empresa Nueva",
          comision: null,
          costoImplementacion: null,
          costoMensual: "$1",
          vendedor: "Otro",
        },
      },
      params: { id: "ct_emi" },
    });
    expect(r.status).toBe(200);
    const [c] = await sql`select ficha from contact where id = 'ct_emi'`;
    expect(c.ficha).toMatchObject({
      empresa: "Empresa Nueva",
      vendedor: "Emiliano",
      comision: "30%",
      costoImplementacion: "$1,200,000",
      costoMensual: "$80,000",
    });
    const monto = await llamar(api.lead.PATCH, "/api/pipeline/leads/ld_emi", {
      method: "PATCH",
      body: { amountCents: 1 },
      params: { id: "ld_emi" },
    });
    expect(monto.status).toBe(403);
    // Mover SU trato sí puede, y la respuesta tampoco trae el monto.
    const mover = await llamar(api.lead.PATCH, "/api/pipeline/leads/ld_emi", {
      method: "PATCH",
      body: { stageId: "st_poc", position: 0 },
      params: { id: "ld_emi" },
    });
    expect(mover.status).toBe(200);
    expect((mover.body.lead as { amountCents: unknown }).amountCents).toBeNull();
    const [l] = await sql`select stage_id, amount_cents from lead where id = 'ld_emi'`;
    expect(l).toEqual({ stage_id: "st_poc", amount_cents: 120000000 });
  });

  it("no envía por la línea de WhatsApp; sí deja notas en lo suyo", async () => {
    como(EMI);
    const enviar = await llamar(api.messages.POST, "/api/conversations/cv_emi/messages", {
      method: "POST",
      body: { text: "Hola" },
      params: { id: "cv_emi" },
    });
    expect(enviar.status).toBe(403);
    const nota = await llamar(api.notes.POST, "/api/conversations/cv_emi/notes", {
      method: "POST",
      body: { texto: "Le llamé, quiere demo el lunes" },
      params: { id: "cv_emi" },
    });
    expect(nota.status).toBe(201);
  });

  it("no entra a Ajustes, al Agente ni al equipo", async () => {
    como(EMI);
    expect((await llamar(api.team.GET, "/api/settings/team")).status).toBe(403);
    expect((await llamar(api.whatsapp.GET, "/api/settings/whatsapp")).status).toBe(403);
    expect((await llamar(api.agente.GET, "/api/agent/profile")).status).toBe(403);
    const eq = await api.equipoAcceso.equipoDe(EMI);
    // No conoce al resto del equipo.
    expect(eq.vendedores.map((v: { id: string }) => v.id)).toEqual(["usr_emi"]);
    expect(eq.propietario).toBe(false);
  });

  it("lo que registra es suyo, aunque intente dárselo a otro; el duplicado ajeno no se revela", async () => {
    como(EMI);
    const r = await llamar(api.contacts.POST, "/api/contacts", {
      method: "POST",
      body: {
        name: "Nuevo de Emiliano",
        phone: "5215599990001",
        ownerUserId: "usr_juan",
        ficha: { empresa: "ACME", comision: "50%", vendedor: "Juan" },
      },
    });
    expect(r.status).toBe(201);
    const id = (r.body.contact as { id: string }).id;
    const [c] = await sql`select owner_user_id, ficha from contact where id = ${id}`;
    expect(c.owner_user_id).toBe("usr_emi");
    expect(c.ficha).toEqual({ empresa: "ACME", vendedor: "Emiliano" });

    const dup = await llamar(api.contacts.POST, "/api/contacts", {
      method: "POST",
      body: { name: "Copia", phone: "525500000003" },
    });
    expect(dup.status).toBe(409);
    expect(dup.body.contact).toBeUndefined();
    expect(JSON.stringify(dup.body)).not.toContain("Prospecto de Juan");
  });

  /* ── El propietario ───────────────────────────────────────────── */

  it("el propietario ve todo, filtra por vendedor y por sin asignar", async () => {
    como(OMAR);
    const todos = ids(await llamar(api.contacts.GET, "/api/contacts"), "contacts");
    expect(todos).toEqual(expect.arrayContaining(["ct_emi", "ct_juan", "ct_omar", "ct_wa"]));
    expect(ids(await llamar(api.contacts.GET, "/api/contacts?vendedor=usr_juan"), "contacts")).toEqual([
      "ct_juan",
    ]);
    expect(ids(await llamar(api.contacts.GET, "/api/contacts?vendedor=sin"), "contacts")).toEqual([
      "ct_wa",
    ]);
    const board = await llamar(api.board.GET, "/api/pipeline/board");
    expect(board.body.montosVisibles).toBe(true);
    const ld = (board.body.leads as { id: string; amountCents: number; owner: { name: string } | null }[]);
    expect(ld.find((l) => l.id === "ld_juan")).toMatchObject({
      amountCents: 120000000,
      owner: { name: "Juan" },
    });
    expect(ld.find((l) => l.id === "ld_wa")!.owner).toBeNull();
    const ficha = await llamar(api.contact.GET, "/api/contacts/ct_juan", { params: { id: "ct_juan" } });
    expect((ficha.body.contact as { ficha: Record<string, unknown> }).ficha).toMatchObject({
      comision: "30%",
      costoImplementacion: "$1,200,000",
    });
  });

  it("el propietario asigna lo que llegó por WhatsApp y el integrante lo empieza a ver", async () => {
    como(EMI);
    expect(
      (await llamar(api.contact.GET, "/api/contacts/ct_wa", { params: { id: "ct_wa" } })).status
    ).toBe(404);

    como(OMAR);
    const fuera = await llamar(api.contact.PATCH, "/api/contacts/ct_wa", {
      method: "PATCH",
      body: { ownerUserId: "usr_fuera" },
      params: { id: "ct_wa" },
    });
    expect(fuera.status).toBe(422);
    const asignar = await llamar(api.contact.PATCH, "/api/contacts/ct_wa", {
      method: "PATCH",
      body: { ownerUserId: "usr_emi" },
      params: { id: "ct_wa" },
    });
    expect(asignar.status).toBe(200);
    expect((asignar.body.contact as { owner: unknown }).owner).toEqual({ id: "usr_emi", name: "Emiliano" });
    const [c] = await sql`select owner_user_id, ficha from contact where id = 'ct_wa'`;
    expect(c.owner_user_id).toBe("usr_emi");
    expect(c.ficha).toEqual({ vendedor: "Emiliano" });

    como(EMI);
    expect(
      (await llamar(api.contact.GET, "/api/contacts/ct_wa", { params: { id: "ct_wa" } })).status
    ).toBe(200);
    expect(ids(await llamar(api.conversations.GET, "/api/conversations"), "conversations")).toEqual([
      "cv_emi",
      "cv_wa",
    ]);
    // Y Juan, que no es el dueño, sigue sin verlo.
    como(JUAN);
    expect(
      (await llamar(api.contact.GET, "/api/contacts/ct_wa", { params: { id: "ct_wa" } })).status
    ).toBe(404);
  });

  it("sin sesión no hay nada", async () => {
    como(null);
    expect((await llamar(api.contacts.GET, "/api/contacts")).status).toBe(401);
  });
});
