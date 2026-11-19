import { beforeEach, describe, expect, it, vi } from "vitest";

/**
 * 042 — Reenviar una imagen del historial: el origen se valida dentro de la
 * organización antes de leer el archivo, y el destino antes de mandar nada.
 */
const mocks = vi.hoisted(() => ({
  rows: [] as unknown[],
  read: vi.fn(),
  ensure: vi.fn(),
  send: vi.fn(),
  conversation: vi.fn(),
  session: vi.fn(),
}));

vi.mock("@/lib/db", async () => {
  const schema = await import("@/lib/db/schema");
  const chain = {
    from: () => chain,
    innerJoin: () => chain,
    where: () => chain,
    limit: async () => mocks.rows,
  };
  return { schema, getDb: () => ({ select: () => chain }) };
});
vi.mock("@/server/whatsapp/media", async (original) => ({
  ...(await original<typeof import("@/server/whatsapp/media")>()),
  readMediaFile: mocks.read,
  ensureAssetAvailable: mocks.ensure,
  // `leerAdjunto` (recupera de Meta un archivo perdido) se prueba aparte, en
  // scripts/e2e-adjunto-perdido.mjs: aquí solo lee con el mock.
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
  sendMediaMessage: mocks.send,
}));
vi.mock("@/server/inbox/queries", () => ({ getConversation: mocks.conversation }));
vi.mock("@/lib/auth/session", async (original) => ({
  ...(await original<typeof import("@/lib/auth/session")>()),
  requireSession: mocks.session,
}));

import { forwardImage } from "@/server/inbox/forward-image";
import { POST } from "@/app/api/conversations/[id]/messages/forward-image/route";
import { UnauthorizedError } from "@/lib/auth/session";
import { SendError } from "@/server/inbox/send";
import { IMAGEN_ADJUNTA, validarImagenAdjunta } from "@/lib/imagen-adjunta";
import { MEDIA_LIMITS } from "@/server/whatsapp/media";

const input = {
  organizationId: "org_a",
  conversationId: "cv_destino",
  sourceMessageId: "msg_origen",
};

function source(patch: Record<string, unknown> = {}, isTest = false) {
  return {
    message: { conversationId: "cv_origen" },
    conversation: { isTest },
    asset: {
      id: "ma_origen",
      kind: "image",
      mimeType: "image/png",
      fileName: "foto.png",
      caption: "Pie original",
      fetchStatus: "available",
      storagePath: "org_a/ma_origen",
      ...patch,
    },
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.rows = [source()];
  mocks.read.mockResolvedValue(Buffer.from("png"));
  mocks.ensure.mockResolvedValue({ fetchStatus: "available" });
  mocks.send.mockResolvedValue({ messageId: "msg_nuevo" });
  // Reenviar sale por la línea del negocio: solo el propietario (equipo).
  mocks.session.mockResolvedValue({ organizationId: "org_a", role: "owner", userId: "usr_owner" });
  mocks.conversation.mockResolvedValue({
    conversation: { channel: "whatsapp", isTest: false },
  });
});

