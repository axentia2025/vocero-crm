"use client";

import { useEffect, useState, type ReactNode } from "react";
import type { ContactDto, StageDto } from "@/lib/types";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useEquipo } from "@/components/equipo-context";

export type Registro = {
  name: string;
  empresa: string;
  email: string;
  stageId: string;
  servicios: string;
  /** Su vendedor: id de la cuenta del equipo; "" = sin asignar. */
  ownerUserId: string;
  comision: string;
  fechaIngreso: string;
  fechaFirma: string;
  costoImpl: string;
  costoMensual: string;
  notas: string;
};

export const REGISTRO_VACIO: Registro = {
  name: "",
  empresa: "",
  email: "",
  stageId: "",
  servicios: "",
  ownerUserId: "",
  comision: "",
  fechaIngreso: "",
  fechaFirma: "",
  costoImpl: "",
  costoMensual: "",
  notas: "",
};

function texto(v: unknown): string {
  return v === undefined || v === null ? "" : String(v);
}

export function registroDesdeContacto(c: ContactDto): Registro {
  const f = c.ficha ?? {};
  return {
    name: c.name,
    empresa: texto(f.empresa),
    email: c.email ?? "",
    stageId: "",
    servicios: texto(f.servicios),
    ownerUserId: c.owner?.id ?? "",
    comision: texto(f.comision),
    fechaIngreso: texto(f.fechaIngreso),
    fechaFirma: texto(f.fechaFirma),
    costoImpl: texto(f.costoImplementacion),
    costoMensual: texto(f.costoMensual),
    notas: c.notes ?? "",
  };
}

/**
 * Parche de ficha: vacío = `null` para que el servidor borre la clave.
 *
 * «Vendedor» no va: lo escribe el servidor desde el dueño del contacto. El
 * dinero (comisión y montos) solo lo manda quien lo ve; si un integrante lo
 * mandara vacío, borraría lo que capturó el propietario.
 */
export function fichaDelRegistro(
  r: Registro,
  montos: boolean
): Record<string, string | null> {
  return {
    empresa: r.empresa.trim() || null,
    servicios: r.servicios.trim() || null,
    fechaIngreso: r.fechaIngreso || null,
    fechaFirma: r.fechaFirma || null,
    ...(montos
      ? {
          comision: r.comision.trim() || null,
          costoImplementacion: r.costoImpl.trim() || null,
          costoMensual: r.costoMensual.trim() || null,
        }
      : {}),
  };
}

/** Las etapas reales del Pipeline, en su orden. `null` mientras cargan. */
export function useEtapas(): StageDto[] | null {
  const [stages, setStages] = useState<StageDto[] | null>(null);
  useEffect(() => {
    void (async () => {
      const res = await fetch("/api/pipeline/stages").catch(() => null);
      if (!res?.ok) return setStages([]);
      const data = (await res.json()) as { stages: StageDto[] };
      setStages(data.stages);
    })();
  }, []);
  return stages;
}

function Campo({
  id,
  label,
  children,
}: {
  id: string;
  label: string;
  children: ReactNode;
}) {
  return (
    <div className="min-w-0 space-y-1.5">
      <label className="text-sm font-medium" htmlFor={id}>
        {label}
      </label>
      {children}
    </div>
  );
}

const SELECT =
  "h-9 w-full rounded-md border border-input bg-card px-2 text-sm disabled:opacity-60";

