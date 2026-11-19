import { apiError, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { conversacionVisible } from "@/server/equipo/acceso";
import { borrarNota, NotaError } from "@/server/notas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string; noteId: string }> };

/** 050 — Borrar una nota: quien la escribió o quien administra. */
export const DELETE = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id, noteId } = await ctx.params;
  // Las notas viven en la conversación: si no es de sus contactos, no existe.
  if (!(await conversacionVisible(session, id))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  try {
    await borrarNota({ ...session, configura: canConfigure(session.role) }, id, noteId);
    return new Response(null, { status: 204 });
  } catch (err) {
    if (err instanceof NotaError) return apiError(err.status, err.code, err.message);
    throw err;
  }
});
