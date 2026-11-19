import { eq } from "drizzle-orm";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { effectiveSource } from "@/server/contact-source";
import type { FichaDto, PriorityValue } from "@/lib/types";
import { fichaParaRol } from "@/lib/equipo";

/**
 * Quién mira el contacto: con su rol se decide si ve el dinero de la ficha, y
 * con los nombres del equipo se pinta «Vendedor» desde el dueño.
 */
export type VistaDeContacto = { role: string; nombres: Map<string, string> };

export function serializeContact(
  c: typeof schema.contact.$inferSelect,
  stageName: string | null = null,
  priority: PriorityValue | null = null,
  /** 018: si llegó por un anuncio, la fuente no capturada se deduce "anuncio". */
  llegoPorAnuncio = false,
  /** Sin vista (API del bot) la ficha sale tal cual está guardada. */
  vista?: VistaDeContacto
) {
  const ficha = (c.ficha as FichaDto | null) ?? {};
  const nombreDueno = c.ownerUserId ? (vista?.nombres.get(c.ownerUserId) ?? null) : null;
  return {
    id: c.id,
    name: c.name,
    phone: c.phone,
    email: c.email,
    notes: c.notes,
    aiPaused: c.aiPaused,
    stageName,
    archivedAt: c.archivedAt?.toISOString() ?? null,
    source: effectiveSource(c.source, llegoPorAnuncio),
    priority,
    // Viaja siempre, aunque esté vacía: la pantalla necesita distinguir "aún
    // no la han llenado" de "este contacto no la trae".
    ficha: vista ? fichaParaRol(ficha, vista.role, nombreDueno) : ficha,
    /** Su vendedor (dueño en el CRM); null = sin asignar. */
    owner: c.ownerUserId ? { id: c.ownerUserId, name: nombreDueno ?? "" } : null,
  };
}

export async function getContactById(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select()
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        organizationId,
        eq(schema.contact.id, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Etapa actual del lead del contacto (si existe). */
export async function getContactStage(
  organizationId: string,
  contactId: string
) {
  const db = getDb();
  const rows = await db
    .select({ stage: schema.pipelineStage, lead: schema.lead })
    .from(schema.lead)
    .innerJoin(
      schema.pipelineStage,
      eq(schema.lead.stageId, schema.pipelineStage.id)
    )
    .where(
      scoped(
        schema.lead.organizationId,
        organizationId,
        eq(schema.lead.contactId, contactId)
      )
    )
    .limit(1);
  return rows[0] ?? null;
}
