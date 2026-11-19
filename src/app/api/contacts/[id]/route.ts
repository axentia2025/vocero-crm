import { eq } from "drizzle-orm";
import { z } from "zod";
import { apiError, parseBody, withAuth, withOwner } from "@/lib/api";
import { parcheDeFichaPermitido, veTodo } from "@/lib/equipo";
import {
  asignarDueno,
  contactoVisible,
  nombresDeVendedores,
  vendedorDeLaOrganizacion,
} from "@/server/equipo/acceso";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import {
  getContactById,
  getContactStage,
  serializeContact,
} from "@/server/contacts";
import { upsertFicha } from "@/server/bot/ficha";
import { pauseConversations } from "@/server/contacts-import";
import { avisarLibrada } from "@/server/leads/librada";
import { cuentaComoAnuncio } from "@/lib/anuncios";
import {
  anuncioDelContacto,
  repararImagenSiFalta,
} from "@/server/attribution/store";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

const NO_ENCONTRADO = () => apiError(404, "not_found", "Contacto no encontrado");

export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  // El contacto de otro vendedor, para un integrante, no existe.
  if (!(await contactoVisible(session, id))) return NO_ENCONTRADO();
  const contact = await getContactById(session.organizationId, id);
  if (!contact) return apiError(404, "not_found", "Contacto no encontrado");
  const [stageRow, anuncio] = await Promise.all([
    getContactStage(session.organizationId, id),
    anuncioDelContacto(session.organizationId, id),
  ]);
  // 018 — Sin imagen todavía: se reintenta en segundo plano y llega por SSE.
  if (anuncio && !anuncio.imageAssetId) {
    repararImagenSiFalta(session.organizationId, id);
  }
  const nombres = await nombresDeVendedores(session.organizationId);
  return Response.json({
    contact: serializeContact(contact, null, null, cuentaComoAnuncio(anuncio), {
      role: session.role,
      nombres,
    }),
    // 018 — de qué anuncio llegó, o null si escribió por su cuenta.
    anuncio,
    stage: stageRow
      ? {
          id: stageRow.stage.id,
          name: stageRow.stage.name,
          position: stageRow.stage.position,
          kind: stageRow.stage.kind,
        }
      : null,
    lead: stageRow ? { id: stageRow.lead.id } : null,
  });
});

const patchSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  email: z.string().email().max(254).nullable().optional(),
  notes: z.string().max(4000).nullable().optional(),
  /** 027 — El agente no le responde a esta persona; se lleva a su conversación. */
  aiPaused: z.boolean().optional(),
  archived: z.boolean().optional(),
  /**
   * Parche de la ficha: solo las claves que cambian. `null` borra una clave.
   * No es un reemplazo — el agente sigue escribiendo mientras el dueño
   * corrige, y mandar la ficha entera haría que el último en guardar le
   * borrara lo recién descubierto al otro.
   */
  ficha: z.record(z.unknown()).optional(),
  /**
   * Reasignar su vendedor (solo el propietario): el id de una cuenta del
   * equipo, o `null` para dejarlo sin asignar.
   */
  ownerUserId: z.string().min(1).nullable().optional(),
});

// Borrar es irreversible y se lleva conversaciones y mensajes: del propietario.
export const DELETE = withOwner(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const db = getDb();
  const deleted = await db
    .delete(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        session.organizationId,
        eq(schema.contact.id, id)
      )
    )
    .returning({ id: schema.contact.id });
  if (!deleted[0]) return apiError(404, "not_found", "Contacto no encontrado");
  return Response.json({ ok: true });
});

export const PATCH = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  const body = await parseBody(req, patchSchema);
  if (!body.ok) return body.response;

  if (!(await contactoVisible(session, id))) return NO_ENCONTRADO();
  // Lo que es del negocio y no del vendedor: archivar (sale de la lista de
  // todos), apagar al agente de la línea y decidir de quién es el contacto.
  if (
    !veTodo(session.role) &&
    (body.data.archived !== undefined ||
      body.data.aiPaused !== undefined ||
      body.data.ownerUserId !== undefined)
  ) {
    return apiError(
      403,
      "forbidden",
      "Archivar, pausar al agente o reasignar el contacto lo hace el propietario"
    );
  }
  // El dinero de la ficha no lo toca un integrante (se descarta sin error:
  // su formulario ni siquiera lo enseña), y «Vendedor» sale del dueño.
  const fichaPatch =
    body.data.ficha === undefined
      ? undefined
      : parcheDeFichaPermitido(body.data.ficha, session.role);

  if (body.data.ownerUserId !== undefined) {
    const dueno =
      body.data.ownerUserId === null
        ? null
        : await vendedorDeLaOrganizacion(session.organizationId, body.data.ownerUserId);
    if (body.data.ownerUserId !== null && !dueno) {
      return apiError(422, "invalid_owner", "Ese vendedor no es parte del equipo");
    }
    const ok = await asignarDueno({
      organizationId: session.organizationId,
      contactId: id,
      dueno,
    });
    if (!ok) return NO_ENCONTRADO();
  }

  // La ficha va por su propia puerta —la MISMA que usa el cerebro externo en
  // `PUT /api/bot/ficha`— para heredar el merge y las cotas. Escribirla aquí
  // con un `set` plano sería un segundo camino con otras reglas.
  if (fichaPatch !== undefined) {
    const res = await upsertFicha({
      organizationId: session.organizationId,
      contactId: id,
      ficha: fichaPatch,
    });
    if (!res) return apiError(404, "not_found", "Contacto no encontrado");
  }

  const set: Record<string, unknown> = { updatedAt: new Date() };
  if (body.data.name !== undefined) {
    set.name = body.data.name;
    // Lo escribio una persona: a partir de aqui WhatsApp ya no lo pisa (#51).
    set.nameSource = "manual";
  }
  if (body.data.email !== undefined) set.email = body.data.email;
  if (body.data.notes !== undefined) set.notes = body.data.notes;
  if (body.data.archived !== undefined) {
    set.archivedAt = body.data.archived ? new Date() : null;
  }
  if (body.data.aiPaused !== undefined) set.aiPaused = body.data.aiPaused;

  const db = getDb();
  const updated = await db
    .update(schema.contact)
    .set(set)
    .where(
      scoped(
        schema.contact.organizationId,
        session.organizationId,
        eq(schema.contact.id, id)
      )
    )
    .returning();
  if (!updated[0]) return apiError(404, "not_found", "Contacto no encontrado");
  // 027: la pausa se lleva a la conversación que ya exista; sin esto no
  // tendría efecto hasta que naciera otra.
  if (body.data.aiPaused !== undefined) {
    await pauseConversations(session.organizationId, [id], body.data.aiPaused);
  }
  if (fichaPatch !== undefined || body.data.ownerUserId !== undefined) {
    await avisarLibrada({
      organizationId: session.organizationId,
      contactId: id,
      incluirReabierto: false,
    });
  }
  const [anuncio, nombres] = await Promise.all([
    anuncioDelContacto(session.organizationId, id),
    nombresDeVendedores(session.organizationId),
  ]);
  return Response.json({
    contact: serializeContact(updated[0], null, null, cuentaComoAnuncio(anuncio), {
      role: session.role,
      nombres,
    }),
  });
});