describe("042 — origen del reenvío", () => {
  it("lee el archivo de la organización y lo manda como adjunto nuevo con el pie editado", async () => {
    const original = structuredClone(mocks.rows[0]);
    await expect(forwardImage({ ...input, caption: "Pie nuevo" })).resolves.toEqual({
      messageId: "msg_nuevo",
    });
    expect(mocks.read).toHaveBeenCalledWith("org_a", "ma_origen");
    expect(mocks.send).toHaveBeenCalledWith({
      organizationId: "org_a",
      conversationId: "cv_destino",
      file: { data: Buffer.from("png"), mimeType: "image/png", fileName: "foto.png" },
      caption: "Pie nuevo",
    });
    expect(mocks.rows[0]).toEqual(original);
  });

  it("sin pie conserva el del original; con un pie vacío sale sin pie", async () => {
    await forwardImage(input);
    expect(mocks.send.mock.calls[0]![0].caption).toBe("Pie original");
    await forwardImage({ ...input, caption: "" });
    expect(mocks.send.mock.calls[1]![0].caption).toBeUndefined();
  });

  it.each([
    ["no existe en la organización", [], "not_found"],
    ["es del Laboratorio", [source({}, true)], "sandbox_violation"],
    ["no es imagen", [source({ kind: "document", mimeType: "application/pdf" })], "invalid"],
    ["es un sticker", [source({ kind: "sticker", mimeType: "image/webp" })], "invalid"],
    ["es SVG", [source({ mimeType: "image/svg+xml" })], "invalid"],
  ])("rechaza el origen que %s sin leer ni enviar", async (_caso, rows, code) => {
    mocks.rows = rows as unknown[];
    await expect(forwardImage(input)).rejects.toMatchObject({ code });
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("una imagen que todavía no se bajó de Meta se baja antes de reenviar", async () => {
    mocks.rows = [source({ fetchStatus: "pending", storagePath: null })];
    await forwardImage(input);
    expect(mocks.ensure).toHaveBeenCalledWith("org_a", "ma_origen");
    expect(mocks.send).toHaveBeenCalledTimes(1);
  });

  it("si no se puede bajar, 410 sin enviar", async () => {
    mocks.rows = [source({ fetchStatus: "failed" })];
    mocks.ensure.mockResolvedValue(null);
    await expect(forwardImage(input)).rejects.toMatchObject({ status: 410, code: "gone" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("el archivo que falta en el almacén es 410, sin enviar", async () => {
    mocks.read.mockRejectedValue(new Error("ENOENT"));
    await expect(forwardImage(input)).rejects.toMatchObject({ status: 410, code: "gone" });
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it("no se reenvía a la misma conversación", async () => {
    await expect(
      forwardImage({ ...input, conversationId: "cv_origen" })
    ).rejects.toMatchObject({ code: "invalid" });
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

const request = (data: unknown = { sourceMessageId: "msg_origen" }) =>
  new Request("http://localhost/api/conversations/cv_destino/messages/forward-image", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(data),
  });
const params = { params: Promise.resolve({ id: "cv_destino" }) };

describe("042 — ruta de reenvío", () => {
  it("exige sesión", async () => {
    mocks.session.mockRejectedValue(new UnauthorizedError());
    expect((await POST(request(), params)).status).toBe(401);
    expect(mocks.conversation).not.toHaveBeenCalled();
  });

  it("busca el destino en la organización de la sesión; si no está, 404", async () => {
    mocks.conversation.mockResolvedValue(null);
    expect((await POST(request(), params)).status).toBe(404);
    expect(mocks.conversation).toHaveBeenCalledWith("org_a", "cv_destino");
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it.each([
    [true, "whatsapp", 403],
    [false, "instagram", 422],
    [false, "messenger", 422],
    [false, "tiktok", 422],
  ])("destino de prueba o sin adjuntos (isTest=%s, %s) → %s", async (isTest, channel, status) => {
    mocks.conversation.mockResolvedValue({ conversation: { isTest, channel } });
    expect((await POST(request(), params)).status).toBe(status);
    expect(mocks.read).not.toHaveBeenCalled();
    expect(mocks.send).not.toHaveBeenCalled();
  });

  it.each([
    { sourceMessageId: "../secreto" },
    { sourceMessageId: "msg_origen", url: "http://example.test/imagen.png" },
    { sourceMessageId: "msg_origen", path: "/etc/passwd" },
    { sourceMessageId: "msg_origen", caption: "a".repeat(1025) },
    {},
  ])("no acepta rutas, URLs ni pies de más (%j)", async (body) => {
    expect((await POST(request(body), params)).status).toBe(422);
    expect(mocks.read).not.toHaveBeenCalled();
  });

  it("traduce el error del envío y devuelve 201 al salir", async () => {
    mocks.send.mockRejectedValueOnce(new SendError("window_closed", "Ventana cerrada"));
    const cerrada = await POST(request(), params);
    expect(cerrada.status).toBe(409);
    expect((await cerrada.json()).error).toEqual({ code: "window_closed", message: "Ventana cerrada" });
    const bien = await POST(request(), params);
    expect(bien.status).toBe(201);
    expect(await bien.json()).toEqual({ messageId: "msg_nuevo" });
  });

  it("el origen ajeno es 404 aunque el destino sea propio", async () => {
    mocks.rows = [];
    const res = await POST(request(), params);
    expect(res.status).toBe(404);
    expect(mocks.send).not.toHaveBeenCalled();
  });
});

describe("042 — la imagen que acepta el compositor", () => {
  const png = (size = 10, type = "image/png", name = "a.png") =>
    new File([new Uint8Array(size)], name, { type });

  it("son los límites de imagen del servidor", () => {
    expect(IMAGEN_ADJUNTA.maxBytes).toBe(MEDIA_LIMITS.image.maxBytes);
    expect(IMAGEN_ADJUNTA.mimes.source).toBe(MEDIA_LIMITS.image.mimes.source);
  });

  it("acepta una imagen JPEG, PNG o WebP de hasta 5 MB", () => {
    for (const type of ["image/jpeg", "image/png", "image/webp"]) {
      expect(validarImagenAdjunta([png(10, type)], "paste")).toMatchObject({ ok: true });
    }
    expect(validarImagenAdjunta([png(5 * 1024 * 1024)], "paste").ok).toBe(true);
  });

  it("rechaza varias, otro formato o más de 5 MB, con el verbo del gesto", () => {
    expect(validarImagenAdjunta([png(), png()], "paste")).toEqual({
      ok: false,
      error: "Pega una imagen a la vez.",
    });
    expect(validarImagenAdjunta([], "drop")).toEqual({ ok: false, error: "Arrastra una imagen a la vez." });
    expect(validarImagenAdjunta([png(10, "image/gif")], "paste")).toEqual({
      ok: false,
      error: "Pega una imagen JPEG, PNG o WebP.",
    });
    expect(validarImagenAdjunta([png(5 * 1024 * 1024 + 1)], "paste")).toMatchObject({ ok: false });
  });
});
