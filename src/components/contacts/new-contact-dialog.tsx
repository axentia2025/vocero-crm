"use client";

import { useEffect, useState } from "react";
import type { SourceValue } from "@/lib/types";
import { parseMoneyToCents } from "@/lib/money";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  REGISTRO_VACIO,
  RegistroFields,
  fichaDelRegistro,
  useEtapas,
  type Registro,
} from "./registro-fields";
import { useEquipo } from "@/components/equipo-context";

const SOURCES: { value: SourceValue; label: string }[] = [
  { value: "referido", label: "Referido" },
  { value: "organico", label: "Contenido orgánico" },
  { value: "conocido", label: "Conocido" },
  { value: "anuncio", label: "Anuncio" },
  { value: "otro", label: "Otro" },
];

export function NewContactDialog({
  onClose,
  onCreated,
  onOpenExisting,
  onEditExisting,
}: {
  onClose: () => void;
  onCreated: () => void;
  onOpenExisting: (contactId: string) => void;
  onEditExisting?: (contactId: string) => void;
}) {
  const etapas = useEtapas();
  const { propietario, yo } = useEquipo();
  // Lo que registra cada quien es suyo; el propietario puede dárselo a otro.
  const [registro, setRegistro] = useState<Registro>(() => ({
    ...REGISTRO_VACIO,
    ownerUserId: yo.id,
  }));
  const [phone, setPhone] = useState("");
  const [source, setSource] = useState<SourceValue>("referido");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<{ id: string; name: string } | null>(null);

  const abiertas = etapas?.filter((s) => s.kind === "open") ?? [];
  const hasStages = etapas === null || abiertas.length > 0;
  const etapaElegida = etapas?.find((s) => s.id === registro.stageId);

  useEffect(() => {
    if (!etapas || registro.stageId) return;
    const inicial =
      etapas.find((s) => s.name === "Interesado") ??
      etapas.find((s) => s.kind === "open");
    if (inicial) setRegistro((r) => ({ ...r, stageId: inicial.id }));
  }, [etapas, registro.stageId]);

  async function guardar() {
    setSaving(true);
    setError(null);
    setDuplicado(null);

    const ficha = Object.fromEntries(
      Object.entries(fichaDelRegistro(registro, propietario)).filter(([, v]) => v !== null)
    );

    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: registro.name.trim(),
        phone: phone.trim(),
        email: registro.email.trim() || undefined,
        source,
        stageId: etapaElegida?.kind === "open" ? etapaElegida.id : undefined,
        notes: registro.notas.trim() || undefined,
        ficha: Object.keys(ficha).length > 0 ? ficha : undefined,
        ...(propietario ? { ownerUserId: registro.ownerUserId || null } : {}),
      }),
    }).catch(() => null);

    if (!res) {
      setSaving(false);
      setError("No se pudo guardar. Revisa tu conexión.");
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      contact?: { id: string; name: string };
      lead?: { id: string };
    } | null;

    if (res.status === 409 && data?.contact) {
      setSaving(false);
      setDuplicado({ id: data.contact.id, name: data.contact.name });
      return;
    }
    if (!res.ok) {
      setSaving(false);
      setError(data?.error?.message ?? "No se pudo guardar el contacto");
      return;
    }

    // Un cierre se registra moviendo el trato: así queda en la bitácora y
    // Resultados lo cuenta como venta ganada.
    const cents = propietario ? parseMoneyToCents(registro.costoImpl) : null;
    const leadPatch: Record<string, unknown> = {};
    if (cents !== null) leadPatch.amountCents = cents;
    if (etapaElegida && etapaElegida.kind !== "open") leadPatch.stageId = etapaElegida.id;
    if (data?.lead && Object.keys(leadPatch).length > 0) {
      await fetch(`/api/pipeline/leads/${data.lead.id}`, {
        method: "PATCH",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(leadPatch),
      }).catch(() => null);
    }
    setSaving(false);
    onCreated();
  }

  const listo =
    registro.name.trim().length > 0 && phone.replace(/\D/g, "").length >= 10;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-overlay p-4"
      onClick={onClose}
    >
      <div
        role="dialog"
        aria-label="Nuevo contacto"
        className="max-h-[85dvh] w-full max-w-lg overflow-y-auto rounded-lg border bg-popover p-5 shadow-xl"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="mb-1 font-semibold">Nuevo contacto</h3>
        <p className="mb-4 text-xs text-text-3">
          Registra un prospecto o cliente con toda su información.
        </p>

        <RegistroFields
          idPrefix="nc"
          value={registro}
          onChange={setRegistro}
          etapas={etapas}
          afterName={
            <div className="grid grid-cols-2 gap-3">
              <div className="min-w-0 space-y-1.5">
                <label className="text-sm font-medium" htmlFor="nc-phone">
                  Teléfono
                </label>
                <Input
                  id="nc-phone"
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                  placeholder="55 5000 1234"
                />
              </div>
              <div className="min-w-0 space-y-1.5">
                <label className="text-sm font-medium" htmlFor="nc-source">
                  ¿De dónde salió?
                </label>
                <select
                  id="nc-source"
                  value={source}
                  onChange={(e) => setSource(e.target.value as SourceValue)}
                  className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
                >
                  {SOURCES.map((s) => (
                    <option key={s.value} value={s.value}>
                      {s.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>
          }
        />

        {duplicado && (
          <div className="mt-3 rounded-md border border-warning-soft bg-warning-tint px-3 py-2.5">
            <p className="text-[13px] text-warning-text">
              Ese teléfono ya es de <strong>{duplicado.name}</strong>. Puedes
              editar su ficha para actualizar servicios.
            </p>
            <div className="mt-2 flex gap-2">
              {onEditExisting && (
                <Button size="sm" onClick={() => onEditExisting(duplicado.id)}>
                  Editar contacto
                </Button>
              )}
              <Button
                size="sm"
                variant="secondary"
                onClick={() => onOpenExisting(duplicado.id)}
              >
                Abrir conversación
              </Button>
            </div>
          </div>
        )}
        {error && <p className="mt-3 text-xs text-danger-text">{error}</p>}
        {!hasStages && (
          <p className="mt-3 text-xs text-warning-text">
            Tu embudo no tiene etapas abiertas. Crea una en el Pipeline antes de
            capturar contactos.
          </p>
        )}

        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancelar
          </Button>
          <Button
            disabled={!listo || saving || !hasStages}
            onClick={() => void guardar()}
          >
            {saving ? "Guardando…" : "Crear contacto"}
          </Button>
        </div>
      </div>
    </div>
  );
}
