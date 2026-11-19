"use client";

import { useCallback, useEffect, useState } from "react";
import { useEquipo } from "@/components/equipo-context";
import { VENDEDOR_SIN_ASIGNAR, VENDEDOR_TODOS } from "@/lib/equipo";

/**
 * Filtro «Vendedor» del propietario: todo el equipo concentrado, o lo de un
 * integrante, o lo que llegó solo y aún nadie tiene.
 *
 * La elección se recuerda en el navegador y la comparten Contactos, Pipeline
 * y Resultados: si Omar está revisando a Emiliano, al cambiar de pantalla
 * sigue viendo a Emiliano. Un integrante no ve el filtro (el servidor le da
 * solo lo suyo de todos modos).
 */

const CLAVE = "vocero:vendedor";

function leer(): string {
  try {
    return window.localStorage.getItem(CLAVE) || VENDEDOR_TODOS;
  } catch {
    return VENDEDOR_TODOS;
  }
}

export function useFiltroVendedor(): [string, (v: string) => void] {
  const { propietario, vendedores } = useEquipo();
  const [valor, setValor] = useState(VENDEDOR_TODOS);

  // Se lee al montar (no al render) para que servidor y cliente pinten lo
  // mismo la primera vez. Una cuenta que ya no existe vuelve a «todos».
  useEffect(() => {
    if (!propietario) return;
    const guardado = leer();
    const valido =
      guardado === VENDEDOR_TODOS ||
      guardado === VENDEDOR_SIN_ASIGNAR ||
      vendedores.some((v) => v.id === guardado);
    setValor(valido ? guardado : VENDEDOR_TODOS);
  }, [propietario, vendedores]);

  const cambiar = useCallback((v: string) => {
    setValor(v);
    try {
      window.localStorage.setItem(CLAVE, v);
    } catch {
      // Sin almacenamiento la elección dura lo que la pantalla: no es grave.
    }
  }, []);

  return [propietario ? valor : VENDEDOR_TODOS, cambiar];
}

/** `vendedor=...` para la URL de la API, o "" si son todos. */
export function vendedorParam(valor: string): string {
  return valor && valor !== VENDEDOR_TODOS ? `vendedor=${encodeURIComponent(valor)}` : "";
}

export function VendedorFiltro({
  value,
  onChange,
  className = "",
}: {
  value: string;
  onChange: (v: string) => void;
  className?: string;
}) {
  const { propietario, vendedores } = useEquipo();
  if (!propietario) return null;
  return (
    <select
      value={value}
      onChange={(e) => onChange(e.target.value)}
      aria-label="Filtrar por vendedor"
      title="Vendedor"
      className={`h-9 rounded-md border border-input bg-card px-2 text-sm ${className}`}
    >
      <option value={VENDEDOR_TODOS}>Vendedor: todos</option>
      {vendedores.map((v) => (
        <option key={v.id} value={v.id}>
          {v.name || "Sin nombre"}
          {v.propietario ? " (propietario)" : ""}
        </option>
      ))}
      <option value={VENDEDOR_SIN_ASIGNAR}>Sin asignar (llegó por WhatsApp)</option>
    </select>
  );
}
