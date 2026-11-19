import { z } from "zod";
import { apiError, parseBody, withAuth } from "@/lib/api";
import { parseRangeQuery } from "@/lib/time/calendar";
import { agendaDisabledResponse, agendaEnabled } from "@/server/agenda/flag";
import { listBookings, listBookingsInRange } from "@/server/agenda/queries";
import { getSettings } from "@/server/agenda/settings";
import { createBlock, createSessionBooking } from "@/server/agenda/service";
import { bookingErrorResponse, bookingPayload } from "@/server/agenda/http";
import { filtroVendedor, veTodo } from "@/lib/equipo";
import {
  condicionPorContacto,
  contactoVisible,
  conversacionVisible,
} from "@/server/equipo/acceso";
import { schema } from "@/lib/db";

export const dynamic = "force-dynamic";

/**
 * 215 — Con `?from=AAAA-MM-DD&to=AAAA-MM-DD` (días del negocio, inclusivos,
 * máximo 92), TODAS las citas de ese rango para el calendario, en orden, más
 * lo que la pantalla necesita para pintarlas: `timezone`, `weeklyHours`,
 * `range` y `truncated` (tope de seguridad de 3 000).
 *
 * Sin parámetros responde EXACTAMENTE lo de siempre (`{ bookings }`, las
 * últimas 200): es lo que leen los guiones E2E de 015. Un rango que no cuadra
 * (uno solo de los dos, fecha inexistente, al revés o demasiado largo) es 422
 * `invalid_range`.
 */
export const GET = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const url = new URL(req.url);
  const query = parseRangeQuery(url.searchParams.get("from"), url.searchParams.get("to"));
  if (!query.ok) return apiError(422, "invalid_range", query.message);
  // Un integrante ve solo las citas de sus contactos (los bloqueos de agenda
  // no tienen contacto: son del negocio).
  const deQuien = condicionPorContacto(
    filtroVendedor(session, url.searchParams.get("vendedor")),
    schema.booking.contactId
  );
  if (!query.range) {
    const bookings = await listBookings(session.organizationId, undefined, deQuien);
    return Response.json({ bookings });
  }

  const settings = await getSettings(session.organizationId);
  const { bookings, truncated } = await listBookingsInRange(
    session.organizationId,
    query.range,
    settings,
    deQuien
  );
  return Response.json({
    bookings,
    timezone: settings.timezone,
    weeklyHours: settings.weeklyHours,
    range: query.range,
    truncated,
  });
});

const postSchema = z.discriminatedUnion("kind", [
  z.object({
    kind: z.literal("session"),
    contactId: z.string().min(1),
    conversationId: z.string().min(1).nullish(),
    startUtc: z.string().min(1),
    notes: z.string().nullish(),
  }),
  z.object({
    kind: z.literal("block"),
    startUtc: z.string().min(1),
    durationMinutes: z.number().int().min(5).max(600),
    notes: z.string().nullish(),
  }),
]);

/**
 * 015 — El operador agenda o bloquea.
 *
 * Responde **201**, igual que la superficie del bot: el código de creación es
 * contrato, no un detalle.
 *
 * A diferencia del agente, el operador NO pasa por `offered_slot`: elige de la
 * disponibilidad que está viendo en pantalla. La re-validación y el candado
 * anti doble-booking sí aplican igual.
 */
export const POST = withAuth(async (session, req: Request) => {
  if (!agendaEnabled()) return agendaDisabledResponse();
  const body = await parseBody(req, postSchema);
  if (!body.ok) return body.response;

  // Un bloqueo es la agenda del negocio; una cita, solo con un contacto suyo.
  if (body.data.kind === "block" && !veTodo(session.role)) {
    return apiError(403, "forbidden", "Los bloqueos de agenda los pone el propietario");
  }
  if (body.data.kind === "session") {
    const { contactId, conversationId } = body.data;
    const visible =
      (await contactoVisible(session, contactId)) &&
      (!conversationId || (await conversacionVisible(session, conversationId)));
    if (!visible) return apiError(404, "not_found", "Contacto no encontrado");
  }

  try {
    if (body.data.kind === "block") {
      const block = await createBlock({
        organizationId: session.organizationId,
        startUtc: body.data.startUtc,
        durationMinutes: body.data.durationMinutes,
        notes: body.data.notes ?? null,
      });
      return Response.json({ booking: { id: block.id } }, { status: 201 });
    }

    const result = await createSessionBooking({
      organizationId: session.organizationId,
      contactId: body.data.contactId,
      conversationId: body.data.conversationId ?? null,
      startUtc: body.data.startUtc,
      notes: body.data.notes ?? null,
      source: "manual",
      requireOffer: false,
    });
    return Response.json(
      { booking: { id: result.booking.id }, ...bookingPayload(result) },
      { status: 201 }
    );
  } catch (err) {
    return bookingErrorResponse(err);
  }
});
