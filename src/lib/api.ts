import { z } from "zod";
import { canConfigure } from "@/lib/auth/roles";
import { requireSession, UnauthorizedError, type SessionContext } from "@/lib/auth/session";

/** Respuesta de error estándar de la API interna (contrato api.md). */
export function apiError(
  status: number,
  code: string,
  message: string
): Response {
  return Response.json({ error: { code, message } }, { status });
}

/**
 * Envuelve un route handler autenticado: resuelve la sesión (401 si no hay),
 * captura errores no controlados (500 sin stack) y deja pasar Response.
 */
export function withAuth<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return async (...args: Args) => {
    let session: SessionContext;
    try {
      session = await requireSession();
    } catch (err) {
      if (err instanceof UnauthorizedError) {
        return apiError(401, "unauthorized", "No autenticado");
      }
      throw err;
    }
    try {
      return await handler(session, ...args);
    } catch (err) {
      console.error("[api] error no controlado:", err);
      return apiError(500, "internal", "Error interno");
    }
  };
}

/**
 * Como `withAuth`, pero solo para el propietario (o un rol de configuración):
 * un integrante del equipo recibe 403 sin que el handler llegue a correr.
 *
 * Es para lo que es del NEGOCIO y no de un vendedor: Ajustes (WhatsApp, IA,
 * equipo), el Agente y su conocimiento, el Laboratorio, plantillas, importar
 * contactos y enviar por la línea de WhatsApp. Envolver la ruta entera, y no
 * poner un `if` dentro, deja la regla a la vista y la hace verificable por una
 * prueba que lee las rutas (tests/unit/equipo-guardias.test.ts).
 */
export function withOwner<Args extends unknown[]>(
  handler: (session: SessionContext, ...args: Args) => Promise<Response>
): (...args: Args) => Promise<Response> {
  return withAuth(async (session, ...args: Args) => {
    if (!canConfigure(session.role)) {
      return apiError(403, "forbidden", "Esto solo lo puede hacer el propietario");
    }
    return handler(session, ...args);
  });
}

/** Parsea el body JSON con un esquema Zod; inválido → Response 422. */
export async function parseBody<T>(
  req: Request,
  schema: z.ZodType<T>
): Promise<{ ok: true; data: T } | { ok: false; response: Response }> {
  let raw: unknown;
  try {
    raw = await req.json();
  } catch {
    return {
      ok: false,
      response: apiError(422, "invalid_body", "El body debe ser JSON válido"),
    };
  }
  const parsed = schema.safeParse(raw);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((i) => `${i.path.join(".") || "body"}: ${i.message}`)
      .join("; ");
    return {
      ok: false,
      response: apiError(422, "invalid_body", detail),
    };
  }
  return { ok: true, data: parsed.data };
}