export function RegistroFields({
  idPrefix,
  value,
  onChange,
  etapas,
  sinTrato = false,
  afterName,
}: {
  idPrefix: string;
  value: Registro;
  onChange: (next: Registro) => void;
  etapas: StageDto[] | null;
  /** El contacto no tiene trato en el Pipeline: no hay etapa que mover. */
  sinTrato?: boolean;
  afterName?: ReactNode;
}) {
  // El propietario asigna el vendedor y captura el dinero; un integrante ve
  // su propio nombre como vendedor y no ve comisión ni montos.
  const { propietario, vendedores, yo } = useEquipo();
  const set =
    (k: keyof Registro) =>
    (e: { target: { value: string } }) =>
      onChange({ ...value, [k]: e.target.value });
  const id = (k: string) => `${idPrefix}-${k}`;

  return (
    <div className="space-y-3">
      <div className="grid grid-cols-2 gap-3">
        <Campo id={id("name")} label="Contacto">
          <Input
            id={id("name")}
            value={value.name}
            onChange={set("name")}
            placeholder="Juan Pérez"
          />
        </Campo>
        <Campo id={id("empresa")} label="Empresa">
          <Input
            id={id("empresa")}
            value={value.empresa}
            onChange={set("empresa")}
            placeholder="Ferretería La Central"
          />
        </Campo>
      </div>

      {afterName}

      <div className="grid grid-cols-2 gap-3">
        <Campo id={id("email")} label="Correo electrónico">
          <Input
            id={id("email")}
            type="email"
            value={value.email}
            onChange={set("email")}
            placeholder="correo@ejemplo.com"
          />
        </Campo>
        <Campo id={id("etapa")} label="Etapa del Pipeline">
          <select
            id={id("etapa")}
            value={value.stageId}
            onChange={set("stageId")}
            disabled={sinTrato || etapas === null}
            className={SELECT}
          >
            {etapas === null && <option value="">Cargando…</option>}
            {sinTrato && <option value="">Sin trato en el Pipeline</option>}
            {etapas?.map((s) => (
              // Perder exige motivo: eso se decide en el Pipeline.
              <option
                key={s.id}
                value={s.id}
                disabled={s.kind === "lost" && s.id !== value.stageId}
              >
                {s.kind === "lost" && s.id !== value.stageId
                  ? `${s.name} (desde el Pipeline)`
                  : s.name}
              </option>
            ))}
          </select>
        </Campo>
      </div>

      <Campo id={id("servicios")} label="Servicios contratados">
        <Textarea
          id={id("servicios")}
          rows={2}
          value={value.servicios}
          onChange={set("servicios")}
          placeholder="CRM + Agente de WhatsApp…"
        />
      </Campo>

      <div className="grid grid-cols-2 gap-3">
        <Campo id={id("vendedor")} label="Vendedor">
          {propietario ? (
            <select
              id={id("vendedor")}
              value={value.ownerUserId}
              onChange={set("ownerUserId")}
              className={SELECT}
            >
              {vendedores.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name || "Sin nombre"}
                </option>
              ))}
              <option value="">Sin asignar</option>
            </select>
          ) : (
            <Input id={id("vendedor")} value={yo.name} disabled readOnly />
          )}
        </Campo>
        {propietario && (
          <Campo id={id("comision")} label="Comisión">
            <Input
              id={id("comision")}
              value={value.comision}
              onChange={set("comision")}
              placeholder="30% impl. / 20% mensual"
            />
          </Campo>
        )}
      </div>

      <div className="grid grid-cols-2 gap-3">
        <Campo id={id("fecha-ingreso")} label="Fecha de ingreso">
          <Input
            id={id("fecha-ingreso")}
            type="date"
            value={value.fechaIngreso}
            onChange={set("fechaIngreso")}
          />
        </Campo>
        <Campo id={id("fecha-firma")} label="Fecha de firma">
          <Input
            id={id("fecha-firma")}
            type="date"
            value={value.fechaFirma}
            onChange={set("fechaFirma")}
          />
        </Campo>
      </div>

      {propietario && (
        <>
          <div className="grid grid-cols-2 gap-3">
            <Campo id={id("costo-impl")} label="Costo de implementación">
              <Input
                id={id("costo-impl")}
                inputMode="decimal"
                value={value.costoImpl}
                onChange={set("costoImpl")}
                placeholder="$15,000"
              />
            </Campo>
            <Campo id={id("costo-mensual")} label="Costo mensual sin IVA">
              <Input
                id={id("costo-mensual")}
                inputMode="decimal"
                value={value.costoMensual}
                onChange={set("costoMensual")}
                placeholder="$3,500"
              />
            </Campo>
          </div>
          <p className="-mt-1 text-[11px] text-text-3">
            El costo de implementación es el monto del trato en el Pipeline y en
            Resultados.
          </p>
        </>
      )}

      <Campo id={id("notas")} label="Notas">
        <Textarea
          id={id("notas")}
          rows={3}
          value={value.notas}
          onChange={set("notas")}
          placeholder="Acuerdos, pendientes, contexto del cliente…"
        />
      </Campo>
    </div>
  );
}
