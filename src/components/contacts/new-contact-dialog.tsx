"use client";

import { useEffect, useState } from "react";
import type { SourceValue, StageDto } from "@/lib/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";

const SOURCES: { value: SourceValue; label: string }[] = [
  { value: "referido", label: "Referido" },
  { value: "organico", label: "Contenido orgánico" },
  { value: "conocido", label: "Conocido" },
  { value: "anuncio", label: "Anuncio" },
  { value: "otro", label: "Otro" },
];

const ETAPAS = ["Interesado", "En Proceso", "POC", "Cliente Actual"];

export function NewContactDialog({
  onClose,
  onCreated,
  onOpenExisting,
}: {
  onClose: () => void;
  onCreated: () => void;
  onOpenExisting: (contactId: string) => void;
}) {
  const [name, setName] = useState("");
  const [empresa, setEmpresa] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [source, setSource] = useState<SourceValue>("referido");
  const [etapa, setEtapa] = useState(ETAPAS[0]);
  const [servicios, setServicios] = useState("");
  const [hasStages, setHasStages] = useState(true);
  const [fechaIngreso, setFechaIngreso] = useState("");
  const [fechaFirma, setFechaFirma] = useState("");
  const [costoImpl, setCostoImpl] = useState("");
  const [costoMensual, setCostoMensual] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [duplicado, setDuplicado] = useState<{ id: string; name: string } | null>(null);

  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pipeline/stages").catch(() => null);
      if (!res?.ok) return;
      const data = (await res.json()) as { stages: StageDto[] };
      setHasStages(data.stages.filter((s) => s.kind === "open").length > 0);
    })();
  }, []);

  async function guardar() {
    setSaving(true);
    setError(null);
    setDuplicado(null);

    const ficha: Record<string, unknown> = {};
    if (empresa.trim()) ficha.empresa = empresa.trim();
    if (etapa) ficha.etapa = etapa;
    if (fechaIngreso) ficha.fechaIngreso = fechaIngreso;
    if (fechaFirma) ficha.fechaFirma = fechaFirma;
    if (costoImpl.trim()) ficha.costoImplementacion = costoImpl.trim();
    if (costoMensual.trim()) ficha.costoMensual = costoMensual.trim();

    const res = await fetch("/api/contacts", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: name.trim(),
        phone: phone.trim(),
        email: email.trim() || undefined,
        source,
        notes: servicios.trim() || undefined,
        ficha: Object.keys(ficha).length > 0 ? ficha : undefined,
      }),
    }).catch(() => null);
    setSaving(false);

    if (!res) {
      setError("No se pudo guardar. Revisa tu conexión.");
      return;
    }
    const data = (await res.json().catch(() => null)) as {
      error?: { message?: string };
      contact?: { id: string; name: string };
    } | null;

    if (res.status === 409 && data?.contact) {
      setDuplicado({ id: data.contact.id, name: data.contact.name });
      return;
    }
    if (!res.ok) {
      setError(data?.error?.message ?? "No se pudo guardar el contacto");
      return;
    }
    onCreated();
  }

  const listo = name.trim().length > 0 && phone.replace(/\D/g, "").length >= 11;

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

        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="nc-name">
                Contacto
              </label>
              <Input
                id="nc-name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="Juan Pérez"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="nc-empresa">
                Empresa
              </label>
              <Input
                id="nc-empresa"
                value={empresa}
                onChange={(e) => setEmpresa(e.target.value)}
                placeholder="Ferretería La Central"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="nc-phone">
                Teléfono con código de país
              </label>
              <Input
                id="nc-phone"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                placeholder="52 555 000 1234"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="nc-email">
                Correo electrónico
              </label>
              <Input
                id="nc-email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="correo@ejemplo.com"
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
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
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="nc-etapa">
                Etapa
              </label>
              <select
                id="nc-etapa"
                value={etapa}
                onChange={(e) => setEtapa(e.target.value)}
                className="h-9 w-full rounded-md border border-input bg-card px-2 text-sm"
              >
                {ETAPAS.map((et) => (
                  <option key={et} value={et}>
                    {et}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium" htmlFor="nc-servicios">
              Servicios Contratados
            </label>
            <Textarea
              id="nc-servicios"
              rows={2}
              value={servicios}
              onChange={(e) => setServicios(e.target.value)}
              placeholder="CRM + Agente de WhatsApp…"
            />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="nc-fecha-ingreso">
                Fecha de Ingreso
              </label>
              <Input
                id="nc-fecha-ingreso"
                type="date"
                value={fechaIngreso}
                onChange={(e) => setFechaIngreso(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="nc-fecha-firma">
                Fecha de Firma
              </label>
              <Input
                id="nc-fecha-firma"
                type="date"
                value={fechaFirma}
                onChange={(e) => setFechaFirma(e.target.value)}
              />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="nc-costo-impl">
                Costo de Implementación
              </label>
              <Input
                id="nc-costo-impl"
                type="text"
                inputMode="decimal"
                value={costoImpl}
                onChange={(e) => setCostoImpl(e.target.value)}
                placeholder="$15,000"
              />
            </div>
            <div className="space-y-1.5">
              <label className="text-sm font-medium" htmlFor="nc-costo-mensual">
                Costo Mensual Sin IVA
              </label>
              <Input
                id="nc-costo-mensual"
                type="text"
                inputMode="decimal"
                value={costoMensual}
                onChange={(e) => setCostoMensual(e.target.value)}
                placeholder="$3,500"
              />
            </div>
          </div>
        </div>

        {duplicado && (
          <div className="mt-3 rounded-md border border-warning-soft bg-warning-tint px-3 py-2.5">
            <p className="text-[13px] text-warning-text">
              Ese teléfono ya es de <strong>{duplicado.name}</strong>. No se creó
              un duplicado.
            </p>
            <Button
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={() => onOpenExisting(duplicado.id)}
            >
              Abrir su conversación
            </Button>
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
