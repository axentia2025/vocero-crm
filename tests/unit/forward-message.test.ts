import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 059 — Reenviar cualquier mensaje: el texto sale por `sendText`, un adjunto
 * por `sendMediaMessage`, y lo que no se reenvía se rechaza sin mandar nada.
 */
const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  read: vi.fn(),
  ensure: vi.fn(),
  sendMedia: vi.fn(),
  sendText: vi.fn(),
  conversation: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    leftJoin: () => chain,
    where: () => chain,
    limit: async () => mocks.rows,
  };
  return { schema, getDb: () => ({ select: () => chain }) };
});
vi.mock("@/server/whatsapp/media", async (original) => ({
  ...(await original<typeof import("@/server/whatsapp/media")>()),
  ensureAssetAvailable: mocks.ensure,
  leerAdjunto: async (organizationId: string, asset: { id: string }) => {
    try {
      return { asset, data: await mocks.read(organizationId, asset.id) };
    } catch {
      return null;
    }
  },
}));
vi.mock("@/server/inbox/send", async (original) => ({
  ...(await original<typeof import("@/server/inbox/send")>()),
  sendMediaMessage: mocks.sendMedia,
  sendText: mocks.sendText,
}));
vi.mock("@/server/inbox/queries", () => ({ getConversation: mocks.conversation }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.session,
}));

import { forwardMessage } from "@/server/inbox/forward-message";
import { POST } from "@/app/api/conversations/[id]/messages/forward/route";
import { SendError } from "@/server/inbox/send";

const input = { organizationId: "org_a", conversationId: "cv_destino", sourceMessageId: "msg_origen" };

function texto(text: string | null, type = "text", isTest = false) {
  return {
    message: { conversationId: "cv_origen", type, text },
    conversation: { isTest },
    asset: null,
  };
}
function adjunto(patch: Record<string, unknown> = {}) {
  return {
    message: { conversationId: "cv_origen", type: "document", text: null },
    conversation: { isTest: false },
    asset: {
      id: "ma_origen",
      kind: "document",
      mimeType: "application/pdf",
      fileName: "cotizacion.pdf",
      caption: "Pie original",
      fetchStatus: "available",
      ...patch,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [texto("Precios: 1200")];
  mocks.read.mockResolvedValue(Buffer.from("pdf"));
  mocks.ensure.mockResolvedValue({ fetchStatus: "available" });
  mocks.sendMedia.mockResolvedValue({ messageId: "msg_nuevo" });
  mocks.sendText.mockResolvedValue({ messageId: "msg_nuevo" });
  // Reenviar sale por la línea del negocio: solo el propietario (equipo).
  mocks.session.mockResolvedValue({ organizationId: "org_a", role: "owner", userId: "usr_owner" });
  mocks.conversation.mockResolvedValue({ conversation: { channel: "whatsapp", isTest: false } });
});

describe("059 — qué sale", () => {
  it("un texto sale como texto, al destino y con el mismo texto", async () => {
    await forwardMessage(input);
    expect(mocks.sendText).toHaveBeenCalledWith({
      organizationId: "org_a",
      conversationId: "cv_destino",
      text: "Precios: 1200",
    });
    expect(mocks.sendMedia).not.toHaveBeenCalled();
  });

  it("una plantilla también sale como texto libre", async () => {
    mocks.rows = [texto("Tu cita es mañana", "template")];
    await forwardMessage(input);
    expect(mocks.sendText.mock.calls[0]![0].text).toBe("Tu cita es mañana");
  });

  it("un documento sale como archivo nuevo con su nombre y el pie editado", async () => {
    mocks.rows = [adjunto()];
    await forwardMessage({ ...input, caption: "Pie nuevo" });
    const llamada = mocks.sendMedia.mock.calls[0]![0];
    expect(llamada.file).toMatchObject({ mimeType: "application/pdf", fileName: "cotizacion.pdf" });
    expect(llamada.caption).toBe("Pie nuevo");
    expect(llamada.voz).toBe(false);
  });

  it("un audio Ogg sale como nota de voz y sin pie", async () => {
    mocks.rows = [adjunto({ kind: "audio", mimeType: "audio/ogg; codecs=opus", caption: "x" })];
    await forwardMessage({ ...input, caption: "no va" });
    const llamada = mocks.sendMedia.mock.calls[0]![0];
    expect(llamada.voz).toBe(true);
    expect(llamada.caption).toBeUndefined();
  });

  it("un sticker sale como su WebP (la Cloud API lo toma como imagen)", async () => {
    mocks.rows = [adjunto({ kind: "sticker", mimeType: "image/webp", caption: null })];
    await forwardMessage(input);
    expect(mocks.sendMedia.mock.calls[0]![0].file.mimeType).toBe("image/webp");
  });
});

describe("059 — lo que se rechaza sin mandar nada", () => {
  it.each([
    ["no existe en la organización", [], "not_found"],
    ["es del Laboratorio", [texto("hola", "text", true)], "sandbox_violation"],
    ["es una ubicación", [adjunto({ kind: "location", mimeType: null })], "invalid"],
    ["es una reacción", [texto("👍", "reaction")], "invalid"],
    ["no trae texto", [texto(null)], "invalid"],
  ])("el origen que %s", async (_caso, rows, code) => {
    mocks.rows = rows as unknown[];
    await expect(forwardMessage(input)).rejects.toMatchObject({ code });
    expect(mocks.sendText).not.toHaveBeenCalled();
    expect(mocks.sendMedia).not.toHaveBeenCalled();
  });

  it("a la misma conversación", async () => {
    await expect(forwardMessage({ ...input, conversationId: "cv_origen" })).rejects.toMatchObject({
      code: "invalid",
    });
    expect(mocks.sendText).not.toHaveBeenCalled();
  });

  it("un archivo que ya no está es 410", async () => {
    mocks.rows = [adjunto()];
    mocks.read.mockRejectedValue(new Error("ENOENT"));
    await expect(forwardMessage(input)).rejects.toMatchObject({ status: 410, code: "gone" });
    expect(mocks.sendMedia).not.toHaveBeenCalled();
  });
});

describe("059 — la ruta", () => {
  const pedir = (body: unknown) =>
    POST(
      new Request("http://localhost/api/conversations/cv_destino/messages/forward", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
      { params: Promise.resolve({ id: "cv_destino" }) }
    );

  it("201 al salir", async () => {
    const res = await pedir({ sourceMessageId: "msg_origen" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ messageId: "msg_nuevo" });
  });

  it("nunca al Laboratorio", async () => {
    mocks.conversation.mockResolvedValue({ conversation: { channel: "whatsapp", isTest: true } });
    expect((await pedir({ sourceMessageId: "msg_origen" })).status).toBe(403);
    expect(mocks.sendText).not.toHaveBeenCalled();
  });

  it("un destino ajeno es 404", async () => {
    mocks.conversation.mockResolvedValue(null);
    expect((await pedir({ sourceMessageId: "msg_origen" })).status).toBe(404);
  });

  it("solo el id del mensaje: una URL es 422", async () => {
    expect((await pedir({ sourceMessageId: "msg_origen", url: "http://x.test" })).status).toBe(422);
  });

  it("la ventana cerrada es 409 window_closed", async () => {
    mocks.sendText.mockRejectedValue(new SendError("window_closed", "Ventana cerrada"));
    const res = await pedir({ sourceMessageId: "msg_origen" });
    expect(res.status).toBe(409);
    expect((await res.json()).error.code).toBe("window_closed");
  });
});
