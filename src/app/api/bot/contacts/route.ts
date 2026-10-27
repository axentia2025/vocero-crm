import { z } from "zod";
import { getDb, schema } from "@/lib/db";
import { newId } from "@/lib/db/ids";
import { apiError, parseBody } from "@/lib/api";
import { requireBotKey, resolveInstanceOrg } from "@/server/bot/auth";
import { normalizeMx } from "@/lib/meta/client";
import { createLeadForContact } from "@/server/inbox/lead-activity";
import { serializeContact } from "@/server/contacts";

export const dynamic = "force-dynamic";

const createSchema = z.object({
  name: z.string().trim().min(1).max(120),
  phone: z
    .string()
    .trim()
    .regex(/^\d{7,15}$/, "Teléfono en dígitos, con código de país (ej. 5215512345678)"),
  email: z.string().email().max(254).optional(),
  notes: z.string().max(4000).optional(),
  source: z.enum(["anuncio", "organico", "referido", "conocido", "otro"]).optional(),
});

export async function POST(req: Request) {
  const denied = requireBotKey(req);
  if (denied) return denied;

  const organizationId = await resolveInstanceOrg();
  if (!organizationId) {
    return apiError(409, "no_org", "La instancia aún no tiene organización");
  }

  const body = await parseBody(req, createSchema);
  if (!body.ok) return body.response;

  const db = getDb();
  const phone = normalizeMx(body.data.phone);

  const inserted = await db
    .insert(schema.contact)
    .values({
      id: newId("contact"),
      organizationId,
      name: body.data.name,
      phone,
      waIdentity: phone,
      email: body.data.email ?? null,
      notes: body.data.notes ?? null,
      source: body.data.source ?? "organico",
    })
    .onConflictDoNothing({
      target: [
        schema.contact.organizationId,
        schema.contact.channel,
        schema.contact.waIdentity,
      ],
    })
    .returning();

  if (!inserted[0]) {
    return apiError(409, "duplicate", "Ya existe un contacto con ese teléfono");
  }

  const lead = await createLeadForContact({
    organizationId,
    contactId: inserted[0].id,
    source: "bot",
  });

  return Response.json(
    {
      ok: true,
      contact: serializeContact(inserted[0]),
      lead: lead ? { id: lead.id } : null,
    },
    { status: 201 }
  );
}
