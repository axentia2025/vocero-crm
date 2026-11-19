import { withAuth } from "@/lib/api";
import { filtroVendedor } from "@/lib/equipo";
import { listConversations } from "@/server/inbox/queries";

export const dynamic = "force-dynamic";

export const GET = withAuth(async (session, req: Request) => {
  const url = new URL(req.url);
  const sinceParam = url.searchParams.get("since");
  const since = sinceParam ? new Date(sinceParam) : undefined;
  const conversations = await listConversations(
    session.organizationId,
    since && !Number.isNaN(since.getTime()) ? since : undefined,
    // Un integrante del equipo ve solo las de sus contactos; el propietario,
    // todas (o las de un vendedor con `?vendedor=`).
    filtroVendedor(session, url.searchParams.get("vendedor"))
  );
  return Response.json({ conversations });
});
