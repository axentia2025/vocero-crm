import { getContactById, getContactStage } from "@/server/contacts";

/**
 * Aviso a Librada (back-office financiero) cuando un trato se gana o deja de
 * estar ganado. Librada registra lo pactado como cuentas por cobrar/pagar.
 *
 * Apagado si no hay `LIBRADA_WEBHOOK_URL`. Best-effort: un fallo aquí jamás
 * puede costar el movimiento del lead ni el guardado del contacto.
 */
export async function avisarLibrada(input: {
  organizationId: string;
  contactId: string;
  /** `false` = solo avisa si el trato está ganado ahora (edición de ficha). */
  incluirReabierto: boolean;
}): Promise<void> {
  const url = process.env.LIBRADA_WEBHOOK_URL;
  const secret = process.env.LIBRADA_WEBHOOK_SECRET;
  if (!url || !secret) return;

  try {
    const [contact, trato] = await Promise.all([
      getContactById(input.organizationId, input.contactId),
      getContactStage(input.organizationId, input.contactId),
    ]);
    if (!contact || !trato) return;
    const ganado = trato.stage.kind === "won";
    if (!ganado && !input.incluirReabierto) return;

    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json", "x-librada-secret": secret },
      signal: AbortSignal.timeout(8000),
      body: JSON.stringify({
        evento: ganado ? "ganado" : "reabierto",
        leadId: trato.lead.id,
        contactId: contact.id,
        etapa: trato.stage.name,
        montoCents: trato.lead.amountCents,
        moneda: trato.lead.currency,
        contacto: { nombre: contact.name, telefono: contact.phone, email: contact.email },
        ficha: contact.ficha ?? {},
        enviadoEn: new Date().toISOString(),
      }),
    });
    if (!res.ok) console.error(`[librada] aviso rechazado: HTTP ${res.status}`);
  } catch (err) {
    console.error("[librada] aviso falló:", err instanceof Error ? err.message : err);
  }
}
