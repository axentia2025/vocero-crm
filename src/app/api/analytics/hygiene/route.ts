import { withAuth } from "@/lib/api";
import { getBranding } from "@/server/branding";
import { hygieneBlock } from "@/server/analytics/hygiene";
import { sinMontosHigiene } from "@/lib/analytics";
import { filtroVendedor, veTodo } from "@/lib/equipo";

export const dynamic = "force-dynamic";

/** 019 — Higiene. Sin rango: describe el AHORA, no un periodo. */
export const GET = withAuth(async (session, req: Request) => {
  const branding = await getBranding(session.organizationId);
  // Un integrante revisa solo sus pendientes (sin dinero); el propietario,
  // todos o los de un vendedor (`?vendedor=`).
  const bloque = await hygieneBlock(
    session.organizationId,
    branding.currency,
    new Date(),
    filtroVendedor(session, new URL(req.url).searchParams.get("vendedor"))
  );
  return Response.json(veTodo(session.role) ? bloque : sinMontosHigiene(bloque));
});
