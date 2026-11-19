import { z } from "zod";
import { apiError, parseBody, withOwner } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { estadoDeEntregas, reintentarAgotados } from "@/server/webhooks/eventos";
import { barrido } from "@/server/webhooks/worker";

export const dynamic = "force-dynamic";

/**
 * 047 — Las entregas del webhook que no han entrado: cuántas siguen en
 * reintento, cuántas se agotaron y el último error. Nunca el payload.
 */
export const GET = withOwner(async (session) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra ve las entregas del webhook");
  }
  return Response.json(await estadoDeEntregas(session.organizationId));
});

/** «Reintentar»: los agotados vuelven a empezar y se procesan ya. */
export const POST = withOwner(async (session, req: Request) => {
  if (!canConfigure(session.role)) {
    return apiError(403, "forbidden", "Solo quien administra puede reintentar las entregas");
  }
  const body = await parseBody(req, z.object({ accion: z.literal("reintentar") }));
  if (!body.ok) return body.response;
  const reintentados = await reintentarAgotados(session.organizationId);
  if (reintentados > 0) await barrido();
  return Response.json({ reintentados, ...(await estadoDeEntregas(session.organizationId)) });
});
