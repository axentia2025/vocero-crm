import { canConfigure } from "@/lib/auth/roles";
import type { FichaDto } from "@/lib/types";

/**
 * El equipo de ventas: quién ve qué.
 *
 * Cada integrante trae a sus propios prospectos y trabaja SOLO con los suyos;
 * el propietario ve todo concentrado y puede filtrar por vendedor. Este
 * archivo es la parte que no toca la base (reglas puras, tipos y nombres) para
 * que la usen igual el servidor y las pantallas. Las consultas viven en
 * `src/server/equipo/acceso.ts`.
 */

/**
 * Quien ve todo y captura el dinero: el propietario (y el `admin` que Better
 * Auth conoce, que es un rol de configuración). Mismo criterio que
 * `canConfigure`, a propósito: hay una sola idea de «quién manda».
 */
export function veTodo(role: string | null | undefined): boolean {
  return canConfigure(role);
}

/**
 * Campos de la ficha que son dinero: la comisión del vendedor y los montos de
 * cierre. Los captura el propietario y un integrante del equipo no los ve ni
 * los cambia (tampoco el monto del trato en el Pipeline, que sale del costo
 * de implementación).
 */
export const CAMPOS_DE_DINERO = ["comision", "costoImplementacion", "costoMensual"] as const;

/**
 * La ficha enseña «Vendedor», pero ya no se teclea: sale del dueño del
 * contacto. Así no hay dos verdades (el texto y la cuenta) que se contradigan.
 */
export const CAMPO_VENDEDOR = "vendedor";

const DINERO = new Set<string>(CAMPOS_DE_DINERO);

/**
 * La ficha tal como la puede ver este rol: sin dinero para un integrante del
 * equipo, y con «Vendedor» = el nombre del dueño (o sin la clave si el
 * contacto no tiene dueño).
 */
export function fichaParaRol(
  ficha: FichaDto,
  role: string | null | undefined,
  vendedor: string | null
): FichaDto {
  const out: FichaDto = {};
  for (const [k, v] of Object.entries(ficha)) {
    if (k === CAMPO_VENDEDOR) continue;
    if (!veTodo(role) && DINERO.has(k)) continue;
    out[k] = v;
  }
  if (vendedor) out[CAMPO_VENDEDOR] = vendedor;
  return out;
}

/**
 * Lo que este rol puede escribir en la ficha. «Vendedor» no lo escribe nadie
 * a mano (lo pone el servidor desde el dueño); el dinero solo el propietario.
 * Lo demás se descarta EN SILENCIO y no con error: la pantalla de un
 * integrante manda el formulario completo y no debe fallar por campos que ni
 * siquiera ve.
 */
export function parcheDeFichaPermitido(
  patch: Record<string, unknown>,
  role: string | null | undefined
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    if (k === CAMPO_VENDEDOR) continue;
    if (!veTodo(role) && DINERO.has(k)) continue;
    out[k] = v;
  }
  return out;
}

/* ── Filtro por vendedor ────────────────────────────────────────── */

/** Valor del filtro en la URL (`?vendedor=`) para «todos» y «sin asignar». */
export const VENDEDOR_TODOS = "todos";
export const VENDEDOR_SIN_ASIGNAR = "sin";

export type FiltroVendedor =
  | { tipo: "todos" }
  | { tipo: "de"; userId: string }
  | { tipo: "sinAsignar" };

/**
 * Qué contactos entran en la pantalla de quien pregunta.
 *
 * Un integrante del equipo SIEMPRE ve solo lo suyo, pida lo que pida: el
 * parámetro de la URL no es un permiso, solo una preferencia del propietario.
 */
export function filtroVendedor(
  quien: { userId: string; role: string | null | undefined },
  pedido?: string | null
): FiltroVendedor {
  if (!veTodo(quien.role)) return { tipo: "de", userId: quien.userId };
  const p = pedido?.trim();
  if (!p || p === VENDEDOR_TODOS) return { tipo: "todos" };
  if (p === VENDEDOR_SIN_ASIGNAR) return { tipo: "sinAsignar" };
  return { tipo: "de", userId: p };
}

/* ── Lo que baja a las pantallas ────────────────────────────────── */

export type VendedorDto = {
  id: string;
  name: string;
  /** El propietario también vende: aparece en la lista como uno más. */
  propietario: boolean;
};

/**
 * Quién mira y con quién trabaja. Lo resuelve el servidor una vez por página
 * (layout) y baja por contexto a todas las pantallas.
 */
export type EquipoDto = {
  yo: { id: string; name: string };
  /** Ve todo, filtra por vendedor, asigna contactos y captura el dinero. */
  propietario: boolean;
  /** Para el propietario, todo el equipo; para un integrante, solo él. */
  vendedores: VendedorDto[];
};
