import { apiError, parseBody, withAuth } from "@/lib/api";
import { canConfigure } from "@/lib/auth/roles";
import { conversacionVisible } from "@/server/equipo/acceso";
import { crearNota, listarNotas, NotaError, notaSchema } from "@/server/notas";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ id: string }> };

/** 050 — Las notas internas de la conversación, por hora. */
export const GET = withAuth(async (session, _req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  // Las notas viven en la conversación: si no es de sus contactos, no existe.
  if (!(await conversacionVisible(session, id))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  try {
    const quien = { ...session, configura: canConfigure(session.role) };
    return Response.json({ notas: await listarNotas(quien, id) });
  } catch (err) {
    if (err instanceof NotaError) return apiError(err.status, err.code, err.message);
    throw err;
  }
});

/** Escribir una nota: cualquiera del equipo. No envía nada al cliente. */
export const POST = withAuth(async (session, req: Request, ctx: Params) => {
  const { id } = await ctx.params;
  // Las notas viven en la conversación: si no es de sus contactos, no existe.
  if (!(await conversacionVisible(session, id))) {
    return apiError(404, "not_found", "Conversación no encontrada");
  }
  const body = await parseBody(req, notaSchema);
  if (!body.ok) return body.response;
  try {
    const quien = { ...session, configura: canConfigure(session.role) };
    return Response.json({ nota: await crearNota(quien, id, body.data.texto) }, { status: 201 });
  } catch (err) {
    if (err instanceof NotaError) return apiError(err.status, err.code, err.message);
    throw err;
  }
});
