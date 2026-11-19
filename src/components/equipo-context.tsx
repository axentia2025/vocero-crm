"use client";

import { createContext, useContext, type ReactNode } from "react";
import type { EquipoDto } from "@/lib/equipo";

/**
 * Quién mira y con quién trabaja, para cualquier pantalla de la app.
 *
 * Lo resuelve el servidor una vez (layout de la app) y baja por contexto: así
 * Contactos, Pipeline, Resultados y la Bandeja deciden igual qué enseñar sin
 * pedirlo cada una. Es solo PRESENTACIÓN: lo que un integrante no puede ver o
 * hacer lo niega el servidor de todos modos.
 */
const SIN_EQUIPO: EquipoDto = {
  yo: { id: "", name: "" },
  propietario: false,
  vendedores: [],
};

const EquipoContext = createContext<EquipoDto>(SIN_EQUIPO);

export function EquipoProvider({
  equipo,
  children,
}: {
  equipo: EquipoDto;
  children: ReactNode;
}) {
  return <EquipoContext.Provider value={equipo}>{children}</EquipoContext.Provider>;
}

export function useEquipo(): EquipoDto {
  return useContext(EquipoContext);
}
