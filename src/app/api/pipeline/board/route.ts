import { and, asc, eq } from "drizzle-orm";
import { withAuth } from "@/lib/api";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { filtroVendedor, veTodo } from "@/lib/equipo";
import { getBranding } from "@/server/branding";
import { condicionContacto, nombresDeVendedores } from "@/server/equipo/acceso";

export const dynamic = "force-dynamic";

/** Datos completos del kanban: etapas ordenadas + tarjetas con su contacto. */
export const GET = withAuth(async (session, req: Request) => {
  const db = getDb();
  // Un integrante ve solo los tratos de sus contactos; el propietario, todos o
  // los de un vendedor (`?vendedor=<userId>`, o `?vendedor=sin`).
  const vendedor = filtroVendedor(session, new URL(req.url).searchParams.get("vendedor"));
  // Los montos de cierre los ve (y los captura) el propietario.
  const montos = veTodo(session.role);

  const stages = await db
    .select()
    .from(schema.pipelineStage)
    .where(scoped(schema.pipelineStage.organizationId, session.organizationId))
    .orderBy(asc(schema.pipelineStage.position));

  const leads = await db
    .select({
      lead: schema.lead,
      contact: schema.contact,
      conversationId: schema.conversation.id,
    })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.lead.contactId, schema.contact.id))
    .leftJoin(
      schema.conversation,
      and(
        eq(schema.conversation.contactId, schema.contact.id),
        eq(schema.conversation.isTest, false)
      )
    )
    .where(
      scoped(
        schema.lead.organizationId,
        session.organizationId,
        condicionContacto(vendedor)
      )
    )
    .orderBy(asc(schema.lead.position));

  // La moneda del negocio viaja con el tablero: el cliente suma sus columnas y
  // necesita saber cuál es la única sumable, sin adivinarla ni pedirla aparte.
  const [{ currency }, nombres] = await Promise.all([
    getBranding(session.organizationId),
    nombresDeVendedores(session.organizationId),
  ]);

  return Response.json({
    currency,
    /** false = quien mira no ve montos: el tablero no pinta ni suma dinero. */
    montosVisibles: montos,
    stages: stages.map((s) => ({
      id: s.id,
      name: s.name,
      position: s.position,
      kind: s.kind,
    })),
    leads: leads.map((r) => ({
      id: r.lead.id,
      stageId: r.lead.stageId,
      position: r.lead.position,
      lastActivityAt: r.lead.lastActivityAt?.toISOString() ?? null,
      amountCents: montos ? r.lead.amountCents : null,
      currency: montos ? r.lead.currency : null,
      priority: r.lead.priority,
      contact: {
        id: r.contact.id,
        name: r.contact.name,
        phone: r.contact.phone,
      },
      owner: r.contact.ownerUserId
        ? { id: r.contact.ownerUserId, name: nombres.get(r.contact.ownerUserId) ?? "" }
        : null,
      conversationId: r.conversationId,
    })),
  });
});
