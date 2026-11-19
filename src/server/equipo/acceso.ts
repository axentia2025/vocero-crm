import { asc, eq, isNull, sql, type SQL } from "drizzle-orm";
import type { PgColumn } from "drizzle-orm/pg-core";
import { getDb, schema } from "@/lib/db";
import { scoped } from "@/lib/db/tenant";
import { upsertFicha } from "@/server/bot/ficha";
import type { SessionContext } from "@/lib/auth/session";
import {
  CAMPO_VENDEDOR,
  veTodo,
  type EquipoDto,
  type FiltroVendedor,
} from "@/lib/equipo";

/**
 * Quién ve qué, en la base.
 *
 * Regla única: un integrante del equipo (`member`) solo ve los contactos cuyo
 * `owner_user_id` es él, y con ellos todo lo que cuelga del contacto: su trato
 * en el Pipeline, su conversación y sus mensajes, sus notas internas, sus
 * citas y sus adjuntos. El propietario ve todo.
 *
 * Dos herramientas, para los dos tipos de ruta:
 * - LISTAS: `condicionContacto` / `condicionPorContacto` devuelven el pedazo
 *   de WHERE que se suma a `scoped(...)` (o `undefined` si no filtra).
 * - UNA COSA POR ID: `contactoVisible`, `conversacionVisible`… responden si
 *   quien pregunta puede verla. Lo que no puede ver responde 404, igual que
 *   lo que no existe: un integrante no debe poder averiguar qué ids son de
 *   otro probando.
 */

type Quien = Pick<SessionContext, "userId" | "organizationId" | "role">;

/** WHERE sobre la tabla `contact` (ya en la consulta). */
export function condicionContacto(filtro: FiltroVendedor): SQL | undefined {
  switch (filtro.tipo) {
    case "todos":
      return undefined;
    case "sinAsignar":
      return isNull(schema.contact.ownerUserId);
    case "de":
      return eq(schema.contact.ownerUserId, filtro.userId);
  }
}

/**
 * WHERE para tablas que cuelgan de un contacto (lead, conversación, cita,
 * bitácora…) sin tener que unir `contact`: subconsulta correlacionada por la
 * columna `contact_id` que se pase. El alias evita chocar con un `contact`
 * que la consulta ya traiga.
 */
export function condicionPorContacto(
  filtro: FiltroVendedor,
  contactIdColumn: PgColumn
): SQL | undefined {
  switch (filtro.tipo) {
    case "todos":
      return undefined;
    case "sinAsignar":
      return sql`exists (
        select 1 from "contact" dueno
        where dueno."id" = ${contactIdColumn} and dueno."owner_user_id" is null
      )`;
    case "de":
      return sql`exists (
        select 1 from "contact" dueno
        where dueno."id" = ${contactIdColumn} and dueno."owner_user_id" = ${filtro.userId}
      )`;
  }
}

/* ── Una cosa por id ────────────────────────────────────────────── */

/**
 * ¿Puede ver (y por lo tanto tocar) este contacto? El propietario siempre:
 * la ruta luego responde 404 si el contacto no existe, como antes.
 */
