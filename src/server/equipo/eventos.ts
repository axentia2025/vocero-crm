import type { SseEvent } from "@/server/events/bus";

/**
 * Qué avisos en tiempo real (SSE) le llegan a un integrante del equipo.
 *
 * El bus publica por ORGANIZACIÓN: sin este filtro, cada mensaje que entra a
 * la línea —con su texto— llegaría a la pantalla de todo el equipo aunque el
 * contacto sea de otro vendedor. Para un integrante pasa solo lo que toca a
 * sus conversaciones y a sus citas; el propietario recibe todo (no se filtra).
 *
 * Recibe las consultas por parámetro para poder probarse sin base. Guarda la
 * respuesta unos segundos por conversación: una ráfaga de mensajes no debe
 * costar una consulta por mensaje, y si el propietario le asigna un contacto,
 * a más tardar al vencer la memoria empieza a recibir sus avisos.
 */
export function crearFiltroDeEventos(
  consultas: {
    conversacion: (conversationId: string) => Promise<boolean>;
    cita: (bookingId: string) => Promise<boolean>;
  },
  opciones: { ttlMs?: number; ahora?: () => number } = {}
): (evento: SseEvent) => Promise<boolean> {
  const ttl = opciones.ttlMs ?? 30_000;
  const ahora = opciones.ahora ?? Date.now;
  const memoria = new Map<string, { ok: boolean; hasta: number }>();

  async function recordar(clave: string, consulta: () => Promise<boolean>) {
    const previa = memoria.get(clave);
    if (previa && previa.hasta > ahora()) return previa.ok;
    let ok = false;
    try {
      ok = await consulta();
    } catch {
      // Ante la duda, no se manda: un aviso perdido se recupera al refrescar
      // la lista; un mensaje ajeno mostrado ya no se puede «des-mostrar».
      ok = false;
    }
    memoria.set(clave, { ok, hasta: ahora() + ttl });
    return ok;
  }

  const conversacion = (id: unknown) =>
    typeof id === "string" && id
      ? recordar(`cv:${id}`, () => consultas.conversacion(id))
      : Promise.resolve(false);

  return async (evento) => {
    switch (evento.type) {
      case "message.new":
      case "message.status":
      case "message.media":
      case "note.new":
      case "note.deleted":
        return conversacion(evento.data.conversationId);
      case "conversation.updated":
        return conversacion((evento.data.conversation as { id?: unknown } | null)?.id);
      case "conversation.deleted":
        // Solo ids, sin contenido: quitarla de una lista donde no está no
        // hace nada, y si estaba (era suya) es justo lo que debe pasar.
        return true;
      case "booking.updated": {
        const id = evento.data.bookingId;
        return recordar(`bk:${id}`, () => consultas.cita(id));
      }
      case "lab.run":
        // El Laboratorio es del propietario.
        return false;
      default:
        return false;
    }
  };
}
