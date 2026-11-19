import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Guardarraíl del equipo de ventas: cada ruta de la API está CLASIFICADA.
 *
 * Una ruta nueva que nadie clasificó es justo por donde un integrante del
 * equipo terminaría viendo los contactos de otro, o tocando la configuración
 * del negocio. Esta prueba lee las rutas (sin correrlas) y falla si:
 *
 * - una ruta del propietario no está envuelta en `withOwner`;
 * - una ruta que recibe el id de un contacto, conversación, trato, cita o
 *   adjunto no pregunta si quien mira puede verlo;
 * - una lista que un integrante usa no filtra por vendedor;
 * - aparece una ruta que no está en ninguna de las listas.
 */

const API = path.join(process.cwd(), "src", "app", "api");

function rutas(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir)) {
    const full = path.join(dir, e);
    if (statSync(full).isDirectory()) out.push(...rutas(full));
    else if (e === "route.ts") out.push(full);
  }
  return out;
}

const rel = (f: string) => path.relative(API, path.dirname(f)).split(path.sep).join("/");
const leer = (r: string) => readFileSync(path.join(API, r, "route.ts"), "utf8");
const handlers = (code: string) =>
  [...code.matchAll(/export const (GET|POST|PUT|PATCH|DELETE) = (\w+)\(/g)].map((m) => ({
    metodo: m[1]!,
    envoltura: m[2]!,
  }));

/** Del propietario: TODO método con `withOwner`. */
const DEL_PROPIETARIO = [
  "agent/profile",
  "agent/profile/preset",
  "analytics/ads",
  "analytics/bot",
  "calendar/settings",
  "contacts/import",
  "contacts/[id]/start-conversation",
  "conversations/[id]/messages/forward",
  "conversations/[id]/messages/forward-image",
  "conversations/[id]/messages/media",
  "conversations/[id]/messages/template",
  "kb",
  "kb/[id]",
  "kb/size",
  "lab/runs",
  "lab/runs/[id]",
  "lab/suggestions/apply",
  "pipeline/stages/[id]",
  "seed/demo",
  "templates",
  "templates/sync",
];

/** Algunos métodos del propietario dentro de rutas que el equipo sí usa. */
const METODOS_DEL_PROPIETARIO: Record<string, string[]> = {
  "contacts/[id]": ["DELETE"],
  "conversations/[id]": ["DELETE"],
  "conversations/[id]/messages": ["POST"],
  "pipeline/stages": ["POST"],
};

/** Reciben el id de algo que es de un vendedor: deben preguntar si se ve. */
const POR_ID: Record<string, RegExp> = {
  "contacts/[id]": /contactoVisible\(/,
  "conversations/[id]": /conversacionVisible\(/,
  "conversations/[id]/eventos": /conversacionVisible\(/,
  "conversations/[id]/messages": /conversacionVisible\(/,
  "conversations/[id]/notes": /conversacionVisible\(/,
  "conversations/[id]/notes/[noteId]": /conversacionVisible\(/,
  "pipeline/leads/[id]": /leadVisible\(/,
  "bookings/[id]": /citaVisible\(/,
  "media/[assetId]": /adjuntoVisible\(/,
  // Crear una cita es con un contacto: el de quien la crea.
  bookings: /contactoVisible\(/,
};

/** Listas que un integrante usa: filtran por vendedor. */
const LISTAS = [
  "contacts",
  "conversations",
  "pipeline/board",
  "analytics/sales",
  "analytics/hygiene",
  "bookings",
];

/**
 * Abiertas a todo el equipo a propósito: no muestran contactos ni dinero, o
 * ya tenían su propia regla de rol adentro, o no son de sesión (el bot entra
 * con su llave; los webhooks, con la firma de Meta; los mocks no existen en
 * producción).
 */
const ABIERTAS = [
  "agent/brain-status", // el estado del agente (en línea, apagado) para la Bandeja
  "calendar/availability", // huecos libres de la agenda, sin datos de nadie
  "events", // filtra por vendedor adentro (server/equipo/eventos.ts)
  "onboarding/status", // ya exige canConfigure
  "pipeline/stages", // GET: las columnas del tablero
  "quick-replies", // leer las respuestas rápidas; escribirlas ya exige canConfigure
  "quick-replies/[id]",
  "health",
  "auth/[...all]",
  "branding/app-icon",
  "branding/favicon",
];
const SIN_SESION = /^(bot|webhooks|dev)\//;

const todas = rutas(API).map(rel);

describe("cada ruta de la API está clasificada para el equipo de ventas", () => {
  it("no hay rutas sin clasificar", () => {
    const conocidas = new Set([
      ...DEL_PROPIETARIO,
      ...Object.keys(METODOS_DEL_PROPIETARIO),
      ...Object.keys(POR_ID),
      ...LISTAS,
      ...ABIERTAS,
    ]);
    const sueltas = todas.filter(
      (r) => !conocidas.has(r) && !r.startsWith("settings/") && !SIN_SESION.test(r)
    );
    expect(sueltas).toEqual([]);
  });

  it("Ajustes completo y lo del negocio: solo el propietario", () => {
    const delPropietario = [...DEL_PROPIETARIO, ...todas.filter((r) => r.startsWith("settings/"))];
    const malas: string[] = [];
    for (const r of delPropietario) {
      const hs = handlers(leer(r));
      expect(hs.length, r).toBeGreaterThan(0);
      for (const h of hs) if (h.envoltura !== "withOwner") malas.push(`${r} ${h.metodo}`);
    }
    expect(malas).toEqual([]);
  });

  it("borrar, enviar por la línea y armar etapas: solo el propietario", () => {
    const malas: string[] = [];
    for (const [r, metodos] of Object.entries(METODOS_DEL_PROPIETARIO)) {
      const hs = handlers(leer(r));
      for (const m of metodos) {
        const h = hs.find((x) => x.metodo === m);
        if (h?.envoltura !== "withOwner") malas.push(`${r} ${m}`);
      }
    }
    expect(malas).toEqual([]);
  });

  it("lo que llega por id pregunta si quien mira lo puede ver", () => {
    const malas = Object.entries(POR_ID)
      .filter(([r, re]) => !re.test(leer(r)))
      .map(([r]) => r);
    expect(malas).toEqual([]);
  });

  it("las listas del equipo filtran por vendedor", () => {
    const malas = LISTAS.filter((r) => !/filtroVendedor\(/.test(leer(r)));
    expect(malas).toEqual([]);
  });

  it("el tiempo real filtra para un integrante", () => {
    const code = leer("events");
    expect(code).toContain("crearFiltroDeEventos(");
    expect(code).toMatch(/veTodo\(session\.role\)/);
  });
});

describe("las páginas del propietario redirigen a un integrante", () => {
  const APP = path.join(process.cwd(), "src", "app", "(app)");
  for (const pagina of ["settings/layout.tsx", "agent/page.tsx", "lab/page.tsx", "onboarding/page.tsx"]) {
    it(pagina, () => {
      const code = readFileSync(path.join(APP, pagina), "utf8");
      expect(code).toMatch(/canConfigure\(session\??\.role\)\)\s*redirect\(/);
    });
  }
});