export async function contactoVisible(quien: Quien, contactId: string): Promise<boolean> {
  if (veTodo(quien.role)) return true;
  const rows = await getDb()
    .select({ id: schema.contact.id })
    .from(schema.contact)
    .where(
      scoped(
        schema.contact.organizationId,
        quien.organizationId,
        eq(schema.contact.id, contactId),
        eq(schema.contact.ownerUserId, quien.userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** ¿Puede ver esta conversación? Es visible si su contacto lo es. */
export async function conversacionVisible(
  quien: Quien,
  conversationId: string
): Promise<boolean> {
  if (veTodo(quien.role)) return true;
  const rows = await getDb()
    .select({ id: schema.conversation.id })
    .from(schema.conversation)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
    .where(
      scoped(
        schema.conversation.organizationId,
        quien.organizationId,
        eq(schema.conversation.id, conversationId),
        eq(schema.contact.ownerUserId, quien.userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/** ¿Puede ver este trato del Pipeline? Es visible si su contacto lo es. */
export async function leadVisible(quien: Quien, leadId: string): Promise<boolean> {
  if (veTodo(quien.role)) return true;
  const rows = await getDb()
    .select({ id: schema.lead.id })
    .from(schema.lead)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.lead.contactId))
    .where(
      scoped(
        schema.lead.organizationId,
        quien.organizationId,
        eq(schema.lead.id, leadId),
        eq(schema.contact.ownerUserId, quien.userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * ¿Puede ver esta cita? Solo las de sus contactos: un bloqueo de agenda no
 * tiene contacto y es del negocio, así que un integrante no lo toca.
 */
export async function citaVisible(quien: Quien, bookingId: string): Promise<boolean> {
  if (veTodo(quien.role)) return true;
  const rows = await getDb()
    .select({ id: schema.booking.id })
    .from(schema.booking)
    .innerJoin(schema.contact, eq(schema.contact.id, schema.booking.contactId))
    .where(
      scoped(
        schema.booking.organizationId,
        quien.organizationId,
        eq(schema.booking.id, bookingId),
        eq(schema.contact.ownerUserId, quien.userId)
      )
    )
    .limit(1);
  return rows.length > 0;
}

/**
 * ¿Puede ver este adjunto? Si va en un mensaje de una conversación suya, o es
 * la imagen del anuncio por el que llegó uno de sus contactos.
 */
export async function adjuntoVisible(quien: Quien, assetId: string): Promise<boolean> {
  if (veTodo(quien.role)) return true;
  const db = getDb();
  const [enMensaje, enAnuncio] = await Promise.all([
    db
      .select({ id: schema.message.id })
      .from(schema.message)
      .innerJoin(
        schema.conversation,
        eq(schema.conversation.id, schema.message.conversationId)
      )
      .innerJoin(schema.contact, eq(schema.contact.id, schema.conversation.contactId))
      .where(
        scoped(
          schema.message.organizationId,
          quien.organizationId,
          eq(schema.message.mediaAssetId, assetId),
          eq(schema.contact.ownerUserId, quien.userId)
        )
      )
      .limit(1),
    db
      .select({ id: schema.adAttribution.id })
      .from(schema.adAttribution)
      .innerJoin(schema.contact, eq(schema.contact.id, schema.adAttribution.contactId))
      .where(
        scoped(
          schema.adAttribution.organizationId,
          quien.organizationId,
          eq(schema.adAttribution.imageAssetId, assetId),
          eq(schema.contact.ownerUserId, quien.userId)
        )
      )
      .limit(1),
  ]);
  return enMensaje.length > 0 || enAnuncio.length > 0;
}

/* ── El equipo ──────────────────────────────────────────────────── */

/** Todas las cuentas de la organización, en orden de alta. */
async function cuentasDe(organizationId: string) {
  return getDb()
    .select({
      id: schema.user.id,
      name: schema.user.name,
      role: schema.member.role,
    })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(scoped(schema.member.organizationId, organizationId))
    .orderBy(asc(schema.member.createdAt));
}

/**
 * Quién mira y con quién trabaja. El propietario recibe al equipo entero
 * (para el filtro «Vendedor» y para asignar contactos); un integrante, solo
 * a sí mismo: no tiene por qué conocer al resto del equipo.
 */
export async function equipoDe(quien: Quien): Promise<EquipoDto> {
  const cuentas = await cuentasDe(quien.organizationId);
  const yo = cuentas.find((c) => c.id === quien.userId);
  const propietario = veTodo(quien.role);
  const vendedores = cuentas
    .filter((c) => propietario || c.id === quien.userId)
    .map((c) => ({ id: c.id, name: c.name, propietario: veTodo(c.role) }));
  return {
    yo: { id: quien.userId, name: yo?.name ?? "" },
    propietario,
    vendedores,
  };
}

/**
 * El nombre de la cuenta si pertenece a la organización, o `null`. Sirve para
 * validar una asignación (no se le puede dar un contacto a alguien de fuera)
 * y para llenar «Vendedor» en la ficha.
 */
export async function vendedorDeLaOrganizacion(
  organizationId: string,
  userId: string
): Promise<{ id: string; name: string } | null> {
  const rows = await getDb()
    .select({ id: schema.user.id, name: schema.user.name })
    .from(schema.member)
    .innerJoin(schema.user, eq(schema.user.id, schema.member.userId))
    .where(
      scoped(schema.member.organizationId, organizationId, eq(schema.member.userId, userId))
    )
    .limit(1);
  return rows[0] ?? null;
}

/** Nombres de los dueños, por id, para pintar «Vendedor» en una lista. */
export async function nombresDeVendedores(
  organizationId: string
): Promise<Map<string, string>> {
  const cuentas = await cuentasDe(organizationId);
  return new Map(cuentas.map((c) => [c.id, c.name]));
}

/**
 * Asigna (o quita, con `null`) el dueño de un contacto y deja «Vendedor» de
 * la ficha igual al nombre de la cuenta. La ficha guarda el nombre además del
 * id porque hay quien la lee fuera del CRM (el aviso a Librada, el cerebro).
 * La ficha se escribe por su única puerta (`upsertFicha`), con su merge.
 *
 * Devuelve `false` si el contacto no existe en la organización.
 */
export async function asignarDueno(input: {
  organizationId: string;
  contactId: string;
  dueno: { id: string; name: string } | null;
}): Promise<boolean> {
  const ficha = await upsertFicha({
    organizationId: input.organizationId,
    contactId: input.contactId,
    ficha: { [CAMPO_VENDEDOR]: input.dueno?.name ?? null },
  });
  if (!ficha) return false;
  await getDb()
    .update(schema.contact)
    .set({ ownerUserId: input.dueno?.id ?? null, updatedAt: new Date() })
    .where(
      scoped(
        schema.contact.organizationId,
        input.organizationId,
        eq(schema.contact.id, input.contactId)
      )
    );
  return true;
}
