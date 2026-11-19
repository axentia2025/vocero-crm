import { requireSession, UnauthorizedError } from "@/lib/auth/session";
import { subscribe, type SseEvent } from "@/server/events/bus";
import { veTodo } from "@/lib/equipo";
import { citaVisible, conversacionVisible } from "@/server/equipo/acceso";
import { crearFiltroDeEventos } from "@/server/equipo/eventos";

/**
 * Canal SSE de la bandeja (contrato sse.md).
 * Headers exactos + heartbeat ~25s para sobrevivir detrás de Caddy/Traefik.
 * El servidor no garantiza replay: el cliente hace catch-up con `since=`.
 */
export const dynamic = "force-dynamic";

const HEARTBEAT_MS = 25_000;
const encoder = new TextEncoder();

export async function GET(req: Request) {
  let session;
  try {
    session = await requireSession();
  } catch (err) {
    if (err instanceof UnauthorizedError) {
      return new Response("No autenticado", { status: 401 });
    }
    throw err;
  }
  const { organizationId } = session;
  const quien = session;
  // Un integrante del equipo solo recibe avisos de SUS contactos (ver
  // server/equipo/eventos.ts); al propietario le llega todo, como siempre.
  const filtro = veTodo(session.role)
    ? null
    : crearFiltroDeEventos({
        conversacion: (id) => conversacionVisible(quien, id),
        cita: (id) => citaVisible(quien, id),
      });

  let cleanup: (() => void) | null = null;

  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      const send = (chunk: string) => {
        try {
          controller.enqueue(encoder.encode(chunk));
        } catch {
          cleanup?.();
        }
      };

      send(`: conectado\n\n`);

      const emitir = (event: SseEvent) =>
        send(
          `event: ${event.type}\n` +
            `id: ${Date.now()}\n` +
            `data: ${JSON.stringify(event.data)}\n\n`
        );
      // La revisión es asíncrona: se encadena para que los avisos salgan en
      // el orden en que se publicaron (un «estado» no puede llegar antes que
      // su «mensaje nuevo»).
      let cola: Promise<void> = Promise.resolve();
      const unsubscribe = subscribe(organizationId, (event) => {
        if (!filtro) return emitir(event);
        cola = cola.then(async () => {
          if (await filtro(event)) emitir(event);
        });
      });

      const heartbeat = setInterval(() => send(`: ping\n\n`), HEARTBEAT_MS);

      cleanup = () => {
        clearInterval(heartbeat);
        unsubscribe();
        try {
          controller.close();
        } catch {
          // ya cerrado
        }
      };

      req.signal.addEventListener("abort", () => cleanup?.());
    },
    cancel() {
      cleanup?.();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      "X-Accel-Buffering": "no",
      Connection: "keep-alive",
    },
  });
}
